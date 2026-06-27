---
name: refactoring
description: "Use when code needs structural cleanup without behavior change — messy or duplicated code, long methods, god objects, dead code, tight coupling, primitive obsession, feature envy, or prepping a module before adding a feature. Triggers: refactor this, clean up this code, code smells, extract method, reduce complexity, this code is messy, too much coupling, simplify this, pay down tech debt."
---

# Refactoring

Refactoring changes structure, never behavior. The only proof that behavior is preserved is a test suite that was green before the change and stays green after. No green suite, no refactoring.

## The Iron Law

```
TESTS GREEN BEFORE EVERY CHANGE, TESTS GREEN AFTER EVERY CHANGE. RED = REVERT.
```

If the suite is not green, you do not have a baseline — establish one (or write characterization tests) before touching anything. After each atomic transform, run the suite. If it goes red, revert immediately (`git checkout -- <files>` or `git stash`); do not "fix forward."

**Violating the letter of the rules is violating the spirit of the rules.** "Refactoring while adding a small fix" is not refactoring — it is an untested behavior change wearing a refactor's commit message.

## Which parts are rigid vs. flexible

- **Flexible (use judgment):** which smells matter, which technique to apply, what order, how deep to go. The catalogs are heuristics, not commandments.
- **Rigid (no judgment):** the execution loop — green baseline, one atomic transform, re-run suite, revert on red, one smell per commit, no behavior change mixed in. This is the grafted discipline; it does not bend under time pressure.

## When to use

- Code is hard to read, change, or test and you are NOT adding a feature in the same pass.
- Paying down tech debt in a specific module.
- Reducing complexity before a feature lands (do the refactor first, commit it, THEN build the feature).
- Use this ESPECIALLY when tempted to "just clean up while I'm in here" mid-feature — stop, refactor separately, with tests green.

## When NOT to use

- No tests and no time/permission to write characterization tests — you cannot prove behavior preservation. Surface this; do not refactor blind.
- The change alters observable behavior — that is a feature/bugfix. Use constellation:test-driven-development (REQUIRED SUB-SKILL) instead; refactor after.
- A god-object or interface-segregation decomposition that affects callers outside scope — flag as `[Design Discussion]` and get user alignment first.

## Excuse | Reality

| Excuse | Reality |
|--------|---------|
| "It's just a rename, no need to run tests." | Renames break imports, reflection, serialization, configs. Run the suite. |
| "I'll batch these five refactorings into one commit." | When it breaks, you cannot bisect which transform did it. One smell per commit. |
| "Tests are slow; I'll run them once at the end." | A break at the end means re-deriving which of N transforms caused it. Run after each. |
| "I'll fix this bug while I'm refactoring this function." | Now you cannot tell a structure change from a behavior change. Two commits, behavior first or after, never mixed. |
| "There are no tests, but I'm confident this is behavior-preserving." | Confidence is not a baseline. Write characterization tests or do not refactor. |
| "The suite is already red on an unrelated test; I'll proceed." | A red baseline hides regressions your change introduces. Get to green first. |
| "Reverting loses my work; let me debug the failure instead." | Debugging forward turns a 2-minute revert into an hour and an untrusted diff. Revert, re-approach smaller. |
| "I'll skip the plan and start fixing the obvious smells." | Some refactorings enable others; wrong order causes rework. Triage and order first. |

## Red Flags — STOP

If you catch yourself thinking any of these, stop and return to the Iron Law:

- "I'll just run the affected tests, not the whole suite."
- "This refactor and this behavior tweak go together naturally."
- "I'll commit all the cleanups at once to keep the log tidy."
- "No tests here, but it's a trivial change."
- "Tests are red but that's pre-existing, I'll keep going."
- "Let me push through the failure instead of reverting."
- "I'll change the public API while I'm restructuring internals."

## Process

Announce: "Using refactoring to [scope/goal]." Track each phase and each approved transform as a TodoWrite item — untracked checklists get skipped.

