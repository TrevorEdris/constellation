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
  { step: 'gate', label: 'Approval' },
  { step: 'implement', label: 'Implement' },
  { step: 'complete', label: 'Done' },
]

/** Starlight amber: reached stars, done links, and the mark on a file being written. */
export const STAR = '#E0A43A'
const SLATE = '#5B6577'
const LABEL = '#8B93A1'

// Star positions on a 300 x 70 chart: an uneven arc, so the rail reads as a constellation.
const STAR_X = [32, 91, 150, 209, 268]
const STAR_Y = [34, 20, 30, 14, 26]

/**
 * The phase rail as a small star chart (an SVG document). Stars before `at`
 * are reached, the star at `at` carries a halo, later ones are hollow; the
 * approval star is a diamond. `at` is -1 when there is no phase yet.
 */
export function constellationSvg(at: number): string {
  const parts: string[] = []
  for (let i = 0; i < STAR_X.length - 1; i++) {
    const done = i < at
    parts.push(
      `<line x1="${STAR_X[i]}" y1="${STAR_Y[i]}" x2="${STAR_X[i + 1]}" y2="${STAR_Y[i + 1]}" stroke="${done ? STAR : SLATE}" stroke-width="${done ? 1.6 : 1}"${done ? '' : ' stroke-dasharray="3 3"'} stroke-linecap="round"/>`,
    )
  }
  RAIL.forEach((r, i) => {
    const x = STAR_X[i] ?? 0
    const y = STAR_Y[i] ?? 0
    const reached = i <= at
    if (i === at) parts.push(`<circle cx="${x}" cy="${y}" r="10" fill="${STAR}" fill-opacity="0.18"/>`)
    const size = i === at ? 5 : 3.5
    const paint = reached ? `fill="${STAR}"` : `fill="none" stroke="${SLATE}" stroke-width="1.2"`
    parts.push(r.step === 'gate'
      ? `<rect x="${x - size}" y="${y - size}" width="${size * 2}" height="${size * 2}" transform="rotate(45 ${x} ${y})" ${paint}/>`
      : `<circle cx="${x}" cy="${y}" r="${size}" ${paint}/>`)
    parts.push(
      `<text x="${x}" y="62" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="10.5" fill="${i === at ? STAR : LABEL}"${i === at ? ' font-weight="600"' : ''}>${r.label}</text>`,
    )
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 70" width="300" height="70">${parts.join('')}</svg>`
}

/** The phase rail for surfaces without Svg, one glyph per star: reached ●, current ◉, ahead ○, approval ◆/◇. */
export function railGlyphs(at: number): Array<{ glyph: string; label: string; state: 'reached' | 'current' | 'ahead' }> {
  return RAIL.map((r, i) => {
    const state = i < at ? 'reached' : i === at ? 'current' : 'ahead'
    const glyph = r.step === 'gate' ? (state === 'ahead' ? '◇' : '◆') : state === 'current' ? '◉' : state === 'reached' ? '●' : '○'
    return { glyph, label: r.label, state }
  })
}

/** A session dir's name as a title: `2026-10-10_PROJ-1_Add-Auth` reads `Add Auth`. */
export function sessionTitle(dir: string): string {
  const name = dir.split('/').pop() ?? dir
  const slug = name.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/^[A-Z][A-Z0-9]+-\d+_/, '')
  return slug.replace(/[-_]+/g, ' ').trim() || name
}

/** One plain sentence saying where the work stands. */
export function statusSentence(s: ConsoleState): string {
  const name = (p: ConsolePlan | null) => p?.title ?? p?.path.split('/').pop() ?? 'the plan'
  switch (currentStep(s)) {
    case 'discover': return 'Discovering. Findings go in DISCOVERY.md.'
    case 'plan': return `Planning ${name(leadPlan(s))}.`
    case 'gate': return `Waiting for your approval on ${name(gatedPlan(s))}.`
    case 'implement': return `Implementing ${name(leadPlan(s))}.`
    case 'complete': return 'All plans are complete. Wrap up the branch when ready.'
    default: return 'No phase yet.'
  }
}

/** True while a plan still takes answers: drafted, being planned, or awaiting approval. */
export function isOpenPlan(p: ConsolePlan): boolean {
  return ['draft', 'planning', 'plan', 'awaiting-approval'].includes(String(p.status ?? '').toLowerCase())
}

export type DeliveryRow = { key: string; repoPath: string; repo: string; branch: string; base: string; prs: number }

/** Every plan's delivery items, once each: repo path and name, branch, base and PR count. */
export function deliveryRows(s: ConsoleState): DeliveryRow[] {
  const seen = new Set<string>()
  const rows: DeliveryRow[] = []
  for (const p of s.plans) {
    for (const d of p.delivery) {
      const key = `${d.repo ?? ''}|${d.branch ?? ''}|${d.base ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const repoPath = d.repo ?? ''
      rows.push({ key, repoPath, repo: repoPath.split('/').pop() ?? '', branch: d.branch ?? '?', base: d.base ?? '?', prs: d.prs ?? 0 })
    }
  }
  return rows
}

/** Where a branch's PR lookup is kept: one entry per repo and branch. */
export function prKey(repoPath: string, branch: string): string {
  return `${repoPath}|${branch}`
}

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
  return s.plans.find(p => String(p.status ?? '').toLowerCase() === 'awaiting-approval') ?? null
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
