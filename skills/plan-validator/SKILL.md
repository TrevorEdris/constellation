---
name: plan-validator
description: Use when a PLAN.md exists and is about to be shown to a human for approval, when finishing the Plan phase, when asked "is this plan ready" or to review/score a plan, or any time a plan would otherwise be presented without a fresh validation run
---

# Plan Validator

Type: rigid (discipline). Follow exactly. The score is not advisory.

## Overview

A plan that has not been validated this session is an unvalidated plan, no matter how good it looks. Run the script, read every finding, fix what it names, then hand the plan to the gate for its schema — in that order, every time.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO PLAN PRESENTED FOR APPROVAL WITHOUT A FRESH plan-validator PASS (>= 70)
```

"Fresh" means the script ran against the current file in THIS message. A `card.py render` run counts as a fresh run, since it re-runs the validator. A score from before your last edit, a different file, or an eyeballed estimate does not count. PASS requires score >= 70 AND zero error-severity findings.

## When to Use

- After drafting or editing a PLAN.md, before the approval gate
- When asked whether a plan is ready, or to review/score a plan
- ESPECIALLY when the plan "obviously looks complete" or the user wants it NOW — that pressure is when gates get skipped

## Gates by schema

The plan's frontmatter `schema` picks the gate.

- **`schema: plan/v3`** (exact match; the format constellation:writing-plans writes, a v3 head over the PLAN v2 body). Every error blocks: frontmatter, card, delivery, placeholder and v2-step findings. The approval card is the gate: `card.py render` prints it only for a plan the validator passes, and its footer carries the score. No score is recorded in the plan.
- **Any other schema, or none** is a legacy plan. Its gates are under "Legacy plans (v2)". The card and delivery checks do not run on it; the v2 Brief check does, and still deducts points. Placeholder, v2-step and Traceability-row findings report as warnings that deduct nothing, plus one `legacy` warning.

## Process

Announce: "Using plan-validator to gate PLAN.md before approval." Then make each step below a TodoWrite entry — untracked checklists get steps skipped.

`<plugin root>` is the constellation plugin directory, two levels above this skill's folder; the PLAN reminder hook prints it in full.

1. **Locate** the plan. Default to the current session dir `PLAN.md`; if absent, ask for the path. Do not guess.
2. **Run** the script fresh, this message:
   ```
   python3 <plugin root>/skills/plan-validator/scripts/validate_plan.py <path> --verbose
   ```
3. **Read** the full output — score, every error, every warning. Do not skim to the score line.
4. **v3: fix** every error, then hand off to the card (constellation:writing-plans). Re-run from step 2 after each round of fixes. Bounded: after 3 fix-and-rerun cycles without PASS, surface the blocking findings to the human. **Legacy:** take the steps under "Legacy plans (v2)" in place of this one.
5. **Report** only after a fresh PASS run: for a v3 plan the card is the report, and its footer carries the score; for a legacy plan, the final score and verdict.

## Red Flags — STOP

These thoughts or words mean stop and run the gate:

- "The plan obviously covers everything, no need to run it"
- "It scored 72 last time, my edits only improved it"
- "Close enough to 70" / "the warnings are minor"
- "I'll add the traceability table after they approve"
- About to present, summarize, or send the plan without a fresh run this message
- Reporting a score you estimated instead of one the script printed
- About to run another validator on a v3 plan, such as another plugin's plan-validator or a checklist of your own. This script is the only one, and `card.py render` re-runs it.

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "It clearly looks complete" | Looks are not a score. Run the script. |
| "I ran it earlier" | Earlier is not this message. Re-run after every edit. |
| "Scored 68, close enough" | 70 is the line. 69 is NEEDS WORK. |
| "Warnings are minor" | Each warning cost points and named a real gap. Fix or justify it. |
| "Traceability is implied by the steps" | The table is a hard gate. Implied is missing. |
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
✅ Score 66 → read the 2 errors → add traceability table + branch name → re-run → 81 → PASS
❌ Score 66 → "basically passing, presenting it"
```

## Legacy plans (v2)

A plan whose `schema` is not exactly `plan/v3` is legacy, for example the `plan/v2` plans constellation:writing-plans used to write. The validator keeps its score and PASS/NEEDS WORK status exactly as before. Beyond that score, three constellation requirements are HARD gates — a legacy plan failing any of them is not PASS regardless of numeric score:

