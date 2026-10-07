---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from the current workspace, before executing an implementation plan, or before dispatching implementation subagents — symptoms include uncommitted changes you want to preserve, parallel work on multiple branches, or a plan/spec ready to implement.
---

# Using Git Worktrees

## Overview

Ensure work happens in an isolated workspace. Detect existing isolation first, then prefer a native worktree tool, then fall back to plain git. Never fight the harness.

**Core principle:** Detect isolation, get consent, use a native tool or a git fallback in an ignored directory, then prove a clean test baseline.

**Announce at start:** "Using using-git-worktrees to set up an isolated workspace."

Script paths are relative to the git-workflow skill base directory (shown when the skill loads); run them by that absolute path from the repo.

## Step 0: Detect existing isolation

Before creating anything, run this inside the current workspace:

```bash
bash scripts/workspace.sh detect
```

It prints `KEY=value` lines. Shell variables do not survive between commands, so substitute the values wherever later steps write `$WORKTREE_PATH`, `$BASE` or `$REMOTE`.

- `ISOLATION=worktree`: you are already in a linked worktree. Create nothing and go to Step 2. A submodule reports `none`, not `worktree`. Report:
  - On a branch: `Already in isolated workspace at <WORKTREE_PATH> on branch <BRANCH>.`
  - `HEAD=detached`: `Already in isolated workspace at <WORKTREE_PATH> (detached HEAD, externally managed). Branch creation needed at finish time.`
- `ISOLATION=none`: a normal checkout. If your instructions, memory or the active plan declare a worktree preference, follow it without asking. Otherwise ask: "Would you like me to set up an isolated worktree? It protects your current branch from changes." If the user declines, work in place and go to Step 2.

## Step 1: Create the isolated workspace

Two mechanisms, in this order.

### 1a. Native tool

Use `EnterWorktree` only when the user said yes in Step 0 or explicitly asked for a worktree (project instructions and memory count). A request for a branch is not one. A native tool owns placement, branching and cleanup; a hand-made `git worktree add` creates state the harness cannot see.

- It creates `.claude/worktrees/<name>` on a new branch. Its `fresh` base (the default of the `worktree.baseRef` setting) is `origin/<default branch>`, so base commits that are not pushed are missing. When the work builds on them, use 1b.
- `ExitWorktree` leaves a worktree that `EnterWorktree` made in this same session. Never call it on your own initiative; run it only when the user asks.

When it succeeds, go to Step 2. With no native tool, or when it does not fit, use 1b.

### 1b. Git fallback

#### Choose the directory

First match wins. Run these from the project root (`WORKTREE_PATH`).

1. A directory your instructions, memory or the plan declare: use it without asking.
2. An existing `.worktrees/`, else `worktrees/`, else `.claude/worktrees/`:
   ```bash
   for d in .worktrees worktrees .claude/worktrees; do [ -d "$d" ] && { echo "$d"; break; }; done
   ```
3. None of those: the default, `.worktrees/` at the project root.

#### Verify the directory is ignored

Probe a path inside the directory, not the directory itself: before it exists, `check-ignore` on its bare name returns 1 even when a rule covers it. `$dir` is the directory chosen above (substitute it by hand, like the other variables) and `<name>` is the new branch name (slashes nest):

```bash
git check-ignore -q "$dir/<name>" && echo ignored || echo NOT-IGNORED
```

If NOT ignored, fix it before creating anything:

1. Run the branch check: `git branch --show-current`. On `main`, `master` or `develop`, ask before committing; continue only on a yes.
2. Append `$dir/` to `.gitignore`, stage only `.gitignore`, and commit it (`chore: ignore $dir/`).
3. Run the probe again; it must print `ignored`.

Why: an unignored worktree directory pollutes `git status` and can be committed into the repository by accident.

#### Create the worktree

Name the new branch (`$BRANCH`) and validate it; on FAIL, use the suggestion:

```bash
bash scripts/branch-check.sh "$BRANCH"
```

Then create it from `$BASE` (`BASE=` from Step 0, or the base the plan or conversation names):

```bash
git worktree add --no-track "$dir/<name>" -b "$BRANCH" "$BASE"
cd "$dir/<name>"
```

PR-based repo (`DELIVERY=pr`) with a non-empty `REMOTE`: branch from the remote's base instead, so the PR does not carry stale history:

```bash
git fetch "$REMOTE"
git worktree add --no-track "$dir/<name>" -b "$BRANCH" "$REMOTE/<base>"
cd "$dir/<name>"
```

`--no-track` keeps the new branch from tracking `$REMOTE/<base>`. Tracking would make a bare `git push` target the base branch under `push.default=upstream`.

**Sandbox fallback:** if `git worktree add` fails with a permission error (sandbox denial), tell the user the sandbox blocked worktree creation and that you are working in the current directory instead. Then run Steps 2 and 3 in place.

## Step 2: Project setup

Auto-detect from project files; never hardcode one toolchain:

```bash
if [ -f package.json ]; then npm install; fi
if [ -f Cargo.toml ]; then cargo build; fi
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi
if [ -f go.mod ]; then go mod download; fi
```

## Step 3: Verify a clean baseline

Run the project's test command in the workspace (`npm test`, `cargo test`, `pytest`, `go test ./...`). A clean baseline separates bugs you introduce from pre-existing failures; without it every later failure is ambiguous.

- Tests pass: report ready.
- Tests fail: report the failures and ask whether to proceed or investigate first. Never continue silently.

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| `ISOLATION=worktree` | Create nothing; report the workspace (Step 0) |
| `ISOLATION=none`, no declared preference | Ask the consent question |
| User consented, `EnterWorktree` available | Use it (1a); unpushed base commits are missing |
| No native tool, or it does not fit | `git worktree add` (1b) |
| Directory choice | Declared, then `.worktrees/`, `worktrees/`, `.claude/worktrees/`, default `.worktrees/` |
| Directory not ignored | Branch check, add rule to `.gitignore`, commit it |
| Permission error on create | Sandbox fallback; work in place |
| Tests fail during baseline | Report failures and ask |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'm obviously not in a worktree, so skip the check" | Run `bash scripts/workspace.sh detect`. Harness-created isolation and submodules both fool eyeballing. |
| "`git worktree add` is quicker than the native tool" | After consent, `EnterWorktree` owns placement, branching and cleanup. Bypassing it creates state the harness cannot see. |
| "`.worktrees` is surely ignored already" | Probe a child path with `check-ignore`. An unignored directory lets the whole tree get committed. |
| "The work is done, so call `ExitWorktree` to tidy up" | It works only in the session that entered, and only when the user asks. The finishing reference owns cleanup. |
| "The workspace is fresh, so baseline tests can wait" | A dirty baseline makes every later failure ambiguous. Run them now; proceeding past failures is the user's call. |

## Integration

- Called by: `constellation:subagent-driven-development` before dispatching implementation subagents (its inline executing-plans mode included), and `constellation:brainstorming` once a design is approved and implementation follows.
- Pairs with `references/finishing-a-development-branch/`: its Step 6 removes the worktree this skill created.
- Pairs with `constellation:git-workflow`: branch names (`bash scripts/branch-check.sh`) and commits.
