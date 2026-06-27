---
name: systematic-debugging
description: Use when encountering any bug, test failure, crash, flaky test, build failure, performance problem, or unexpected behavior — before proposing or attempting any fix; especially when a quick patch looks obvious, you are under time pressure, or a previous fix did not work.
---

# Systematic Debugging

Random fixes waste time and create new bugs. A symptom patch masks the real defect and it returns
through a different path. Type: **rigid** — follow it exactly; do not adapt away the discipline.

**Core principle:** find the root cause before attempting any fix. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose a fix. No exceptions.

**Violating the letter of the rules is violating the spirit of the rules.** "Investigating while I fix"
is not investigating. A fix proposed before the root cause is stated is a guess.

## Announce + track

Say "Using systematic-debugging to find the root cause of [issue]." Put each phase you will run into
TodoWrite. Checklists without TodoWrite tracking get skipped — every time.

## When to use

ANY technical issue: test failures, production bugs, unexpected behavior, performance problems, build
failures, integration issues, flaky tests.

**Use this ESPECIALLY when** (these are the moments you will want to skip it):
- Under time pressure or an emergency — guessing feels faster, it is not.
- A one-line fix looks obvious.
- A manager or user wants it fixed NOW.
- You have already tried one or more fixes that did not work.
- You do not fully understand the issue.

Simple bugs have root causes too. The process is fast for genuinely simple bugs.

## Empirical mandate: instrument and watch it fail

Do not reason from code alone. Code-reading produces a plausible story; the running system produces the
truth, and they disagree often enough to waste hours. Run it, observe, then conclude.

- Reproduce the failure and watch it happen before forming any theory.
- Add instrumentation at component boundaries, run once, and read what actually flows — do not predict it.
- Confirm a fix by running the failing command in THIS message and reading real output. "Should work"
  is not evidence.

## The four phases

Complete each phase before the next. Track them in TodoWrite.

### Phase 1 — Root cause investigation (mandatory first)

1. **Read the error completely.** Stack trace, line numbers, file paths, error codes. The answer is
   often in the message you skipped.
2. **Reproduce consistently.** Exact steps; every time. Not reproducible -> gather more data, do not guess.
3. **Check recent changes.** `git diff`, recent commits, new dependencies, config and environment deltas.
4. **Gather evidence at boundaries.** In multi-component systems (CI -> build -> sign, API -> service ->
   DB), add diagnostic logging at each boundary: log what enters and exits each component, run once, and
   identify WHERE it breaks before touching code. See `references/defense-in-depth.md`.
5. **Trace data flow upstream.** Where does the bad value originate? What passed it in? Keep tracing to
   the source. See `references/root-cause-tracing.md`. For "which test pollutes shared state?", use
   `scripts/find-polluter.sh`.

You have the root cause only when you can finish this sentence with specifics: "The bug occurs because
[condition] causes [component] to [behavior] when [trigger]." Vague answers mean keep investigating.

### Phase 2 — Pattern analysis

1. **Find working examples** of similar code in the same codebase.
2. **Read references completely** — every line, no skimming. Partial understanding guarantees bugs.
3. **List every difference** between working and broken. Do not assume "that can't matter."
4. **Map dependencies** — config, environment, assumptions the code makes.

### Phase 3 — Hypothesis and testing

1. **Form ONE hypothesis.** "X is the root cause because Y." Specific, written down.
2. **Test minimally.** Smallest possible change; one variable at a time.
3. **Verify before continuing.** Worked -> Phase 4. Did not -> form a NEW hypothesis; do not stack fixes.
4. **When you do not know, say so.** "I don't understand X" beats a confident guess. Research or ask.

### Phase 4 — Implementation

1. **Create a failing test first.** Simplest reproduction; automated if possible. Required before fixing.
   Use **constellation:test-driven-development** (REQUIRED SUB-SKILL) to write it.
2. **Implement a single fix** at the root cause. One change. No "while I'm here" edits or bundled refactors.
3. **Verify.** Failing test now passes, no other tests broken, the issue is actually resolved — confirmed
   by running, this message. Use **constellation:verification-before-completion** (REQUIRED BACKGROUND).
4. **If the fix does not work: STOP and count.** Under 3 fixes -> return to Phase 1 with the new
   information. 3 or more -> question the architecture (below). Do not attempt fix #4 in isolation.

## The Three-Fix Limit

After 3 fixes that do not resolve the issue, **stop attempting fixes**. This is not a failed hypothesis —
it is a signal that the architecture is wrong.

Pattern that confirms it:
- Each fix reveals new shared state or coupling in a different place.
- Each fix would require "massive refactoring" to do properly.
- Each fix creates new symptoms elsewhere.

Escalate to your human partner: state what you know, what you tried, what each attempt revealed, and why
this looks architectural. That is accurate diagnosis, not failure.

## Tests must drive the real path

A green test that exercises a fake, a mock of the layer you changed, or hand-injected state proves
nothing. The failing test from Phase 4 must reproduce the bug through the REAL code path — the one users
hit. Before trusting green: would the test still fail if you reverted the fix? If not, the test is theater.
Add validation at multiple layers so the bug is structurally impossible, not just absent from one path
(`references/defense-in-depth.md`).

