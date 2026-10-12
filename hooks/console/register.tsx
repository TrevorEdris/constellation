/**
 * The constellation console: a pane (/constellation) and a status-line entry
 * that show the session's workflow state, with buttons that steer it by
 * prompting Claude, so every state change still goes through a skill.
 *
 * State comes from scripts/state.js, run on session start, after Claude
 * writes into the session dir, at the end of each turn, when a watched file
 * changes, and every 15 s while the pane is open. Refreshes never overlap: a
 * request that arrives during one runs once more after it.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ConsoleState } from '../../types'
import {
  ACTIVITY_MS, RAIL, actions, age, branchWarnings, currentStep, firstLine, gatedPlan,
  isUnder, nextScores, pushActivity, pushSkill, statusLine,
} from './view'

const PANE = 'constellation-console'
const TITLE = 'Constellation'
const POLL_MS = 15_000
const STATE_TIMEOUT_MS = 5_000

const snapshot = atom({ plugin: 'constellation', key: 'snapshot' } as const, null)
const error = atom({ plugin: 'constellation', key: 'error' } as const, null)
const scores = atom({ plugin: 'constellation', key: 'scores' } as const, {})
const activity = atom({ plugin: 'constellation', key: 'activity' } as const, [])
const skills = atom({ plugin: 'constellation', key: 'skills' } as const, [])

let running: Promise<void> | null = null
let again = false
let poll: Timer | null = null

async function refreshOnce($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    const cache = await read($, scores)
    const res = await $.process.run(
      ['node', `${$.plugin.root}/scripts/state.js`, '--session-id', id, '--cache-stdin'],
      { stdin: JSON.stringify({ scores: cache }), timeoutMs: STATE_TIMEOUT_MS },
    )
    if (res.exitCode !== 0) throw new Error(firstLine(res.stderr) || `state.js exited ${res.exitCode}`)
    const state = JSON.parse(res.stdout) as ConsoleState
    await update($, snapshot, () => state)
    await update($, scores, () => nextScores(state))
    await update($, error, () => null)
  } catch (err) {
    try {
      await update($, error, () => firstLine(err instanceof Error ? err.message : String(err)) || 'unknown error')
    } catch {
      // The error atom is best-effort; a refresh never throws.
    }
  }
  try {
    $.ui.status(statusLine(await read($, snapshot)))
  } catch {
    // The status line is best-effort.
  }
}

async function refresh($: EngineInterface): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await refreshOnce($)
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

/** Starts a refresh without waiting for it, so an event never waits on the CLI. */
function refreshLater($: EngineInterface): void {
  void refresh($).catch(() => undefined)
}

async function open($: EngineInterface): Promise<string> {
  const placed = await $.ui.open({ id: PANE, title: TITLE, columns: 46 })
  if (!placed.isPlaced) return `Constellation pane not shown: ${placed.reason}`
  poll?.cancel()
  poll = $.clock.every(POLL_MS, () => void refresh($))
  await refresh($)
  return 'Constellation pane opened.'
}

