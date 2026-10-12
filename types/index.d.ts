/**
 * Types of the constellation console mod (hooks/console/): the JSON that
 * scripts/state.js prints, and the session state the pane draws from.
 */

export type ConsolePhase = 'discover' | 'plan' | 'implement' | 'complete'

export type ConsoleNeedsCall = { n: number; text: string; default: string }

/** One `delivery` item of a PLAN's frontmatter; a key the plan left out is absent. */
export type ConsoleDelivery = {
  repo?: string
  mode?: string
  branch?: string
  base?: string
  remote?: string
  prs?: number
}

export type ConsolePlan = {
  path: string
  mtimeMs: number
  title: string | null
  status: string | null
  phase: ConsolePhase
  score: number | null
  passed: boolean | null
  size: string | null
  needsCall: ConsoleNeedsCall[]
  delivery: ConsoleDelivery[]
}

export type ConsoleDoc = { name: string; mtimeMs: number }

export type ConsoleState = {
  root: string
  sessionDir: string | null
  phase: ConsolePhase | null
  gate: 'awaiting-approval' | null
  plans: ConsolePlan[]
  docs: ConsoleDoc[]
  git: { toplevel: string; branch: string | null } | null
}

/** A validator score the mod keeps so state.js only re-scores a plan that changed. */
export type ConsoleScore = { mtimeMs: number; score: number; passed: boolean }

/** A file Claude wrote under the session dir, and when (epoch ms). */
export type ConsoleActivity = { path: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    constellation: {
      snapshot: ConsoleState | null
      error: string | null
      scores: Record<string, ConsoleScore>
      activity: ConsoleActivity[]
      skills: string[]
    }
  }
}
