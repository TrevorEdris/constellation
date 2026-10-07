---
name: finishing-a-development-branch
description: Use when implementation is done and you must decide how to integrate the work — about to merge, push, open a PR, delete a branch, clean up a worktree, or are asked "are we done / what's next" after the last task or batch completes
---

# Finishing a Development Branch

Type: rigid (discipline). Follow exactly. Do not adapt away the gate or the menu.

Finishing means a clean, verified integration of completed work, never a guess at intent. No integration action without green tests in this message and an explicit user choice.

**Core principle:** Verify tests → Detect the workspace → Settle the base → Present the menu → Execute the choice → Clean up.

**Announce at start:** "Using finishing-a-development-branch to complete this work."

Script paths are relative to the git-workflow skill base directory (shown when the skill loads); run them by that absolute path from the repo.

## Step 1: Verify tests (gate)

Run the project's full suite in this message and read the output:

```bash
npm test   # or: cargo test | pytest | go test ./...
```

- Any failure: STOP. Report the failures. No menu until the suite is green.
- 0 failures, this message: continue.

A run from an earlier message does not count (see REQUIRED BACKGROUND under Integration). An explicit "merge it to main" from the user counts as the choice in Step 4; it does not waive this gate.

## Step 2: Detect the workspace

Run this inside the workspace, before any `cd` (Step 5 changes directory):

```bash
bash scripts/workspace.sh detect [<base>]
```

Pass `<base>` when the plan or conversation already names it. It prints `KEY=value` lines (`ISOLATION`, `HEAD`, `BRANCH`, `BASE`, `GIT_DIR`, `GIT_COMMON`, `WORKTREE_PATH`, `MAIN_ROOT`, `CLEANUP`, `REMOTE`, `DELIVERY`). Shell variables do not survive between commands, so substitute these values wherever later steps write `$MAIN_ROOT`, `$WORKTREE_PATH` or `$REMOTE`.

- `HEAD=detached`: an externally managed workspace; the menu has no local merge.
- `DELIVERY=pr`: the repo has a remote, or its history shows merged pull requests. `DELIVERY=local`: neither.
- `CLEANUP=git`: a worktree on a branch under `.worktrees/`, `worktrees/` or `.claude/worktrees/` of `MAIN_ROOT`; Step 6 may remove it. `CLEANUP=host`: anything else; the host owns it, leave it in place.
- `ISOLATION=none`: a normal checkout; there is no worktree to remove.

## Step 3: Determine the base branch

The base is what this work forked from: the plan, the conversation, or the branch's upstream. If none of them names it, ask: "This branch split from <BASE guess> - is that correct?" Confirm before merging or opening a PR; the wrong base is expensive to undo. If the base differs from `BASE=`, rerun `bash scripts/workspace.sh detect <base>` (still before any `cd`): `DELIVERY` reads that base's history.

## Step 4: Present the menu

Pick the menu from `HEAD`, then `DELIVERY`. Present it exactly as written, with `<branch>` and `<base>` filled in, then wait. Discard is never on the menu.

PR-based (`DELIVERY=pr`):

```
Implementation complete on <branch>. This repo is PR-based.

1. Push and open a Pull Request against <base>
2. Keep the branch as-is (I'll handle it later)

Which option?
```

Add `3. Merge into <base> locally (approved local-only delivery)` only when the active PLAN qualifies: its `status` is `approved` or `in-progress`, and its block-form `delivery:` list has a `mode: local-only` item for this repo. Nothing else qualifies; the script checks again.

Local (`DELIVERY=local`):

```
Implementation complete on <branch>. No remote and no PR history.

1. Merge into <base> locally
2. Keep the branch as-is (I'll handle it later)

Which option?
```

