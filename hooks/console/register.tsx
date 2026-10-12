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

import type { ConsolePr, ConsoleState } from '../../types'
import {
  ACTIVITY_MS, RAIL, STAR, actions, age, branchWarnings, constellationSvg, currentStep, deliveryRows, firstLine,
  isOpenPlan, isUnder, nextScores, prKey, pushActivity, pushSkill, railGlyphs, sessionTitle, statusLine, statusSentence,
} from './view'

const PANE = 'constellation-console'
const TITLE = 'Constellation'
const POLL_MS = 15_000
const STATE_TIMEOUT_MS = 5_000
const GH_TIMEOUT_MS = 10_000
const PR_TTL_MS = 5 * 60_000

const snapshot = atom({ plugin: 'constellation', key: 'snapshot' } as const, null)
const error = atom({ plugin: 'constellation', key: 'error' } as const, null)
const scores = atom({ plugin: 'constellation', key: 'scores' } as const, {})
const activity = atom({ plugin: 'constellation', key: 'activity' } as const, [])
const skills = atom({ plugin: 'constellation', key: 'skills' } as const, [])
const preview = atom({ plugin: 'constellation', key: 'preview' } as const, null)
const prs = atom({ plugin: 'constellation', key: 'prs' } as const, {})

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
  try {
    const shown = await read($, preview)
    if (shown) await showFile($, shown.path)
    const s = await read($, snapshot)
    if (s) await lookUpPrs($, s)
  } catch {
    // The preview and PR links are best-effort; a refresh never throws.
  }
}

/** Shows a file inside the pane, or why it could not be read. */
async function showFile($: EngineInterface, path: string): Promise<void> {
  const name = path.split('/').pop() ?? path
  try {
    const text = await $.fs.read(path)
    await update($, preview, () => ({ name, path, text: String(text), error: null }))
  } catch (err) {
    const reason = firstLine(err instanceof Error ? err.message : String(err)) || 'unreadable'
    await update($, preview, () => ({ name, path, text: null, error: reason }))
  }
}

/** Looks up the PR of each shipping branch, at most once per 5 minutes per branch. */
async function lookUpPrs($: EngineInterface, s: ConsoleState): Promise<void> {
  const known = await read($, prs)
  const now = await $.clock.now()
  for (const row of deliveryRows(s)) {
    if (!row.repoPath.startsWith('/') || row.branch === '?' || row.branch === 'n/a') continue
    const key = prKey(row.repoPath, row.branch)
    const seen = known[key]
    if (seen && now - seen.at < PR_TTL_MS) continue
    const pr = await ghPr($, row.repoPath, row.branch)
    await update($, prs, all => ({ ...all, [key]: { pr, at: now } }))
  }
}

/**
 * The newest PR whose head is `branch`, from `gh pr list` run in the repo. A
 * failed call is tried once more with GITHUB_TOKEN emptied, so gh falls back
 * to its keyring login when an exported token is stale. Null when gh is
 * missing, both calls fail, or the branch has no PR.
 */
