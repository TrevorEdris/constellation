---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from the current workspace, before executing an implementation plan, or before dispatching implementation subagents — symptoms include uncommitted changes you want to preserve, parallel work on multiple branches, or a plan/spec ready to implement.
---

# Using Git Worktrees

## Overview

Git worktrees create isolated workspaces that share one repository, so you can work on multiple branches at once without switching or stashing.

**Core principle:** Deterministic directory selection + ignore verification + clean test baseline = reliable isolation.

This skill is a REQUIRED predecessor for execution skills (constellation:executing-plans, constellation:subagent-driven-development) — set up the worktree before any code is written. It pairs with constellation:git-workflow (REQUIRED BACKGROUND) for branch naming, commits, and cleanup.

**Announce at start:** "Using using-git-worktrees to set up an isolated workspace."

## Directory Selection (deterministic priority)

Follow this order. Do not skip a step or guess.

### 1. Check existing directories

```bash
ls -d .worktrees 2>/dev/null     # preferred (hidden)
ls -d worktrees 2>/dev/null      # alternative
```

If found, use it. If both exist, `.worktrees` wins.

### 2. Check CLAUDE.md

```bash
grep -i "worktree.*director" CLAUDE.md 2>/dev/null
```

If a preference is specified, use it without asking.

### 3. Ask the user

Only if no directory exists and no CLAUDE.md preference:

```
No worktree directory found. Where should I create worktrees?

1. .worktrees/ (project-local, hidden)
2. ~/.config/constellation/worktrees/<project-name>/ (global, outside the repo)

Which would you prefer?
```

## Safety Verification

### Project-local directories (.worktrees or worktrees)

You MUST verify the directory is ignored before creating a worktree:

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If NOT ignored, fix it immediately before proceeding:

1. Add the directory to `.gitignore`.
2. Commit that change (staging only `.gitignore`).
3. Then create the worktree.

Why: an untracked worktree directory pollutes `git status` and can be committed into the repository by accident.

### Global directory (~/.config/constellation/worktrees)

No `.gitignore` check needed — it lives outside the repository.

## Creation Steps

Track these as TodoWrite items so none get skipped.

### 1. Detect project name

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
```

### 2. Create the worktree

```bash
case $LOCATION in
  .worktrees|worktrees)
    path="$LOCATION/$BRANCH_NAME"
    ;;
  ~/.config/constellation/worktrees/*)
    path="$HOME/.config/constellation/worktrees/$project/$BRANCH_NAME"
    ;;
esac

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

### 3. Run project setup

Auto-detect from project files; never hardcode for one toolchain:

```bash
if [ -f package.json ]; then npm install; fi
if [ -f Cargo.toml ]; then cargo build; fi
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi
if [ -f go.mod ]; then go mod download; fi
```

### 4. Verify a clean baseline

Run the project's test command in the fresh worktree:

```bash
# use the project-appropriate command
npm test
cargo test
pytest
go test ./...
```

A clean baseline is what lets you distinguish bugs YOU introduce from pre-existing failures. Skip it and every later failure is ambiguous.

- **Tests pass:** report ready.
- **Tests fail:** report the failures and ask whether to proceed or investigate first. Do not silently continue.

### 5. Report location

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check CLAUDE.md, then ask user |
| Directory not ignored | Add to `.gitignore` + commit, then proceed |
| Tests fail during baseline | Report failures + ask |
| No package.json / Cargo.toml / etc. | Skip dependency install |

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Skipping ignore verification | Worktree contents get tracked, pollute git status, risk being committed | Always `git check-ignore` before creating a project-local worktree |
| Assuming directory location | Inconsistency, violates project conventions | Follow priority: existing > CLAUDE.md > ask |
| Proceeding with failing tests | Can't tell new bugs from pre-existing ones | Report failures, get explicit permission |
| Hardcoding setup commands | Breaks on other toolchains | Auto-detect from project files |

## Good / Bad

✅ Good:
```
Using using-git-worktrees to set up an isolated workspace.
[.worktrees/ exists] [git check-ignore confirms it is ignored]
git worktree add .worktrees/auth -b feature/auth
npm install  →  npm test: 47 passing
Worktree ready at /Users/me/myproject/.worktrees/auth — 47 tests, 0 failures. Ready to implement auth.
```

❌ Bad:
```
git worktree add wt -b feature/auth   # location guessed, not ignored, no baseline
cd wt && start editing                # later failures are now ambiguous
```

## Red Flags — STOP

If you catch yourself thinking any of these, stop and follow the steps above:

- "I'll just create the worktree wherever and check ignore later."
- "Skipping the baseline tests, they probably pass."
- "Tests are failing but they look unrelated, I'll keep going."
- "I'll guess the directory rather than check CLAUDE.md."

**Always:** follow directory priority (existing > CLAUDE.md > ask); verify project-local directories are ignored; auto-detect and run setup; verify a clean test baseline before implementing.

## Integration

**Called by (REQUIRED before execution):**
- constellation:executing-plans — set up the worktree before executing any task
- constellation:subagent-driven-development — set up before dispatching implementation subagents
- constellation:brainstorming — when a design is approved and implementation follows
- Any skill needing an isolated workspace

**Pairs with:**
- constellation:git-workflow (REQUIRED BACKGROUND) — branch naming, conventional commits, and worktree cleanup after work completes