1. **PLAN v2 frontmatter** — `schema: plan/v2` plus the canonical fixed section headings (Brief, Target repo & files, Estimated PR size, Structure (phased), Ordered steps, Risks & assumptions, Verification (aggregate), Traceability, Out of scope, Git strategy). Do not rename headings. The script's `check_pr_size_estimate` warns when the size section is missing, or when a >1,000-line estimate carries no large-PR warning or split analysis.
2. **Traceability table present and populated** — a `## Traceability` section mapping every Discovery finding to a plan step. Findings with no step must be justified as out of scope. An empty or missing table fails the gate.
3. **Record the score** — write the numeric result into the PLAN frontmatter `plan_validator_score:` field (and set `traceability_complete: true` once the table is populated). The plan is not done until its own frontmatter records the PASS.

The `validate_plan.py` script already checks for a traceability table and most v2 sections. Enforcing the v2 frontmatter and the score-recording requirement directly in the script is a later phase; until then, enforce items 1 and 3 by reading the file yourself before declaring PASS.

Steps 1-3 of the Process are the same. In place of step 4:

1. **Check the three hard gates** above by reading the file (frontmatter, traceability, score field).
2. **Fix** if NEEDS WORK (< 70) or any hard gate fails: address each error and the gate failures, then re-run from Process step 2. Bounded: after 3 fix-and-rerun cycles without PASS, surface the blocking findings to the human.
3. **Record** the passing score into the PLAN frontmatter `plan_validator_score:` field.

Then report the final score and verdict, only after a fresh PASS run.

Red flag:

- "I'll fill in plan_validator_score later"

Excuse → Reality:

| Excuse | Reality |
|--------|---------|
| "I'll record the score after approval" | The frontmatter score IS part of the deliverable. Record it first. |

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

Five groups. Run with `--json` for machine-readable output. Score starts at 100; PASS is >= 70 with zero errors.

- **v2 structure** — target repos and files, ordered steps and the files and verification each names, risks, aggregate verification, vague language, oversized code blocks, scope boundary, traceability, phased structure, PR size estimate, and the git branch, commit and PR plan. Errors are blocking (target repos, file paths, ordered steps); warnings deduct points.
- **placeholders** — template slots left in the plan (`{{FIELD}}`, `<angle>` slots, `TBD`, empty table rows), and a Traceability section with no data rows.
- **v2 steps** — each `1. **(1.1)**` step under Ordered steps names a file path and a verification.
- **card** (v3) — the Brief against the card grammar: the six labels in order, the questions and the Run line, the word budgets, and the D-lines in Global Constraints.
- **delivery** (v3) — the `delivery` block list, the card's Ships-as and Size lines against it, local-only wording, and a live git probe of each repo's remote and recent commits.

The card, delivery, placeholder and v2-step groups never touch the score. Which of them run depends on the schema:

- **card and delivery** run on v3 plans only, and their findings are errors, which block. A legacy plan skips both.
- **placeholders and v2 steps** (and the Traceability-row finding) run on every plan: errors on v3, warnings on legacy, and on legacy they deduct nothing.
- **the v2 Brief check** (the Brief missing, not first, over its word budget, short of labels, or not plain language) runs on legacy plans only, in place of card, and it still deducts points as before, like the v2 structure group.

A legacy plan also gets one `legacy` warning.

Every finding prints as `[category] (audience)`, and `--json` carries the same `audience` on each issue. `human` findings (categories git, brief, card and delivery) are for the person approving, and `card.py render` prints them on the card as `Warnings for you`. Every other category is for the agent that wrote the plan: fix those first.

`card.py approve` is the other half of the gate, run by constellation:writing-plans after the user replies to the card. It classifies the reply, logs it under `## Decisions` in SESSION.md, and on approval writes the user's answers into the plan and sets `status: approved`. This skill does not run it.

## Integration

- Called by the Plan phase of Discover → Plan → Implement. A v3 plan reaches the approval gate through `card.py render`, which re-runs this validator; a legacy plan must PASS here, with its score recorded, before the approval gate.
- REQUIRED SUB-SKILL: constellation:writing-plans — produces the plan/v3 document this skill validates, and runs the card. A plan without `schema: plan/v3` is legacy; to move it to the card gate, rewrite it there.
- Pairs with constellation:subagent-driven-development — only an approved plan moves to execution: a v3 plan once `card.py approve` has set `status: approved`, a legacy plan once it has PASSED and the human has approved it.
- Forbidden transition: never present a plan to the human, and never begin implementation, on a plan that has not PASSED here this session. Never validate a v3 plan with any other validator.

## The Bottom Line

v3: run the script, fix every error, hand the plan to the card. No other validator, and no score recorded.

Legacy: run the script, read every finding, fix to PASS and clear the three hard gates, record the score in the frontmatter. Only then present the plan.
