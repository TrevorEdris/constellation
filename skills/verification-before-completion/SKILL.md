---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, done, passing, or working — before committing, opening a PR, marking a task done, moving to the next task, or trusting a subagent's success report; also when you catch yourself about to write "Great!", "Perfect!", "should work", or any wording implying success
---

# Verification Before Completion

Type: rigid (discipline). Follow exactly. Do not adapt away the gate.

## Overview

Claiming work is complete without fresh evidence is dishonesty, not efficiency.

Core principle: evidence before claims, always.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the verification in THIS message, you cannot claim it passes. A run from an earlier message, a different file, or "before my last edit" does not count.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY  What command or observation proves this claim?
2. RUN       Execute the REAL thing, fresh and complete:
             run the app/command and observe actual behavior,
             or run the full test suite. Reasoning is not running.
3. READ      Full output. Check exit code. Count failures.
4. VERIFY    Does the observed output confirm the claim?
             - NO  -> state the actual status, with evidence
             - YES -> state the claim, with the evidence attached
5. ONLY THEN make the claim.

Skip a step = lying, not verifying.
```

The RUN step is the load-bearing one: the executable evidence the gate demands is real, observed behavior — run the application and watch it do the thing, not a prediction that it would. Tests are the test-level form of this evidence; see REQUIRED BACKGROUND below.

## Claim → Requires → Not Sufficient

| Claim | Requires | NOT sufficient |
|-------|----------|----------------|
| Feature works | Ran the app, observed the actual behavior this message | Tests pass, code looks right, "should work" |
| Bug fixed | Reproduced original symptom, then saw it gone | Code changed, assumed fixed |
| Tests pass | Test command output: 0 failures, this message | Previous run, partial run, "should pass" |
| Test proves behavior | Test FAILS when the real code is broken (revert/mutate to confirm) | Test passes against a fake, mock, or injected state |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs "look good" |
| Requirements met | Line-by-line checklist against the spec | Tests passing |
| Subagent completed | VCS diff shows the actual changes | Agent reports "success" |

## False-green countermeasure

A passing test proves nothing if it never exercises the real path. Before trusting a green suite: confirm the test drives production code, not a fake, mock, or pre-seeded state. The cheap proof — break the real code (revert the fix or mutate a line) and watch the test go red. A test that stays green when the implementation is broken is not evidence.

## Red Flags — STOP

These thoughts or words mean stop and run the gate:

- "should", "probably", "seems to", "looks correct"
- "Great!", "Perfect!", "Done!", "All set!" — any satisfaction before verification
- About to commit, push, or open a PR without a fresh run
- Trusting a subagent's success report instead of the diff
- Relying on a partial or earlier run
- "Just this once" / "I'm confident" / tired and wanting it over
- **ANY wording implying success when you have not run verification THIS message**

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN it. Observe the result. |
| "I'm confident" | Confidence is not evidence. |
| "Just this once" | No exceptions. The gate is the gate. |
| "Linter passed" | Linter is not the compiler is not the app. |
| "Tests pass, so the feature works" | Run the app. Tests can pass against fakes. |
| "The subagent said success" | Verify the diff independently. |
| "I'm tired" | Exhaustion is not an exemption. |
| "Partial check is enough" | Partial proves nothing about the rest. |
| "Different words, so the rule doesn't apply" | Spirit over letter. Paraphrases count. |

## Good / Bad pairs

Feature:
```
✅ [Run the app / hit the endpoint] [observe: returns 200 with the new field] "Feature works — here is the output"
❌ "The handler is wired up, so it works"
```

Tests:
```
✅ [Run test command] [see: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

Regression test (red-green proof):
```
✅ Write test → run (pass) → revert the fix → run (MUST fail) → restore → run (pass)
❌ "I've written a regression test" without the red-green proof
```

Build:
```
✅ [Run build] [see: exit 0] "Build passes"
❌ "Linter passed" — linter does not check compilation
```

Subagent delegation:
```
✅ Agent reports success → check VCS diff → verify changes → report actual state
❌ Trust the agent's report
```

## Scope — the rule extends to paraphrases

It applies to exact phrases, synonyms, implications of success, and ANY communication suggesting the work is complete or correct. You cannot route around it by rewording.

Apply ALWAYS before: any success/completion claim, any expression of satisfaction, committing, PR creation, marking a task done, moving to the next task, or delegating to a subagent.

## Tracking

If the work has a verification checklist (suite, lint, build, run-the-app, requirements), make each item a TodoWrite entry. Untracked checklists get steps skipped — every time.

## Why this matters

A false completion claim breaks trust and ships broken work: undefined functions that crash, missing requirements, hours lost to rework after a "done" that was not. When a partner says "I don't believe you," the verification gate is what would have prevented it. Honesty is the value; the gate is the mechanism.

## Integration

- REQUIRED BACKGROUND: constellation:test-driven-development — supplies the test-level evidence (RED-GREEN-REFACTOR) the gate runs, and the red-green proof that a test actually fails when the code is broken.
- Pairs with the workspace verify-by-running rule: no completion claim without fresh, observed, in-message evidence.

## The Bottom Line

Run the real thing. Read the output. THEN claim the result. Non-negotiable.