Detached HEAD:

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as a new branch and open a Pull Request
2. Keep as-is (I'll handle it later)

Which option?
```

- `DELIVERY=pr` with an empty `REMOTE`: no menu. Say "This repo is PR-based but has no remote. Add a remote and I'll push and open a PR, or approve a local-only delivery in the plan." and stop. No push, no local merge.
- "Merge / land / ship it (to main)" is already a choice. With `DELIVERY=pr` it selects option 1 without a menu; say "PR-based repo: pushing and opening a PR instead of merging locally." With `DELIVERY=local` it selects the local merge.
- Pushes use `$REMOTE`, never a hard-coded `origin`.

## Step 5: Execute the choice

### Push and open a Pull Request

```bash
git push -u "$REMOTE" <branch>
```

From a detached HEAD, check the new name with `bash scripts/branch-check.sh "<name>"`, then run `git push "$REMOTE" HEAD:refs/heads/<name>` instead.

Then follow the `pr` sub-workflow in the git-workflow SKILL.md from step 4 (the repo's PR template wins; the push above replaces its step 5), creating the PR against the base:

```bash
GITHUB_TOKEN= gh pr create --title "<title>" --body "<body>" --base <base>
```

From a detached HEAD, add `--head <name>`. Report the PR URL.

- If `gh` is missing or fails (for example a non-GitHub remote): print the title, the body and `git remote get-url "$REMOTE"`, say the branch is pushed, and stop.
- A rejected push means the remote moved. Investigate and report; never force it.
- The worktree stays: PR feedback gets fixed there.
- **Stack:** when the active PLAN has a `delivery` item with `mode: stack` for this branch, the base is that item's `base` (the lower stack branch), and the remote is its `remote` unless that is `none`, else `$REMOTE`. Push and open the PR as above. Run no `gh stack` commands.

### Merge locally

Local menu option 1, or option 3 of the PR-based menu. Run it from the main checkout, with the project's test command last:

```bash
cd "$MAIN_ROOT"
bash scripts/workspace.sh merge-local <base> <branch> [--plan <PLAN path>] -- <test command>
```

Pass `--plan` for option 3. The script checks out the base in `MAIN_ROOT` (the base is usually checked out there, and doing it inside a worktree exits 128), merges, and runs the tests on the merged result. Read the output lines:

- `PREVIOUS_BRANCH=`: when it is not the base, tell the user `MAIN_ROOT` was on that branch and now sits on the base.
- Exit 0 with `MERGED=<sha>`: the merged result is green. Go to Step 6.
- Exit 5: the merged result fails its tests. STOP and report `UNDO=` (`git -C <MAIN_ROOT> reset --merge <sha>`, which keeps unrelated edits) and `KEPT_BRANCH=`. The branch and worktree stay; the user decides whether to undo.
- Exit 4: this repo is PR-based and no approved local-only plan covers it. Offer the PR path.
- Any other nonzero exit: stop and show `REFUSED=`. Exit 3 also lists `BLOCKING=` files: tracked changes in `MAIN_ROOT` block the merge, so ask what to do with them.

### Keep as-is

Report: "Keeping branch <name>. Worktree preserved at <path>." Clean up nothing.

### Discard (explicit request only)

Start this only when the user asks to throw the work away in so many words. Show what is lost, then require the typed word:

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Only the literal word `discard` counts; "yes", "y" and "go ahead" do not. On a match, run Step 6 with `--discard --confirm discard`. In a normal checkout (`ISOLATION=none`) first check out the base in `MAIN_ROOT`: git will not delete the branch it has checked out.

## Step 6: Clean up

Runs after a local merge and after a confirmed discard (and later, once a PR has merged). A PR or Keep leaves the worktree and branch alone until then. Inside an `EnterWorktree` session skip this step; the session owns the worktree, and `ExitWorktree` runs only when the user asks.

Removal must start outside the worktree, so `cd` first, in the same block:

```bash
cd "$MAIN_ROOT"
bash scripts/workspace.sh cleanup "$WORKTREE_PATH" <branch>
```

`<branch>` is the work's branch, never the base. For a confirmed discard, add `--discard --confirm discard`.

- Exit 0: report `REMOVED_WORKTREE=` and `DELETED_BRANCH=`. Name every `IGNORED=` path (such as `.env` or `node_modules/`) as deleted with the worktree. `LEFT_IN_PLACE=` means the host owns the workspace; say so and leave it.
- Exit 3: files exist only in the worktree. Show the `BLOCKING=` lines and ask: commit them, move them into `MAIN_ROOT`, or delete exactly those. Carry out the answer, then rerun.
- Exit 1 or 2: nothing was forced. Report `REFUSED=`. If it names the upstream, nothing was removed: push the branch (or confirm it landed through that upstream) and rerun. Otherwise fix what it names; do not work around it.

## Quick Reference

| Choice | Merge | Push | Keep worktree | Delete branch |
|--------|-------|------|---------------|---------------|
| Push and open a PR | - | yes | yes | - |
| Merge locally | yes | - | no (Step 6) | yes (safe delete) |
| Keep as-is | - | - | yes | - |
| Discard (explicit request only) | - | - | no (Step 6) | yes (typed `discard`) |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Tests passed earlier this session" | Run the suite on the tree you are about to integrate, in this message. |
| "'Merge it to main' means merge locally" | In a PR-based repo it means push and open a PR. A local merge needs an approved local-only plan; otherwise the script refuses with exit 4. |
| "`git checkout main` here is quicker" | The base is checked out in `MAIN_ROOT`, so it exits 128 inside a worktree. Use `merge-local`, which runs where the base is free. |
| "Removal refused, so `--force` just finishes the cleanup" | The refusal means files exist only in that worktree. Force destroys them for good. Show the `BLOCKING=` files and ask. |
| "The merged failure is flaky" | A failing merged result stops everything. Report `UNDO=`; branch and worktree stay while you investigate. |
| "They seem done with this work, so offer Discard" | Discard is not on the menu. Only an explicit request starts it, and only the typed `discard` authorizes it. |
| "The PR is up, so tidy the worktree" | PR feedback gets fixed in that worktree. It stays until the work lands. |
| "The push was rejected, so force it" | The remote moved. Investigate; force only on an explicit request, never to a protected branch. |
| "The base is obviously main" | Take it from the plan, the conversation or the upstream, else ask. |

## Integration

- Called by: `constellation:subagent-driven-development` after all tasks complete (its inline executing-plans mode included).
- REQUIRED BACKGROUND: `constellation:verification-before-completion` supplies the fresh-evidence gate that Step 1 satisfies; no "done" without an in-message run.
- Pairs with the worktree reference `references/using-git-worktrees/`: Step 6 removes the worktree it created.
- Pairs with `constellation:git-workflow` (PR body, branch names) and, for Keep as-is, `constellation:session-handoff`.