### Phase 1 — Reconnaissance
- Scope: user-named files/dirs, or derive from `git diff --stat`.
- Run language-appropriate detection tools (see `references/DETECTION_TOOLS.md`).
- Catalog every smell with `file:line` (see `references/CODE_SMELLS.md`).
- Triage each: `[Design Discussion]` (needs alignment), `[Active Smell]` (do this pass), `[Quick Fix]` (low-risk cleanup).

### Phase 2 — Plan (approval gate)
- Map each smell to a technique (see `references/REFACTORING_TECHNIQUES.md`).
- Order by dependency (e.g., Extract Method before Move Method).
- Estimate effort: S (<30 min), M (<2 hrs), L (multi-session).
- Flag risks: missing tests, shared interfaces, callers outside scope.
- **Present the plan. Wait for explicit user approval before changing any code.**

### Phase 3 — Execution (the rigid loop)
For each approved item, in order:
1. Confirm the suite is green (baseline). If not green, stop — fix the baseline or write characterization tests first.
2. Apply ONE atomic transform — smallest meaningful diff.
3. Run the FULL suite (not just affected tests).
4. Green → commit with a precise message (`refactor: extract validatePayload from processRequest`).
5. Red → revert immediately, report, re-approach smaller or skip.

One smell per commit. Never mix a behavior change into a refactor commit.

### Phase 4 — Verification
- Run the full suite end to end (fresh, this message).
- Confirm tests drive the REAL code path, not fakes or injected state — a transform that only passes because a mock absorbed it is a false green. Spot-check by breaking the refactored code and confirming a test fails.
- Compare before/after metrics where tooling exists (cyclomatic complexity, file/line counts).
- Confirm `git log` shows atomic, clearly-labeled commits.
- Summarize what changed and what was deferred. Suggest constellation:code-review for post-refactor validation.

## Verification gate

You may not claim a refactoring is done until you have run the full suite in THIS message and seen it pass. "Tests should still pass," "this is behavior-preserving so it's fine," and "I ran them earlier" are not evidence. Paste the run output. Confirm at least one refactored path is covered by a test that actually fails when the code is broken — see constellation:verification-before-completion (REQUIRED BACKGROUND).

## Good / Bad

✅ Good — atomic, tested, single concern:
```
# baseline green
$ npm test  # 142 passing
# extract one method
$ git commit -m "refactor: extract validateAddress from submitOrder"
$ npm test  # 142 passing
```

❌ Bad — bundled, behavior change smuggled in:
```
$ git commit -m "refactor: clean up order module"
# diff: extracted 3 methods, renamed a class, AND changed a tax rounding rule,
# tests run once at the end — now which change broke the rounding test?
```

✅ Good — no tests, so lock behavior first:
```
# target code has no coverage
# write characterization tests capturing CURRENT output (even if "wrong")
$ npm test  # new tests green → baseline established
# now refactor against them
```

❌ Bad — refactoring blind:
```
# no tests, no characterization tests
# "I'm confident extract-method preserves behavior" → ships a silent regression
```

## Delegation

For a focused, isolated pass, dispatch the `refactoring-specialist` agent (constellation:dispatching-parallel-agents, REQUIRED SUB-SKILL for the dispatch protocol). Paste the full scope, the smell triage, and the baseline test status into the prompt — do not tell it to "go read the plan." Require it to report per the agent's fixed Report Structure and to honor this Iron Law.

## Integration

- Pairs with constellation:test-driven-development (REQUIRED SUB-SKILL) — same green-suite discipline; use TDD when the change is behavioral, refactoring when it is structural.
- Pairs with constellation:verification-before-completion (REQUIRED BACKGROUND) — fresh-evidence gate for the final claim.
- Hands off to constellation:code-review after refactoring for an independent quality check.
- Forbidden transition: do not refactor and ship a feature in the same commit or branch step.

## References

- `references/CODE_SMELLS.md` — full smell catalog with detection indicators.
- `references/REFACTORING_TECHNIQUES.md` — technique catalog with before/after examples.
- `references/DETECTION_TOOLS.md` — language-specific detection tooling.
- Agent: `agents/refactoring-specialist.md` — the dispatched specialist for isolated passes.