## Excuse | Reality

| Excuse | Reality |
|--------|---------|
| "Issue is simple, no process needed" | Simple bugs have root causes too. Process is fast for them. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check past the second attempt. |
| "Just try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I'll write the test after the fix works" | Untested fixes do not stick; the next refactor silently re-breaks it. |
| "Change both X and Y while I'm here" | Two changes mean you cannot know which worked or which broke something. |
| "Reference is long, I'll adapt the pattern" | Partial understanding guarantees bugs at the edges you skipped. |
| "I can see the problem, let me fix it" | Seeing the symptom location is not understanding the root cause. |
| "Quick fix for now, investigate later" | There is no temporary wrong code. "Later" never comes. |
| "One more fix attempt" (after 2+) | 3 failures = architectural problem. Question the pattern, do not fix again. |
| "It should work now" | Run it. Read the output. Evidence, not hope. |

## Red flags — STOP and return to Phase 1

If you catch yourself thinking any of these, stop:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add a few changes, then run tests"
- "Skip the test, I'll verify manually"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems:" (listing fixes without investigation)
- "One more fix attempt" (already tried 2+)
- Using "probably" or "should" without evidence
- Proposing a solution before tracing data flow

## Partner signals you are doing it wrong

Treat these redirections as a hard STOP -> return to Phase 1:
- "Is that not happening?" — you assumed without verifying.
- "Will it show us…?" — you should have added evidence gathering.
- "Stop guessing" — you are proposing fixes without understanding.
- "We're stuck?" (frustrated) — your approach is not working.

## Good vs bad

❌ "The test fails with a null pointer. I'll add a null check in `calculateTax()` and move on."
✅ "NPE in `calculateTax()` — traced upstream: `getPrice()` returns null for rows created before the
   migration that never backfilled `unit_price`. Root cause is the missing backfill plus no validation.
   Writing a failing test that generates an invoice for such an order, then fixing at the source."

❌ "I changed the timeout to 5s and bumped the retry count and reordered the awaits — tests pass now."
✅ "One variable: replaced the arbitrary `sleep(500)` with `waitFor(() => order.status === 'completed')`.
   Ran the suite 10x — green every time. The status update was async; the sleep was racing it."

❌ "This should fix it." (no command run)
✅ "Ran `pytest tests/test_invoice.py::test_legacy_order -q` in this message: 1 passed. Full suite: 214
   passed, 0 failed. Reverting the fix makes the new test fail, so it drives the real path."

## Isolated investigation (subagents / Workflow)

For a large investigation, or one bug per agent inside a Workflow script, dispatch the read-only
**systematic-debugger** subagent (`agents/systematic-debugger.md`): it traces and reports but cannot
edit, which structurally prevents fix-first behavior. Invoke it by name from a Workflow script (`Task`
with `subagent_type: systematic-debugger`), paste the full bug context into the prompt, and require the
fixed report format. The agent file holds the read-only mandate and report schema; the dispatch template
and controller responsibilities are in `references/systematic-debugger-subagent.md`. On Codex, map `Task`
-> `spawn_agent`; see `skills/_shared/platform/codex-tools.md`.

## When investigation reveals "no root cause"

If systematic investigation shows the issue is genuinely environmental, timing-dependent, or external:
document what you investigated, implement appropriate handling (retry, timeout, clear error), and add
monitoring for next time. But 95% of "no root cause" cases are incomplete investigation — be sure.

## Quick reference

| Phase | Activities | Done when |
|-------|-----------|-----------|
| 1. Root cause | Read errors, reproduce, check changes, instrument boundaries, trace upstream | You can state cause in one specific sentence |
| 2. Pattern | Find working examples, compare completely, list differences | Every difference identified |
| 3. Hypothesis | Form one theory, test minimally, one variable | Confirmed, or a new hypothesis formed |
| 4. Implementation | Failing test first, single fix, verify by running | Bug resolved, suite green, real path proven |

## References

- `references/root-cause-tracing.md` — five-step backward trace + instrumentation patterns + worked example
- `references/defense-in-depth.md` — four-layer validation to make a bug structurally impossible
- `references/anti-patterns.md` — full rationalization table, off-track signals, three-attempt checkpoint
- `references/debugging-log-template.md` — structured log for investigations over 30 min or 2+ hypotheses
- `references/condition-based-waiting.md` — replace flaky arbitrary timeouts with condition polling
- `agents/systematic-debugger.md` — dispatchable read-only investigation subagent (invoke by name in Workflow scripts)
- `references/systematic-debugger-subagent.md` — read-only investigation subagent dispatch template
- `scripts/find-polluter.sh` — bisect tests to find which one pollutes shared state

## Related skills

- **constellation:test-driven-development** (REQUIRED SUB-SKILL) — write the Phase 4 failing test.
- **constellation:verification-before-completion** (REQUIRED BACKGROUND) — confirm the fix with fresh evidence.
