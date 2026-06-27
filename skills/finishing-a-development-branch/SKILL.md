---
name: finishing-a-development-branch
description: Use when implementation is done and you must decide how to integrate the work — about to merge, push, open a PR, delete a branch, clean up a worktree, or are asked "are we done / what's next" after the last task or batch completes
---

# Finishing a Development Branch

Type: rigid (discipline). Follow exactly. Do not adapt away the gate or the option set.

## Overview

Finishing means a clean, verified integration of completed work — never a guess at intent.

Core principle: verify tests → determine base → present exactly four options → execute the chosen one → clean up correctly.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO INTEGRATION ACTION WITHOUT GREEN TESTS AND AN EXPLICIT USER CHOICE
```

You do not merge, push, open a PR, or delete anything until: (1) the full test suite passed in THIS message, and (2) the user picked one of the four options. Inferring the choice, or skipping the test run because "it passed earlier," violates the law.

## The Process

### Step 1: Verify tests (gate)

Announce: "Using finishing-a-development-branch to complete this work."

Run the project's full suite this message and read the output:

```bash
npm test   # or: cargo test | pytest | go test ./...
```

- Any failure: STOP. Report the failures. Do not proceed to Step 2.
- 0 failures, this message: continue.

This is the verification gate. A run from an earlier message does not count. See REQUIRED BACKGROUND below.

### Step 2: Determine the base branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

If ambiguous, ask: "This branch split from <base> — correct?" Do not assume.

### Step 3: Present exactly four options

Present these four, verbatim, with no added explanation:

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

Never collapse to "what next?", never add a fifth option, never recommend one. Wait for the user.

### Step 4: Execute the chosen option

#### Option 1 — Merge locally

```bash
git checkout <base-branch>
git pull
git merge <feature-branch>
<test command>          # re-run the suite ON the merged result
git branch -d <feature-branch>   # only after merge tests pass
```

If post-merge tests fail: STOP, report, do not delete the branch. Then cleanup worktree (Step 5).

#### Option 2 — Push and create PR

```bash
git push -u origin <feature-branch>
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

Keep the worktree (the PR is in flight). Then Step 5.

#### Option 3 — Keep as-is

Report: "Keeping branch <name>. Worktree preserved at <path>." Do not clean up anything.

#### Option 4 — Discard (typed confirmation required)

Show exactly what will be destroyed, then require a typed confirmation:

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for the literal word `discard`. Anything else (including "yes", "y", "go ahead") is NOT confirmation — re-ask or abort. Only on exact match:

```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then Step 5.

### Step 5: Worktree cleanup

Check whether the branch lives in a worktree:

```bash
git worktree list | grep "$(git branch --show-current)"
```

Clean up per the matrix — never automatically for Options 2 and 3:

| Option | Merge | Push | Cleanup branch | Cleanup worktree |
|--------|-------|------|----------------|------------------|
| 1. Merge locally | yes | — | yes (`-d`) | yes |
| 2. Create PR | — | yes | — | NO (PR in flight) |
| 3. Keep as-is | — | — | — | NO |
| 4. Discard | — | — | yes (`-D` force) | yes |

```bash
git worktree remove <worktree-path>   # Options 1 and 4 only
```

## Red Flags — STOP

These thoughts mean stop and follow the process:

- "Tests passed earlier, no need to re-run" — re-run THIS message.
- "I'll just merge, that's obviously what they want" — present the four options; wait.
- "They said yes, that's enough to discard" — only the typed word `discard` counts.
- "I'll remove the worktree to tidy up after the PR" — Option 2 keeps the worktree.
- "Merge looks clean, skip the post-merge test run" — re-run on the merged result.
- "I'll add a 'just commit' shortcut option" — exactly four, no more.
- About to `push --force` without an explicit user request.

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "Tests passed before, skip the run" | Re-run this message. The earlier run is not evidence now. |
| "It's obvious they want a merge" | Present four options. Inferring intent is not a choice. |
| "Open-ended 'what next' is friendlier" | Ambiguity loses work. Four structured options, verbatim. |
| "They confirmed with 'yes', discard it" | Only the literal word `discard` authorizes deletion. |
| "Tidy up the worktree after pushing" | Option 2 keeps the worktree; the PR still needs it. |
| "Merge was clean, no need to re-test" | Merge can break what neither branch broke alone. Re-run. |
| "Force-push to fix the remote quickly" | Force-push only on explicit request. |

## Good / Bad pairs

Test gate:
```
✅ [Run full suite this message] [see: 41/41 pass] → present options
❌ "Tests were green last time, here are your options"
```

Option presentation:
```
✅ Present the four options verbatim, no recommendation, wait
❌ "Looks done — want me to merge to main?"
```

Discard confirmation:
```
✅ Show commits/branch/worktree → wait for literal `discard`
❌ User says "yeah delete it" → run git branch -D
```

Worktree cleanup:
```
✅ Option 2 → leave worktree in place, report PR URL
❌ Option 2 → git worktree remove (PR is still open)
```

## Never / Always

Never:
- Proceed with failing tests.
- Merge without re-running tests on the merged result.
- Delete work without the typed `discard` confirmation.
- Force-push without an explicit request.
- Auto-remove a worktree for Option 2 or 3.

Always:
- Verify tests in THIS message before offering options.
- Present exactly four options, verbatim.
- Re-run tests after a local merge.
- Clean up the worktree for Options 1 and 4 only.

## Integration

- Called by: constellation:subagent-driven-development (after all tasks complete) and constellation:executing-plans (after all batches complete) — this is the standard hand-off when implementation finishes.
- REQUIRED BACKGROUND: constellation:verification-before-completion — supplies the fresh-evidence gate the Step 1 test run satisfies; no "done" without an in-message run.
- Pairs with constellation:using-git-worktrees — cleans up the worktree that skill created (matrix above).
- Pairs with constellation:git-workflow — for conventional commit messages, PR descriptions, and branch-naming when executing Options 1 and 2.

## The Bottom Line

Green tests this message, the four options verbatim, the user's explicit pick, then the exact cleanup for that pick. No inference, no shortcuts.
