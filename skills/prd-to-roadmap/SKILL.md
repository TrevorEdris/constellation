---
name: prd-to-roadmap
description: Use when an approved or validated PRD exists and the next move is breaking it into phases — symptoms include a PRD handed off from Product, "turn this PRD into a plan", "create a roadmap from requirements", "decompose this into milestones", or starting a new project that needs phased sequencing before any specs or code.
---

# PRD to Roadmap

Type: flexible (pattern). Adapt the phasing to the project; the validation gate and the two structural rules are non-negotiable.

## Overview

A roadmap turns "what to build" into "in what order, delivering what to the user each step." It names FEATURES per phase, not pull requests. Decompose only as far as a user-visible slice — leave PR breakdown to spec time.

## The gate (non-negotiable)

```
NO ROADMAP FROM A PRD THAT HAS NOT PASSED prd-validator (score >= 70) THIS SESSION
```

Run the validator yourself before you write a single phase. A roadmap built on an incomplete or vague PRD inherits every gap and amplifies it across phases.

```
python3 ../prd-validator/scripts/validate_prd.py <path-to-PRD> --verbose
```

If the score is NEEDS WORK (< 70), STOP. Report the failing findings and route the user back to fix the PRD (constellation:prd-author) and re-validate (constellation:prd-validator, REQUIRED SUB-SKILL). Do not proceed on a draft.

## Two rules that shape every roadmap

1. **Roadmaps name FEATURES per slice, never PRs.** Each phase entry is a user-facing capability (`P1-A: User can reset password`), not an engineering task list (`Add reset endpoint`, `Wire email`). PR decomposition happens later, at spec time.
2. **PR decomposition is deferred.** The roadmap stops at the feature + a short implementation checklist. It does not pre-plan branches, commits, or PR boundaries. That belongs to the spec/plan stage downstream.

## When to use

- An approved PRD exists and you are moving from requirements to a delivery plan.
- Planning a new project that needs phases and dependency ordering before specs.
- Use this BEFORE writing any spec or plan — the roadmap is the parent of those.

## When NOT to use

- No PRD yet, or only a rough idea — author one first (constellation:prd-author).
- The PRD has not passed validation — gate first; do not skip it because the PRD "looks fine".
- You already have a roadmap and need step-level implementation detail — go to constellation:writing-plans.

## Process

Announce: "Using prd-to-roadmap to phase <PRD>." Then make each step below a TodoWrite entry — untracked checklists drop steps.

1. **Gate.** Run the validator fresh, this message (command above). Proceed only on PASS (>= 70). Report and stop otherwise.
2. **Extract.** Pull from the PRD: every functional requirement (FR-NNN) with priority and acceptance criteria, every non-functional requirement (NFR-NNN), any phase structure the PRD defines, requirement dependencies, and cross-cutting constraints.
3. **Decompose into phases.** Group requirements by these principles:
   - Priority first — must-have requirements land in earlier phases.
   - Dependencies respected — if FR-003 needs FR-001, FR-001's phase is earlier.
   - User-visible milestones — each phase delivers something a user can try.
   - Vertical slices — no phase that is purely "backend" or "infra" with nothing visible.
   - Assign feature IDs `P{phase}-{letter}` (P0-A, P0-B, P1-A, ...).
4. **Detail each feature.** For every feature produce: **What** (PRD requirement in plain language), **Depends on** (feature IDs or "Nothing"), **Risk** (from the PRD or surfaced by decomposition), optional **Note**, and a **Checklist** of 5-10 implementation sub-tasks each ending in a verification action. Keep the checklist at feature granularity — do not split it into PRs.
5. **Write ROADMAP.md.** Follow `references/roadmap-template.md`: Current Status, Philosophy (ask the engineer or infer), per-phase sections with entry/exit criteria and a one-sentence italic Deliverable, Cross-Cutting Concerns (from NFRs), Dependency Summary table, and an empty Spec Index. Write to `ROADMAP.md`, or `docs/planning/ROADMAP.md` if a `docs/` directory exists.
6. **Confirm.** Present to the engineer: phase count and feature distribution, the critical path (longest dependency chain), and any PRD requirements that did not map cleanly (ambiguous, too large, conflicting).

## Concrete shape

Feature entry (one phase, one capability):

```markdown
### P1-A: User can reset a forgotten password

- **What:** Logged-out user requests a reset link by email and sets a new password. (FR-007)
- **Depends on:** P0-B (auth tables)
- **Risk:** Email deliverability; rate-limit reset requests to prevent abuse.
- **Checklist:**
  - [ ] Reset-request flow: token issued, stored hashed, expires in 1h
  - [ ] Reset-email template + send path
  - [ ] Reset-confirm flow: validate token, update credential
  - [ ] Verify: end-to-end reset works and expired tokens are rejected
```

✅ Good — `P1-A` is a thing a user can do; the checklist is feature-scoped.
❌ Bad — phasing the work as `P1-A: Add reset endpoint`, `P1-B: Add email service`, `P1-C: Open PR for token model`. Those are tasks and PRs, not user-facing features; they belong in specs.

❌ Bad — a "Phase 1: Backend" with no deliverable a user can try. Re-slice vertically.

## Red flags — STOP and re-slice

- "I'll just skip the validator, the PRD obviously passed." — Run it. The gate is the point.
- "Let me name the phases by component (backend, frontend, infra)." — That is a horizontal slice; re-slice by user capability.
- "I'll pre-plan the PRs and commits in the roadmap." — Defer that to spec time; the roadmap names features.
- "This phase has no user-visible deliverable but it's necessary." — Fold it into the slice it enables, or state the deliverable.

## Integration

- **Upstream:** constellation:prd-author (writes the PRD), constellation:prd-validator (REQUIRED SUB-SKILL — the gate this skill runs).
- **Downstream:** the ROADMAP feeds spec authoring and then constellation:writing-plans for step-level implementation plans. The only artifacts that decompose features into PRs live there, never here.

## References

- `references/roadmap-template.md` — canonical ROADMAP.md format: feature descriptions plus implementation checklists, with feature-ID convention and audience guide.
