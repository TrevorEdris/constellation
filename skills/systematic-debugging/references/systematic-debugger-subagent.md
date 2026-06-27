# Systematic-Debugger Subagent

Dispatch an isolated, read-only investigation when a bug needs focused tracing without polluting the
controller's context — and especially inside Workflow scripts, where each investigation should run in
its own agent and return a structured report.

The subagent is read-only by design: it has no Write/Edit access. This is the mechanism that prevents
jumping to a fix before the root cause is confirmed. If instrumentation is needed, the subagent
proposes the exact command; the controller (or a later phase) applies it.

---

## When to dispatch

- The investigation is large enough to consume significant controller context (long stack traces,
  many files, multi-component tracing).
- You want the work product (a root-cause report) judged independently of the reasoning that produced it.
- A Workflow script needs one bug investigated per agent, with a uniform report to aggregate.

Do NOT dispatch for a one-line obvious error you can read in place — the round trip is not worth it.

---

## Dispatch template

Paste the FULL bug context into the prompt. Never tell the subagent to "go read the failure" — give it
everything it needs. Pass constructed context, not your session history.

```
You are a specialist debugger. Find the root cause. Do NOT propose or apply a fix until the root
cause is confirmed by evidence. You have read-only tools (Bash, Glob, Grep, Read) — you cannot
Write or Edit. If instrumentation is needed, output the exact Bash command; do not apply it.

## The bug
Symptom (exact error / unexpected behavior, verbatim):
[PASTE the exact error message and full stack trace]

When it started: [after deploy / after change / always / unknown]
Where it occurs: [local only / CI only / production / specific inputs]
Reproduction steps: [exact steps, or "not yet reproduced"]
Already tried (do not repeat): [list of attempted fixes and their results]

## Method (mandatory order)
1. Root cause investigation FIRST — read the full error, reproduce, check recent changes
   (git diff/log), gather evidence at each component boundary, trace the bad value upstream to origin.
2. Pattern analysis — find working examples, compare completely, list every difference.
3. Hypothesis — form ONE specific hypothesis ("X causes Y because Z"); test the smallest change;
   one variable at a time. Hypothesis fails -> form a NEW one, do not stack.
4. After 3 failed hypotheses: STOP and escalate as a likely architectural problem.

## Rules
- Phase 1 before any hypothesis. No exceptions.
- State what you know and what you do not. "I don't know X yet" is correct; "probably X" without
  evidence is not.
- Run the app / tests to observe behavior. Do not reason from code alone.

## Report (return EXACTLY this format)
### Debugging Report
**Symptom**        — what was observed (exact error / failing output)
**Root Cause**     — what is actually wrong and why (specific, one sentence)
**Evidence**       — files read, commands run, outputs examined that confirm the root cause
**Recommended Fix** — minimal change addressing the root cause (file, line, exact change)
**Verification Plan** — exact command/test that confirms the fix works
**Severity**       — CRITICAL / HIGH / MEDIUM / LOW
**Confidence**     — High / Medium / Low (and why, if not High)
**Status**         — DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
```

---

## Severity vocabulary

- **CRITICAL** — data corruption, security exposure, system unavailability
- **HIGH** — incorrect behavior, silent failures, performance degradation
- **MEDIUM** — edge-case failures, degraded behavior under specific conditions
- **LOW** — minor inconsistencies, cosmetic issues, non-blocking problems

---

## Controller responsibilities

- Distrust an optimistic report. If the subagent finished fast, verify the root-cause claim against the
  actual code before acting on the recommended fix.
- The subagent only investigates. Applying the fix and creating the failing test happen back in the
  controller, under the four-phase discipline (see the parent SKILL.md).
- On Codex, dispatch with `spawn_agent` / `wait` / `close_agent`; see
  `skills/_shared/platform/codex-tools.md`.
