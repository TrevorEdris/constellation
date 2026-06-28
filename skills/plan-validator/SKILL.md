---
name: plan-validator
description: Use when a PLAN.md exists and is about to be shown to a human for approval, when finishing the Plan phase, when asked "is this plan ready" or to review/score a plan, or any time a plan would otherwise be presented without a fresh validation run
---

# Plan Validator

Type: rigid (discipline). Follow exactly. The score is not advisory.

## Overview

A plan that has not been validated this session is an unvalidated plan, no matter how good it looks. Run the script, read the score, fix to PASS, record the score — in that order, every time.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO PLAN PRESENTED FOR APPROVAL WITHOUT A FRESH plan-validator PASS (>= 70)
```

"Fresh" means the script ran against the current file in THIS message. A score from before your last edit, a different file, or an eyeballed estimate does not count. PASS requires score >= 70 AND zero error-severity findings.

## When to Use

- After drafting or editing a PLAN.md, before the approval gate
- When asked whether a plan is ready, or to review/score a plan
- ESPECIALLY when the plan "obviously looks complete" or the user wants it NOW — that pressure is when gates get skipped

## Constellation gate (PLAN v2)

This validates the canonical PLAN v2 format at `docs/PLAN-TEMPLATE.md`. Beyond the script's score, three constellation requirements are HARD gates — a plan failing any of them is not PASS regardless of numeric score:

1. **PLAN v2 frontmatter** — `schema: plan/v2` plus the canonical fixed section headings (Target repo & files, Structure (phased), Ordered steps, Risks & assumptions, Verification (aggregate), Traceability, Out of scope, Git strategy). Do not rename headings.
2. **Traceability table present and populated** — a `## Traceability` section mapping every Discovery finding to a plan step. Findings with no step must be justified as out of scope. An empty or missing table fails the gate.
3. **Record the score** — write the numeric result into the PLAN frontmatter `plan_validator_score:` field (and set `traceability_complete: true` once the table is populated). The plan is not done until its own frontmatter records the PASS.

The `validate_plan.py` script already checks for a traceability table and most v2 sections. Enforcing the v2 frontmatter and the score-recording requirement directly in the script is a later phase; until then, enforce items 1 and 3 by reading the file yourself before declaring PASS.

## Process

Announce: "Using plan-validator to gate PLAN.md before approval." Then make each step below a TodoWrite entry — untracked checklists get steps skipped.

1. **Locate** the plan. Default to the current session dir `PLAN.md`; if absent, ask for the path. Do not guess.
2. **Run** the script fresh, this message:
   ```
   python3 scripts/validate_plan.py <path> --verbose
   ```
3. **Read** the full output — score, every error, every warning. Do not skim to the score line.
4. **Check the three hard gates** above by reading the file (frontmatter, traceability, score field).
5. **Fix** if NEEDS WORK (< 70) or any hard gate fails: address each error and the gate failures, then re-run from step 2. Bounded: after 3 fix-and-rerun cycles without PASS, surface the blocking findings to the human.
6. **Record** the passing score into the PLAN frontmatter `plan_validator_score:` field.
7. **Report** the final score and verdict only after a fresh PASS run.

## Red Flags — STOP

These thoughts or words mean stop and run the gate:

- "The plan obviously covers everything, no need to run it"
- "It scored 72 last time, my edits only improved it"
- "Close enough to 70" / "the warnings are minor"
- "I'll add the traceability table after they approve"
- "I'll fill in plan_validator_score later"
- About to present, summarize, or send the plan without a fresh run this message
- Reporting a score you estimated instead of one the script printed

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "It clearly looks complete" | Looks are not a score. Run the script. |
| "I ran it earlier" | Earlier is not this message. Re-run after every edit. |
| "Scored 68, close enough" | 70 is the line. 69 is NEEDS WORK. |
| "Warnings are minor" | Each warning cost points and named a real gap. Fix or justify it. |
| "Traceability is implied by the steps" | The table is a hard gate. Implied is missing. |
| "I'll record the score after approval" | The frontmatter score IS part of the deliverable. Record it first. |
| "The user is in a hurry" | Pressure is exactly when unvalidated plans ship broken work. |
| "It's just a small plan" | Small plans skip steps too. The gate is the gate. |

## Good / Bad pairs

Running the gate:
```
✅ [Run validate_plan.py --verbose] [see: Score 84/100, PASS, 0 errors] "Plan PASSES at 84"
❌ "The plan looks thorough, it should pass" — no run, no score
```

Handling a near-miss:
```
✅ Score 66 → read the 2 errors → add traceability table + branch name → re-run → 81 → record 81 in frontmatter
❌ Score 66 → "basically passing, presenting it"
```

Hard gates:
```
✅ Script says 90 but no ## Traceability table → NOT PASS → add the table → re-run → record score
❌ Script says 90 → present it, traceability missing
```

Recording the result:
```
✅ plan_validator_score: 81  (written into PLAN.md frontmatter after PASS)
❌ plan_validator_score: null  left unchanged while telling the user it passed
```

## Checks the script performs

16 checks across structure, specificity, vagueness, scope, traceability, verification, and git strategy. Errors are blocking (target repos, file paths, ordered steps); warnings deduct points (vague language, missing risks/verification, oversized code blocks, missing per-step verification, missing branch/commit/PR plan). Run with `--json` for machine-readable output. Score starts at 100; PASS is >= 70 with zero errors.

## Integration

- Called by the Plan phase of Discover → Plan → Implement: a plan must PASS here before the approval gate.
- REQUIRED SUB-SKILL: constellation:writing-plans — produces the PLAN v2 document this skill scores. If the plan does not yet follow PLAN v2, fix it there first, then validate here.
- Pairs with constellation:subagent-driven-development — only an approved, passing plan moves to execution.
- Forbidden transition: never present a plan to the human, and never begin implementation, on a plan that has not PASSED here this session.

## The Bottom Line

Run the script. Read every finding. Fix to PASS and clear the three hard gates. Record the score in the frontmatter. Only then present the plan.
