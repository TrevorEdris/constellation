---
schema: plan/v2
date: YYYY-MM-DD
slug: <session-slug>
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

## Target repo & files
Explicit repos and every file to be touched (New / Modified). Exact paths, not vague areas.

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
