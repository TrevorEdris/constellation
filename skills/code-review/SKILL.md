---
name: code-review
description: Use when reviewing a pull request or diff, giving PR feedback, validating an implementation against a Jira ticket or spec, after completing a feature or task, before merging to main, or whenever you need a fresh set of eyes on changes before they ship
---

# Code Review

Type: flexible (pattern). Adapt the framework to the change; do not skip the adversarial verification.

## Overview

A review confirms the change is a net improvement to code health AND does what the requirements demand. Net positive over perfection — do not block on imperfections when the change improves the codebase, but never wave through unmet requirements or false-green tests.

Core principle: do not trust the implementer's report. Read the changed code line by line against the requirements.

## When to use

Mandatory:
- Before merging to main.
- After completing a feature or a discrete task (including each task in subagent-driven development).
- When validating an implementation against a Jira ticket, spec, or plan.

Optional but valuable:
- When stuck (fresh perspective), before a refactor (baseline), after fixing a complex bug.

Never skip a review because "it's simple" — the simple-looking diff is where the missing edge case hides.

## Step 1 — Pin the scope

Review only what changed. Establish the file set and diff up front and stay inside it:

```bash
gh pr diff --name-only            # files in this PR — the review boundary
gh pr diff                        # the diff to review
# local branch, no PR:
git diff --name-only origin/HEAD...
git diff --merge-base origin/HEAD
```

Do not review merged worktree code, unrelated files, or the whole repo. If a finding sits outside `gh pr diff --name-only`, it is out of scope — note it separately, do not review it.

Optionally run `scripts/diff-analysis.py --staged` (large files, new deps, test-vs-impl ratio, secret patterns) and `scripts/pr-context.sh <pr>` to orient.

## Step 2 — Validate against requirements FIRST

Build the right thing before judging how well it is built.

- Fetch the spec/plan; if Atlassian MCP is connected, fetch the linked ticket. `scripts/extract-ticket-ids.sh <pr>` pulls Jira IDs from the PR title, body, and branch.
- For each acceptance criterion, find the file:line that satisfies it — or mark it MISSING.
- Flag scope creep: changes with no corresponding requirement.

## Step 3 — Review with the Pragmatic Quality framework

Apply `references/REVIEW_CHECKLIST.md` in priority order: Architecture, Correctness, Security (non-negotiable), Maintainability, Testing, Performance, Dependencies. The full framework and report structure live in `references/pragmatic-code-review.md`. Prefix optional polish with "Nit:".

## Step 4 — Distrust the tests (false-green countermeasure)

A passing suite proves nothing if it never exercises the real path. For the tests in the diff, confirm they drive production code, not fakes, mocks, or pre-seeded state. The proof: a test that would still pass if the implementation were reverted or mutated is not evidence — call it out by name. This is the dominant ship-breaker; do not skip it.

## Severity tiers and the action they demand

| Tier | Meaning | Action |
|------|---------|--------|
| Critical | Bug, security hole, data loss, broken/missing required behavior, false-green test | Fix before merge |
| Important | Architecture problem, poor error handling, test gap, missing edge case | Fix before proceeding |
| Minor / Nit | Style, naming, optional optimization, docs | Note for later |

Categorize by actual severity. Not everything is Critical; do not bury a Critical as Minor.

## Dispatching a reviewer subagent

To preserve your context or get an independent pass, dispatch a Task subagent with the fill-in template at `references/reviewer-prompt.md`. Paste the FULL requirement/spec/ticket text and the base/head SHAs into the prompt — never tell the subagent to "read the plan" and never pass your session history. The template carries the adversarial stance, the scope pin, and the fixed report format. See `references/requesting-code-review/` for the dispatch discipline and SHA setup.

## Report format

```
### Strengths
- [specific, file:line]

### Findings
#### Critical
- [file:line] — what is wrong, why it matters, how to fix
#### Important
- [file:line] — what is wrong, why it matters, how to fix
#### Minor
- [file:line] — what is wrong

### Requirements coverage
- [criterion] → [file:line, or MISSING]

### Assessment
Ready to merge? Yes / No / With fixes — reasoning in 1-2 technical sentences
```

`references/feedback-templates.md` has reusable phrasings for blocking issues, suggestions, questions, and ticket-alignment notes.

## Good / Bad pairs

Verdict:
```
✅ "Ready to merge: With fixes. Two Critical (auth check missing on PATCH /users:42; test at users_test:88 passes against a stubbed repo)."
❌ "Looks good!" — no evidence, no requirement check
```

Severity:
```
✅ Critical: SQL built by string concat (db.go:31) — injection vector. Important: no pagination (api.go:55).
❌ Everything marked Critical, or the injection filed as Minor.
```

Requirements:
```
✅ "AC-3 (rate limiting) → MISSING. No limiter in the diff."
❌ Reviewing only style and never checking the ticket.
```

## Acting on feedback you receive

When you are on the receiving end of review, do not perform agreement — verify before implementing, push back with technical reasoning when a suggestion is wrong or breaks existing behavior, and fix Critical first, Important next, Minor as noted. See REQUIRED SUB-SKILL constellation:receiving-code-review.

## Integration

- `references/requesting-code-review/` — how to dispatch the reviewer with constructed context and git SHAs.
- REQUIRED SUB-SKILL: constellation:receiving-code-review — how to respond to and act on review feedback without performative agreement.
- Pairs with constellation:verification-before-completion — the false-green countermeasure and run-the-real-path evidence standard.
- References the Pragmatic Quality reviewer in `references/pragmatic-code-review.md`.
