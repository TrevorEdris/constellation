---
schema: plan/v3
date: {{DATE}}
slug: {{SLUG}}
status: draft
delivery:
  - repo: <absolute path to the repo>
    mode: pr
    branch: <branch>
    base: main
    remote: origin
    prs: 1
tags: []
---

# PLAN: <title>

> Template: Canonical PLAN v3 format. Machine-readable frontmatter (no inline comments) + fixed section names so plans parse programmatically. `status` is one of draft, awaiting-approval, approved, in-progress, complete. `delivery` has one block-list item per repo; `mode` is pr, stack or `local-only`. Heading names below are canonical: do not vary them.

## Brief
> Template: The approval card the user reads and answers. Plain language: no code, no file names, no step numbers. At most 3 questions plus Run, and at most 3 Made-for-you items. Keep the ask line plus this Brief to 120 words with the check time. Write it LAST. Living: rewrite it whenever the plan's outcome, a question or a decision changes.

**Needs your call:**
1. <question>? → **<default>** (<why>; if wrong: <cost>)
2. Run → **subagent-driven** (<why>; or inline)
**Ships as:** 1 PR, <branch> → <remote>/<base>
**Delivers:** A <user> can <action>.
**Size:** ~<N> lines · <N> files · <N> tasks · 1 PR
**Made for you:**
- D2 <decision> (if wrong: <cost>)
**Flags:** none

---
> **For agentic workers:** REQUIRED SUB-SKILL: constellation:subagent-driven-development (inline: its references/executing-plans). Run is answered on the card.

## Global Constraints
> Template: One D-line per decision. An [ask] becomes a numbered card question with the same default. A [made] is a decision the planner took; list the costliest under Made for you. Add Do-not-change and Out-of-scope lines when they bind the work.

- D1 [ask] <question>? Default: <default>. Why: <why>. If wrong: <cost>.
- D2 [made] <decision>. Why: <why>. If wrong: <cost>.

## Target repo & files
> Template: Explicit repos and every file to be touched (New / Modified). Exact paths, not vague areas.

## Estimated PR size
> Template: Forecast total line delta (added + removed) for the PR this plan produces, with a per-area breakdown. Estimate from the New/Modified file list and the code in the Ordered steps — a forecast, not a git diff.

| Area / file group | Est. lines added | Est. lines removed |
|---|---|---|
| | | |
| **Total** | | |

**Estimated PR size: <N> lines.**

> Template: If the total exceeds 1,000 lines, a `> ⚠️ Large PR` warning block and a split analysis are REQUIRED here, and the split decision (confirmed/declined + why) recorded. See constellation:writing-plans.

## Architecture decision
> Template: Only if a genuine fork exists. State options, recommend one, mark the assumed default. Delete this section when there is no fork.

## Structure (phased)
| Phase | Delivers | Depends On | Enables |
|---|---|---|---|
| P1 | | — | |
**Critical path:** ...

## Ordered steps
> Template: Numbered, atomic (2-5 min), each with an exact file path and a per-step verification action. Tag behavioral steps `[RED→GREEN]`; tag config/docs/codegen `[exempt: ...]`.

### Phase 1 — <name>
1. **(1.1)** ... Verify: ...

## Risks & assumptions
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

Assumptions: ...

## Verification (aggregate)
> Template: Test/lint/build/manual checks that confirm the whole plan.

## Traceability
| Discovery finding | Plan step |
|---|---|

> Template: Findings with no plan step must be justified as out of scope.

## Out of scope
> Template: Explicit non-goals / deferred work.

## Git strategy
> Template: Branch, atomic conventional commit checkpoints with messages, anticipated PR title + description. Check `.github/PULL_REQUEST_TEMPLATE.md`. Never push to main without approval.
