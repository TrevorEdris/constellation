/**
 * What the console pane shows, worked out from scripts/state.js output with
 * no engine calls: the phase rail, the buttons for the current phase, ages,
 * branch warnings and the status-line text. register.tsx draws from these.
 */
import type { ConsoleActivity, ConsolePlan, ConsoleScore, ConsoleState } from '../../types'

export type RailStep = 'discover' | 'plan' | 'gate' | 'implement' | 'complete'

export const RAIL: ReadonlyArray<{ step: RailStep; label: string }> = [
  { step: 'discover', label: 'Discover' },
  { step: 'plan', label: 'Plan' },
  { step: 'gate', label: '◆Gate' },
  { step: 'implement', label: 'Implement' },
  { step: 'complete', label: 'Done' },
]

/** The rail step to highlight: the gate while a plan awaits approval, else the phase. */
export function currentStep(s: ConsoleState | null): RailStep | null {
  if (!s || !s.sessionDir || !s.phase) return null
  return s.gate ? 'gate' : s.phase
}

/** The plan that sets the phase: state.js lists plans least advanced first. */
export function leadPlan(s: ConsoleState): ConsolePlan | null {
  return s.plans[0] ?? null
}

/** The first plan waiting for approval; the gate buttons act on it. */
export function gatedPlan(s: ConsoleState): ConsolePlan | null {
  return s.plans.find(p => p.status === 'awaiting-approval') ?? null
}

/**
 * One pane button. `submit` sends `text` as the next prompt; `fill` puts it in
 * the composer so the person finishes the reply that card.py records.
 */
export type Action = { key: string; label: string; hotkey: string; kind: 'submit' | 'fill'; text: string }

export function actions(s: ConsoleState | null): Action[] {
  const step = currentStep(s)
  if (!s || !step) return []
  const lead = leadPlan(s)?.path ?? 'the plan'
  switch (step) {
    case 'discover':
      return [{ key: 'discovery', label: 'Write discovery', hotkey: '1', kind: 'submit', text: 'Continue discovery and update DISCOVERY.md in the session dir.' }]
    case 'plan':
      return [
        { key: 'validate', label: 'Validate plan', hotkey: '1', kind: 'submit', text: `Run constellation:plan-validator on ${lead}.` },
        { key: 'render', label: 'Render card', hotkey: '2', kind: 'submit', text: `Render the approval card for ${lead} with card.py render.` },
      ]
    case 'gate':
      return [
        { key: 'approve', label: 'Approve', hotkey: '1', kind: 'fill', text: 'approve' },
        { key: 'changes', label: 'Request changes', hotkey: '2', kind: 'fill', text: 'changes: ' },
      ]
    case 'implement':
      return [
        { key: 'continue', label: 'Continue', hotkey: '1', kind: 'submit', text: `Continue implementing ${lead}.` },
        { key: 'handoff', label: 'Save handoff', hotkey: '2', kind: 'submit', text: 'Use constellation:session-handoff to save a handoff.' },
      ]
    case 'complete':
      return [{ key: 'wrapup', label: 'Wrap up branch', hotkey: '1', kind: 'submit', text: 'Use constellation:git-workflow to finish this branch and open the PR.' }]
  }
}

/** `now` under a minute, then whole minutes, hours or days. */
export function age(nowMs: number, mtimeMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export type Warning = { text: string; level: 'warning' | 'error' }

/**
 * A yellow warning per delivery item whose repo is the one the session is in
 * but on another branch; a red one when implementing on main or master.
 */
export function branchWarnings(s: ConsoleState): Warning[] {
  const git = s.git
  if (!git || !git.branch) return []
  const out: Warning[] = []
  for (const plan of s.plans) {
    for (const d of plan.delivery) {
      if (d.repo === git.toplevel && d.branch && d.branch !== git.branch) {
        out.push({ text: `⚠ on ${git.branch}; plan expects ${d.branch}`, level: 'warning' })
      }
    }
  }
  if (s.phase === 'implement' && (git.branch === 'main' || git.branch === 'master')) {
    out.push({ text: `⚠ on ${git.branch}`, level: 'error' })
  }
  return out
}

export function statusLine(s: ConsoleState | null): string {
  if (!s || !s.sessionDir) return '✦ constellation · no session yet'
  return `✦ ${s.phase ?? 'no phase yet'}${s.gate ? ' · ◆ awaiting approval' : ''}`
}

/** True when `file` is `dir` itself or inside it. */
export function isUnder(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}

/** The score cache after a refresh: every plan that came back with a score. */
export function nextScores(s: ConsoleState): Record<string, ConsoleScore> {
  const out: Record<string, ConsoleScore> = {}
  for (const p of s.plans) {
    if (typeof p.score === 'number') out[p.path] = { mtimeMs: p.mtimeMs, score: p.score, passed: p.passed === true }
  }
  return out
}

export const ACTIVITY_MS = 45_000

/** Adds a write, newest first: one entry per path, at most 6, none older than 45 s. */
export function pushActivity(list: ConsoleActivity[], path: string, at: number): ConsoleActivity[] {
  return [{ path, at }, ...list.filter(a => a.path !== path && at - a.at < ACTIVITY_MS)].slice(0, 6)
}

/** Adds a skill name, newest first, once each, at most 8. */
export function pushSkill(list: string[], skill: string): string[] {
  return [skill, ...list.filter(s => s !== skill)].slice(0, 8)
}

/** The first line of a message, or '' for none. */
export function firstLine(text: string): string {
  return (text.split('\n').find(l => l.trim() !== '') ?? '').trim()
}
