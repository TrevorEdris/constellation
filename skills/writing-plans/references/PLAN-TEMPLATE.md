---
schema: plan/v2
date: {{DATE}}
slug: {{SLUG}}
status: draft            # draft | awaiting-approval | approved | in-progress | complete
plan_validator_score: null   # 0-100, PASS >= 70 (filled by plan-validator)
traceability_complete: false
targets:
  - repo: <path-or-name>
    branch: <branch>
tags: []
---

# PLAN — <title>

> Canonical PLAN v2 format. Machine-readable frontmatter + fixed section names so plans parse programmatically. Heading names below are canonical — do not vary them.

## Brief
> For the human reviewer. Max 120 words. Plain language: no code, no file names, no step numbers. Write it LAST, after the validator and reviewer loops settle. Living: rewrite it whenever the plan's outcome, changes, or decisions change.

**Delivers:** <1-2 sentences: the user-visible outcome when this plan is done>

**Changes:**
- <3-5 bullets, grouped by area, in words a teammate outside the session would follow>

**Decisions made for you:**
- <fork> → <choice> — <why>   (write "None." when the planner resolved no forks)

## Target repo & files
Explicit repos and every file to be touched (New / Modified). Exact paths, not vague areas.

## Estimated PR size
Forecast total line delta (added + removed) for the PR this plan produces, with a per-area breakdown. Estimate from the New/Modified file list and the code in the Ordered steps — a forecast, not a git diff.

| Area / file group | Est. lines added | Est. lines removed |
|---|---|---|
| | | |
| **Total** | | |

**Estimated PR size: <N> lines.**

If the total exceeds 1,000 lines, a `> ⚠️ Large PR` warning block and a split analysis are REQUIRED here, and the split decision (confirmed/declined + why) recorded. See constellation:writing-plans.

## Architecture decision
Only if a genuine fork exists. State options, recommend one, mark the assumed default.

## Structure (phased)
| Phase | Delivers | Depends On | Enables |
|---|---|---|---|
| P1 | | — | |
**Critical path:** ...

## Ordered steps
Numbered, atomic (2-5 min), each with an exact file path and a per-step verification action. Tag behavioral steps `[RED→GREEN]`; tag config/docs/codegen `[exempt: ...]`.

### Phase 1 — <name>
1. **(1.1)** ... Verify: ...

## Risks & assumptions
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

Assumptions: ...

## Verification (aggregate)
Test/lint/build/manual checks that confirm the whole plan.

## Traceability
| Discovery finding | Plan step |
|---|---|

Findings with no plan step must be justified as out of scope.

## Out of scope
Explicit non-goals / deferred work.

## Git strategy
Branch, atomic conventional commit checkpoints with messages, anticipated PR title + description. Check `.github/PULL_REQUEST_TEMPLATE.md`. Never push to main without approval.