async function ghPr($: EngineInterface, repo: string, branch: string): Promise<ConsolePr | null> {
  const argv = ['gh', 'pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,state', '--limit', '1']
  for (const env of [undefined, { GITHUB_TOKEN: '' }]) {
    try {
      const res = await $.process.run(argv, { cwd: repo, timeoutMs: GH_TIMEOUT_MS, ...(env ? { env } : {}) })
      if (res.exitCode !== 0) continue
      const first: unknown = (JSON.parse(res.stdout) as unknown[])[0]
      if (!first || typeof first !== 'object') return null
      const { number, url, state } = first as Record<string, unknown>
      return typeof number === 'number' && typeof url === 'string' ? { number, url, state: String(state ?? '') } : null
    } catch {
      // gh missing, timed out or printed something else: try the next way, then give up.
    }
  }
  return null
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
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    const s = await read($, snapshot)
    const shown = await read($, preview)
    const err = await read($, error)
    const writes = await read($, activity)
    const used = await read($, skills)
    const now = await $.clock.now()
    const problem = err && <Text color="warning">Couldn't read session state: {err}</Text>

    if (!s || !s.sessionDir) {
      return (
        <Box flexDirection="column">
          {problem}
          <Text>No session journal yet.</Text>
          <Text dimColor>It starts when this turn ends.</Text>
        </Box>
      )
    }

    if (shown) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="Back" hotkey="b" onPress={() => void update($, preview, () => null)} />
            <Text bold wrap="truncate-end">{shown.name}</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {shown.error === null
              ? <Markdown text={shown.text ?? ''} />
              : <Text color="warning">Couldn't open {shown.name}: {shown.error}</Text>}
          </Box>
        </Box>
      )
    }

    const dir = s.sessionDir
    const at = RAIL.findIndex(r => r.step === currentStep(s))
    const writing = new Set(writes.filter(w => now - w.at < ACTIVITY_MS).map(w => w.path))
    const plans = s.plans.slice(0, 2)
    const shipping = deliveryRows(s)
    const prLookups = await read($, prs)
    const warnings = branchWarnings(s)

    return (
      <Box flexDirection="column">
        {problem}
        <Text bold wrap="truncate-end">{sessionTitle(dir)}</Text>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-start">{dir}</Text>
          </Box>
          <Button key="copy" label="copy path" hotkey="y" plain dimColor onPress={() => void $.ui.copy({ text: dir, surface: e.surface })} />
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {'Svg' in els
            ? <els.Svg source={constellationSvg(at)} alt={`Phase: ${RAIL[at]?.label ?? 'none'}`} />
            : (
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {railGlyphs(at).map(g => (
                  <Text key={`rail-${g.label}`} color={g.state === 'ahead' ? undefined : STAR} dimColor={g.state === 'ahead'} bold={g.state === 'current'}>
                    {g.glyph} {g.label}
                  </Text>
                ))}
              </Box>
            )}
          <Text wrap="wrap">{statusSentence(s)}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
          {actions(s).map((a, i) => (
            <Button
              key={a.key}
              label={a.label}
              hotkey={a.hotkey}
              variant={i === 0 ? 'primary' : 'secondary'}
              onPress={() => void (a.kind === 'fill'
                ? $.prompt.fill({ text: a.text, mode: 'insert' })
                : $.prompt.submit({ text: a.text }))}
            />
          ))}
        </Box>

        {plans.length > 0 && <Box marginTop={1}><Text bold>Plans</Text></Box>}
        {plans.map(p => (
          <Box key={`plan-${p.path}`} flexDirection="column" marginTop={1}>
            <Button key={`plan:${p.path}`} plain label={p.title ?? p.path.split('/').pop() ?? p.path} onPress={() => void showFile($, p.path)} />
            <Text wrap="truncate-end">
              <Text dimColor>{p.status ?? 'no status'}, </Text>
              <Text color={p.score === null ? 'inactive' : p.passed ? 'success' : 'warning'}>
                {p.score === null ? 'not validated' : `validator ${p.score}, ${p.passed ? 'passing' : 'needs work'}`}
              </Text>
            </Text>
            {p.size && <Text dimColor wrap="truncate-end">{p.size}</Text>}
            {isOpenPlan(p) && p.needsCall.map(c => (
              <Text key={`call-${p.path}-${c.n}`} wrap="truncate-end">
                {c.n}. {c.text} <Text dimColor>Default: {c.default}</Text>
              </Text>
            ))}
          </Box>
        ))}
        {s.plans.length > plans.length && <Text dimColor>{s.plans.length - plans.length} more</Text>}

        {s.docs.length > 0 && <Box marginTop={1}><Text bold>Session files</Text></Box>}
        {s.docs.map(d => {
          const isWriting = writing.has(`${dir}/${d.name}`)
          return (
            <Box key={`docrow:${d.name}`} flexDirection="row" justifyContent="space-between" gap={1}>
              <Button key={`doc:${d.name}`} plain label={d.name} onPress={() => void showFile($, `${dir}/${d.name}`)} />
              <Text color={isWriting ? STAR : undefined} dimColor={!isWriting}>{isWriting ? 'writing' : age(now, d.mtimeMs)}</Text>
            </Box>
          )
        })}
        {used.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate-end">Skills used: {used.map(n => n.replace(/^constellation:/, '')).join(', ')}</Text>
          </Box>
        )}

        <Box flexGrow={1} />
        {(shipping.length > 0 || warnings.length > 0) && <Box marginTop={1}><Text bold>Shipping</Text></Box>}
        {shipping.map(d => {
          const pr = prLookups[prKey(d.repoPath, d.branch)]?.pr ?? null
          return pr
            ? (
              <Box key={`delivery-${d.key}`} flexDirection="row" gap={1}>
                <Link href={pr.url} label={`#${pr.number} ${d.branch} → ${d.base}`} />
                <Text dimColor>{pr.state.toLowerCase()}</Text>
              </Box>
            )
            : (
              <Text key={`delivery-${d.key}`} wrap="truncate-end">
                {d.branch} → {d.base} <Text dimColor>{d.repo}, no PR yet</Text>
              </Text>
            )
        })}
        {warnings.map((w, i) => (
          <Text key={`warn-${i}`} color={w.level}>{w.text}</Text>
        ))}
      </Box>
    )
  })
}
