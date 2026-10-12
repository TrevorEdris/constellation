/**
 * Tests for the constellation console mod. The engine beneath the plugin is
 * stubbed: process.run answers with a canned state.js JSON (or a failure),
 * and every prompt, status, open and copy the mod makes is recorded. Each
 * drawing test runs on the terminal and the desktop.
 */
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ConsolePlan, ConsoleState } from '../../types'

const SURFACES = ['terminal', 'desktop'] as const
const DIR = '/root/2026-10-12_Console'
const PLAN_PATH = `${DIR}/PLAN.md`

const plan = (over: Partial<ConsolePlan> = {}): ConsolePlan => ({
  path: PLAN_PATH, mtimeMs: 0, title: 'Console pane', status: 'draft', phase: 'plan',
  score: 84, passed: true, size: '~420 lines · 6 files · 9 tasks · 1 PR',
  needsCall: [{ n: 1, text: 'Auto-open on start?', default: 'no' }],
  delivery: [{ repo: '/src/constellation', mode: 'pr', branch: 'feat/console', base: 'main', remote: 'origin', prs: 1 }],
  ...over,
})

const state = (over: Partial<ConsoleState> = {}): ConsoleState => ({
  root: '/root', sessionDir: DIR, phase: 'plan', gate: null, plans: [plan()],
  docs: [{ name: 'SESSION.md', mtimeMs: 0 }, { name: 'PLAN.md', mtimeMs: 0 }],
  git: { toplevel: '/src/constellation', branch: 'feat/console' },
  ...over,
})

type Recorded = {
  runs: number
  submits: string[]
  fills: string[]
  statuses: (string | undefined)[]
  copies: string[]
  opened: string[]
}

/**
 * Stubs the engine beneath the plugin. `answer` is what the next state.js
 * runs print: a state, or an Error for a run that exits 1 with its message.
 */
