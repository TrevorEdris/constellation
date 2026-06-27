---
name: requesting-code-review
description: Use when you have finished a task, completed a major feature, fixed a complex bug, or are about to merge to main — any point where you would otherwise move on, commit, or open a PR without an independent review of the diff
---

# Requesting Code Review

Type: rigid (discipline). Follow exactly. Do not adapt away the review gate.

## Overview

This is the dispatch wrapper for constellation:code-review: it builds the
reviewer's context and hands off the diff. The reviewer gets precisely
constructed context — git SHAs and the requirements — never your session
history. That keeps the reviewer focused on the work product instead of the
reasoning that produced it, and preserves your own context to keep working.

Core principle: review early, review often.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO PROCEEDING PAST A MANDATORY TRIGGER WITHOUT AN INDEPENDENT REVIEW OF THE DIFF
```

A mandatory trigger fires and you have not dispatched a reviewer = stop. Self-review
is not review. "It's simple" is not an exemption. Reading your own diff again is not
an independent review.

## When to Request Review

Mandatory (do not proceed without it):
- After each task in subagent-driven development
- After completing a major feature
- Before merge to main

Optional but valuable:
- When stuck (fresh perspective)
- Before a large refactor (baseline check)
- After fixing a complex bug

## How to Request

1. Get git SHAs — the reviewer works from these, not your narration:
```bash
BASE_SHA=$(git rev-parse HEAD~1)   # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

2. Dispatch the reviewer with the `Task` tool, filling the template at
   `references/code-reviewer-prompt.md`. Placeholders:
   `{DESCRIPTION}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}`, `{HEAD_SHA}`.
   - Pin the reviewer's scope to the diff: it must run `gh pr diff --name-only`
     (or `git diff --name-only BASE_SHA..HEAD_SHA`) and review ONLY those files.
     This stops reviewers from drifting into merged worktree code or unrelated
     modules.
   - The template instructs the reviewer to distrust the implementer's summary and
     verify the diff line by line against the requirements — this is what catches
     false-green completions.
   - If launched via the `Workflow` tool, use `agentType` Explore or omit it (never
     `general-purpose`), and do not force `model: opus`.

3. Act on feedback by severity:

| Severity | Action |
|----------|--------|
| Critical | Fix immediately. Do not proceed, commit, or merge until resolved. |
| Important | Fix before moving to the next task. |
| Minor | Note for later; may proceed. |

   If the reviewer is wrong, push back with technical reasoning — show the code or
   the failing-then-passing test that proves it. Do not silently comply, and do not
   silently ignore.

## Red Flags — STOP

These thoughts mean a trigger fired and you are about to skip the gate:
- "It's simple, skip review"
- "I already read it, that counts as review"
- "I'll proceed and fix the Important issue later"
- "The Critical issue is probably fine in practice"
- "I'll let the reviewer read the whole repo / merged branch" (scope creep)
- "I'll paste my session history so the reviewer has context" (pollutes the review)
- About to commit / push / open a PR / start the next task with no fresh review

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "It's too simple to review" | Simple changes break things too. Dispatch the reviewer. |
| "I reviewed it myself" | Self-review is not independent. The author is blind to their own gaps. |
| "I'll batch the review later" | Issues compound. Review each task before the next. |
| "Reviewer flagged it but it works" | Prove it: show the code/test. Then push back — don't ignore. |
| "Important issues can wait" | "Later" never comes. Fix before proceeding. |
| "I'll just give it my whole context" | Constructed context (SHAs + requirements) only. History pollutes judgment. |
| "Let the reviewer look at everything" | Pin to `gh pr diff --name-only`. Out-of-scope review is noise. |

## Good / Bad pairs

Dispatch context:
```
✅ BASE_SHA + HEAD_SHA + requirements + "review only `gh pr diff --name-only`"
❌ "Here's my whole session; tell me what you think of the changes"
```

Acting on feedback:
```
✅ Critical found → fix now → re-verify → only then proceed
❌ "Critical noted, I'll circle back" → moves to next task
```

Pushing back:
```
✅ "This isn't a bug — test X drives the real path and fails when reverted: [output]"
❌ Silently dismiss the finding, or silently rewrite the code anyway
```

## Tracking

Make the dispatch and each resulting Critical/Important issue a TodoWrite entry.
Untracked review findings get skipped — every time.

## Integration

- REQUIRED SUB-SKILL: constellation:code-review — the reviewer this skill
  dispatches; supplies the review framework and severity rubric.
- Called by constellation:subagent-driven-development — review after each task,
  and by constellation:executing-plans — review after each batch.
- Pairs with constellation:receiving-code-review — how to triage and act on the
  feedback returned.
- REQUIRED BACKGROUND: constellation:verification-before-completion — the
  false-green countermeasure (tests must drive the real path) the reviewer applies.

## The Bottom Line

A trigger fires → build the context → dispatch the reviewer pinned to the diff →
act by severity. No proceeding without it.