async function close($: EngineInterface): Promise<string> {
  poll?.cancel()
  poll = null
  await $.ui.close({ id: PANE })
  return 'Constellation pane closed.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'constellation',
      description: 'Show the constellation workflow pane',
      argumentHint: '[open|close]',
    })
    refreshLater($)
    return next(e)
  })

  on('command.run', { command: 'constellation' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'open') return { text: await open($) }
    if (arg === 'close') return { text: await close($) }
    if (arg !== '') return { text: 'usage: /constellation [open|close]' }
    const panes = await $.ui.panes()
    const isOpen = panes.some(p => p.id === PANE)
    return { text: isOpen ? await close($) : await open($) }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const file = e.tool === 'Write' || e.tool === 'Edit'
      ? e.file_path
      : e.tool === 'NotebookEdit' ? e.notebook_path : null
    if (!file) return result
    const dir = (await read($, snapshot))?.sessionDir ?? null
    if (dir && !isUnder(file, dir)) return result
    if (dir) {
      const now = await $.clock.now()
      await update($, activity, list => pushActivity(list, file, now))
    }
    refreshLater($)
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    if (e.skill.startsWith('constellation:')) await update($, skills, list => pushSkill(list, e.skill))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    refreshLater($)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    // Must match sessionRoot() in hooks/lib/session.js: SESSION_ROOT if set, else $HOME/src/.ai/sessions.
    const fromEnv = await $.env.get('SESSION_ROOT')
    const home = await $.env.get('HOME')
    const root = fromEnv || (home ? `${home}/src/.ai/sessions` : null)
    const s = await read($, snapshot)
    refreshLater($)
    const watch = [...(root ? [`${root}/.sessions`] : []), ...(s?.sessionDir ? [s.sessionDir] : [])]
    return { ...result, watchPaths: [...(result.watchPaths ?? []), ...watch] }
  })

  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    refreshLater($)
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      poll?.cancel()
      poll = null
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const err = await read($, error)
    const writes = await read($, activity)
    const used = await read($, skills)
    const now = await $.clock.now()
    const rule = '─'.repeat(Math.max(10, Math.min(e.props.bodyColumns || 40, 80)))

    if (!s || !s.sessionDir) {
      return (
        <Box flexDirection="column">
          <Text bold>✦ {TITLE}</Text>
          {err && <Text dimColor>state unavailable: {err}</Text>}
          <Text dimColor>No constellation session yet — the journal starts when this turn ends.</Text>
        </Box>
      )
    }

    const dir = s.sessionDir
    const step = currentStep(s)
    const at = RAIL.findIndex(r => r.step === step)
    const gated = s.gate ? gatedPlan(s) : null
    const writing = new Set(writes.filter(w => now - w.at < ACTIVITY_MS).map(w => w.path))
    const shown = s.plans.slice(0, 2)

    return (
      <Box flexDirection="column">
        <Text bold>✦ {TITLE}</Text>
        {err && <Text dimColor>state unavailable: {err}</Text>}
        <Text>{dir.split('/').pop() ?? dir}</Text>
        <Text dimColor wrap="truncate-start">{dir}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="open-dir" label="open dir" hotkey="o" plain onPress={() => void $.prompt.submit({ text: `Open the session directory ${dir} in Finder.` })} />
          <Button key="copy" label="copy path" hotkey="y" plain onPress={() => void $.ui.copy({ text: dir, surface: e.surface })} />
        </Box>
        <Text dimColor>{rule}</Text>
        <Box flexDirection="row" flexWrap="wrap">
          {RAIL.map((r, i) => (
            <Text key={`rail-${r.step}`} inverse={i === at} bold={i === at} dimColor={i > at}>
              {i === 0 ? '' : ' ─ '}{r.label}
            </Text>
          ))}
        </Box>
        {gated && <Text color="warning">awaiting your approval: {gated.title ?? gated.path.split('/').pop()}</Text>}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {actions(s).map(a => (
            <Button
              key={a.key}
              label={a.label}
              hotkey={a.hotkey}
              onPress={() => void (a.kind === 'fill'
                ? $.prompt.fill({ text: a.text, mode: 'insert' })
                : $.prompt.submit({ text: a.text }))}
            />
          ))}
        </Box>
        {shown.length > 0 && <Text dimColor>{rule}</Text>}
        {shown.map(p => (
          <Box key={`plan-${p.path}`} flexDirection="column">
            <Text bold wrap="truncate-end">PLAN  {p.title ?? p.path.split('/').pop()}  <Text dimColor>{p.status ?? '—'}</Text></Text>
            <Text color={p.score === null ? undefined : p.passed ? 'success' : 'warning'}>
              validator {p.score === null ? '—' : `${p.score} ${p.passed ? 'PASS' : 'NEEDS WORK'}`}
            </Text>
            {p.size && <Text dimColor>size {p.size}</Text>}
            {p.needsCall.length > 0 && <Text>needs your call ({p.needsCall.length})</Text>}
            {p.needsCall.map(c => (
              <Text key={`call-${p.path}-${c.n}`} wrap="truncate-end"> {c.n} {c.text}  → {c.default}</Text>
            ))}
          </Box>
        ))}
        {s.plans.length > shown.length && <Text dimColor>+ {s.plans.length - shown.length} more</Text>}
        <Text dimColor>{rule}</Text>
        <Text bold>DOCS</Text>
        {s.docs.map(d => (
          <Button
            key={`doc:${d.name}`}
            plain
            label={`${d.name}${writing.has(`${dir}/${d.name}`) ? '  ✎ writing…' : ''}  ${age(now, d.mtimeMs)}`}
            onPress={() => void $.prompt.submit({ text: `Show me a summary of ${dir}/${d.name}.` })}
          />
        ))}
        {used.length > 0 && <Text dimColor wrap="truncate-end">SKILLS {used.map(n => n.replace(/^constellation:/, '')).join(' › ')}</Text>}
        <Box flexGrow={1} />
        {s.plans.flatMap(p => p.delivery).length > 0 && <Text dimColor>{rule}</Text>}
        {s.plans.flatMap(p => p.delivery.map((d, i) => (
          <Text key={`delivery-${p.path}-${i}`} wrap="truncate-end">
            {(d.repo ?? '').split('/').pop()}  {d.branch ?? '?'} → {d.base ?? '?'} · {d.mode ?? '?'} · {d.prs ?? 0} PR
          </Text>
        )))}
        {branchWarnings(s).map((w, i) => (
          <Text key={`warn-${i}`} color={w.level}>{w.text}</Text>
        ))}
      </Box>
    )
  })
}