function engine(on: On, answer: { current: ConsoleState | Error }): Recorded {
  const rec: Recorded = { runs: 0, submits: [], fills: [], statuses: [], copies: [], opened: [] }
  mock.clock(on, { now: 0 })
  // Calls on $ answer { value }; events answer their result.
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', (_$, e) => { rec.statuses.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.copy', (_$, e) => { rec.copies.push(e.text); return { value: { isCopied: true } } })
  on('process.run', () => {
    rec.runs += 1
    const a = answer.current
    const value = a instanceof Error
      ? { exitCode: 1, stdout: '', stderr: `state: ${a.message}\n`, isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 0, stdout: JSON.stringify(a), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    return { value }
  })
  on('prompt.submit', (_$, e) => { rec.submits.push(e.text); return { text: e.text } })
  on('prompt.fill', (_$, e) => { rec.fills.push(e.text); return { isFilled: true } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  return rec
}

const PANE = {
  plugin: 'constellation',
  component: 'Pane',
  requestId: 'constellation-console',
  props: { title: 'Constellation', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** Raises the end of a turn, which refreshes the state. */
async function endTurn($: Engine): Promise<void> {
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't', reason: 'answer' })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/src/constellation', surface: 'terminal', isInteractive: true })
}

describe('pane', () => {
  test('empty state when there is no session dir', async ($, on) => {
    engine(on, { current: state({ sessionDir: null, phase: null, plans: [], docs: [] }) })
    await start($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /No constellation session yet/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('each phase shows its buttons', async ($, on) => {
    const answer: { current: ConsoleState | Error } = { current: state() }
    engine(on, answer)
    await start($)
    const cases: [Partial<ConsoleState>, string[]][] = [
      [{ phase: 'discover', plans: [] }, ['Write discovery']],
      [{ phase: 'plan' }, ['Validate plan', 'Render card']],
      [{ phase: 'plan', gate: 'awaiting-approval', plans: [plan({ status: 'awaiting-approval' })] }, ['Approve', 'Request changes']],
      [{ phase: 'implement', plans: [plan({ status: 'approved', phase: 'implement' })] }, ['Continue', 'Save handoff']],
      [{ phase: 'complete', plans: [plan({ status: 'complete', phase: 'complete' })] }, ['Wrap up branch']],
    ]
    for (const [over, labels] of cases) {
      answer.current = state(over)
      await endTurn($)
      for (const surface of SURFACES) {
        const ui = await $.ui.mount({ ...PANE, surface })
        const shown = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
        for (const label of labels) expect(shown).toContain(label)
        await ui.unmount()
      }
    }
  })

  test('Approve fills the composer; Render card submits the exact prompt', async ($, on) => {
    const answer: { current: ConsoleState | Error } = { current: state() }
    const rec = engine(on, answer)
    await start($)
    const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await terminal.press({ key: 'render' })
    expect(rec.submits).toEqual([`Render the approval card for ${PLAN_PATH} with card.py render.`])
    await terminal.unmount()

    answer.current = state({ gate: 'awaiting-approval', plans: [plan({ status: 'awaiting-approval' })] })
    await endTurn($)
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await desktop.press({ key: 'approve' })
    expect(rec.fills).toEqual(['approve'])
    expect(rec.submits).toHaveLength(1)
  })

  test('validator color follows passed, not the score', async ($, on) => {
    engine(on, { current: state({ plans: [plan({ score: 100, passed: false })] }) })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const line = await ui.find({ type: 'Text', text: /validator 100 NEEDS WORK/ })
    expect(line?.props.color).toBe('warning')
  })

  test('renders inline as well as docked', async ($, on) => {
    engine(on, { current: state() })
    await start($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' }, surface: 'terminal' })
    expect(await ui.find({ text: /Validate plan/ })).toBeDefined()
  })

  test('branch warning when the session repo is on another branch', async ($, on) => {
    engine(on, { current: state({ git: { toplevel: '/src/constellation', branch: 'ci/version-check' } }) })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: '⚠ on ci/version-check; plan expects feat/console' })).toBeDefined()
  })

  test('a failed refresh keeps the last state and shows the error', async ($, on) => {
    const answer: { current: ConsoleState | Error } = { current: state() }
    engine(on, answer)
    await start($)
    answer.current = new Error('boom')
    await endTurn($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: 'state unavailable: state: boom' })).toBeDefined()
    expect(await ui.find({ text: /Validate plan/ })).toBeDefined()
  })
})

describe('events', () => {
  test('a Write under the session dir marks the doc and refreshes once', async ($, on) => {
    const rec = engine(on, { current: state() })
    await start($)
    const before = rec.runs
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${DIR}/PLAN.md`, content: 'x' } as never)
    expect(rec.runs).toBe(before + 1)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: /PLAN\.md {2}✎ writing…/ })).toBeDefined()
  })

  test('a Write outside the session dir does not refresh', async ($, on) => {
    const rec = engine(on, { current: state() })
    await start($)
    const before = rec.runs
    await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: '/elsewhere/x.md', content: 'x' } as never)
    expect(rec.runs).toBe(before)
  })

  test('constellation skills are listed; other skills are not', async ($, on) => {
    engine(on, { current: state() })
    await start($)
    await $.skill.prompt({ skill: 'constellation:brainstorming', text: 'x' })
    await $.skill.prompt({ skill: 'caveman:caveman', text: 'x' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const row = await ui.find({ text: /^SKILLS / })
    expect(row?.text).toBe('SKILLS brainstorming')
  })

  test('status line: gate and no session', async ($, on) => {
    const answer: { current: ConsoleState | Error } = { current: state({ gate: 'awaiting-approval' }) }
    const rec = engine(on, answer)
    await start($)
    expect(rec.statuses.at(-1)).toBe('✦ plan · ◆ awaiting approval')
    answer.current = state({ sessionDir: null, phase: null, plans: [], docs: [] })
    await endTurn($)
    expect(rec.statuses.at(-1)).toBe('✦ constellation · no session yet')
  })

  test('/constellation opens the pane and answers', async ($, on) => {
    const rec = engine(on, { current: state() })
    await start($)
    const res = await $.command.run({ command: 'constellation', args: '' } as never)
    expect(res.text).toBe('Constellation pane opened.')
    expect(rec.opened).toEqual(['constellation-console'])
  })
})
