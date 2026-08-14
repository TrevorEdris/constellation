#!/usr/bin/env bash
# stack-check.sh — Preflight checks before running a stacked-PR workflow
#
# Why this exists: `gh stack` operations cascade across every branch in a stack.
# Starting one from a dirty tree, a half-finished rebase, or a locked stack
# leaves the whole chain in a state that is tedious to unwind. This script is
# the gate to run before `gh stack init`, `rebase`, `sync`, or `submit`.
#
# Usage: stack-check.sh [--remote]
#
#   --remote   Also compare each stack branch against its remote counterpart.
#              Requires network access. Off by default so the common case
#              stays fast and works offline.
#
# Output:
#   One line per check, prefixed PASS, FAIL, or INFO, then a summary.
#   INFO is not a failure — "not part of a stack yet" is the normal state
#   before `gh stack init`.
#
# Exit codes:
#   0  - No blocking problems found
#   1  - One or more blocking checks failed
#   2  - Usage error
#
# Note on worktrees: gh-stack stores its metadata and lock in the COMMON git
# directory, not the per-worktree one, so a stack is shared by every worktree
# of a repository and only one worktree can hold the lock at a time. Plain git
# rebase state, by contrast, is per-worktree. This script checks each in the
# right place.
set -uo pipefail

REMOTE_CHECK=0
FAILURES=0
CHECKS=0

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: stack-check.sh [--remote]"
  echo ""
  echo "  --remote   Also compare stack branches against the remote (needs network)"
  echo ""
  echo "Exit codes: 0 = clear, 1 = blocking problem, 2 = usage error"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE_CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument '$1'" >&2; echo "" >&2; usage >&2; exit 2 ;;
  esac
done

# ── Reporting helpers ─────────────────────────────────────────────────────────

pass() { CHECKS=$((CHECKS + 1)); printf '  PASS  %s\n' "$1"; }
info() { CHECKS=$((CHECKS + 1)); printf '  INFO  %s\n' "$1"; }
fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  printf '  FAIL  %s\n' "$1"
  [ $# -ge 2 ] && printf '          %s\n' "$2"
}

# Resolve a git dir to an absolute path. `git rev-parse` returns a relative
# path when run from the repository root, absolute from a linked worktree.
abspath_gitdir() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  ( cd "$1" 2>/dev/null && pwd ) ;;
  esac
}

echo "stack-check: preflight for stacked-PR operations"
echo ""

# ── Check: inside a git repository ────────────────────────────────────────────
# Everything below needs a repository, so bail immediately if this fails.

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "git repository" "not inside a git repository"
  echo ""
  echo "Result: FAIL ($CHECKS checks, $FAILURES failure(s))"
  exit 1
fi
pass "git repository"

GIT_DIR="$(abspath_gitdir "$(git rev-parse --git-dir)")"
GIT_COMMON_DIR="$(abspath_gitdir "$(git rev-parse --git-common-dir)")"

# ── Check: gh CLI available ───────────────────────────────────────────────────

if command -v gh >/dev/null 2>&1; then
  pass "gh CLI available"
else
  fail "gh CLI available" "install it from https://cli.github.com/ (stacked PRs require gh v2.0+)"
fi

# ── Check: gh-stack extension installed ───────────────────────────────────────
# Without it the skill falls back to manual stacking with `gh pr create --base`.

if command -v gh >/dev/null 2>&1 && GITHUB_TOKEN= gh stack --version >/dev/null 2>&1; then
  pass "gh-stack extension installed ($(GITHUB_TOKEN= gh stack --version 2>/dev/null | head -1))"
else
  fail "gh-stack extension installed" "run: gh extension install github/gh-stack"
fi

# ── Check: working tree clean ─────────────────────────────────────────────────
# Tracked modifications block a cascading rebase. Untracked files do not, so
# they are reported separately and do not fail the run.

if [ -z "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  pass "working tree clean"
else
  fail "working tree clean" "commit or stash tracked changes before a stack operation"
fi

if [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  info "untracked files present (does not block a rebase)"
fi

# ── Check: no rebase in progress ──────────────────────────────────────────────
# Plain git rebase state is per-worktree; gh-stack's own state is shared.

if [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; then
  fail "no git rebase in progress" "finish it with 'git rebase --continue' or 'git rebase --abort'"
else
  pass "no git rebase in progress"
fi

if [ -e "$GIT_COMMON_DIR/gh-stack-rebase-state" ]; then
  fail "no gh stack rebase in progress" "finish it with 'gh stack rebase --continue' or 'gh stack rebase --abort'"
else
  pass "no gh stack rebase in progress"
fi

# ── Check: stack membership and lock state ────────────────────────────────────
# Absence of the metadata file is the cheap offline answer; only when a stack
# exists is `gh stack view` consulted.
#
# Do NOT infer a lock from the presence of .git/gh-stack.lock. `gh stack init`
# leaves that file behind permanently as a zero-byte advisory lock target, so
# it exists in every initialized repository whether or not anything holds it.
# The trustworthy signal is gh's own exit status: 0 in a stack, 2 outside one,
# 8 when the stack is genuinely locked by another process or worktree.

IN_STACK=0
if [ ! -e "$GIT_COMMON_DIR/gh-stack" ]; then
  info "no stack tracked in this repository (run 'gh stack init' to create one)"
else
  GITHUB_TOKEN= gh stack view --json >/dev/null 2>&1
  case $? in
    0)
      IN_STACK=1
      pass "current branch is part of a tracked stack"
      ;;
    2)
      info "current branch is not part of a stack (a stack exists but this branch is outside it)"
      ;;
    8)
      fail "stack not locked" "another process or worktree holds the gh-stack lock"
      ;;
    *)
      info "stack state could not be determined (gh stack view failed)"
      ;;
  esac
fi

# ── Check: remote comparison (opt-in) ─────────────────────────────────────────
# A remote branch ahead of local means a force-push would discard commits.
#
# This does NOT detect stack-composition divergence between local and GitHub.
# `gh stack sync` handles that, but it aborts with exit status 0 in a
# non-interactive terminal when the stacks have diverged, so always confirm the
# result with `gh stack view --json` rather than trusting sync's exit code.

if [ "$REMOTE_CHECK" -eq 1 ]; then
  if [ "$IN_STACK" -ne 1 ]; then
    info "remote check skipped (not in a tracked stack)"
  else
    REMOTE_NAME="$(git remote | head -1)"
    if [ -z "$REMOTE_NAME" ]; then
      info "remote check skipped (no remote configured)"
    else
      git fetch --quiet "$REMOTE_NAME" 2>/dev/null
      BRANCHES="$(GITHUB_TOKEN= gh stack view --short 2>/dev/null | sed 's/^[^A-Za-z0-9]*//; s/ (current)$//' | grep -v '^$')"
      AHEAD_FOUND=0
      while IFS= read -r branch; do
        [ -z "$branch" ] && continue
        git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null || continue
        if ! git rev-parse --verify --quiet "refs/remotes/$REMOTE_NAME/$branch" >/dev/null; then
          info "branch '$branch' not yet pushed to $REMOTE_NAME"
          continue
        fi
        behind="$(git rev-list --count "$branch..refs/remotes/$REMOTE_NAME/$branch" 2>/dev/null || echo 0)"
        if [ "${behind:-0}" -gt 0 ]; then
          fail "branch '$branch' is behind $REMOTE_NAME by $behind commit(s)" "a force-push would discard them; run 'gh stack sync' first"
          AHEAD_FOUND=1
        fi
      done <<< "$BRANCHES"
      [ "$AHEAD_FOUND" -eq 0 ] && pass "no stack branch is behind $REMOTE_NAME"
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "Result: PASS ($CHECKS checks, 0 failures)"
  exit 0
fi
echo "Result: FAIL ($CHECKS checks, $FAILURES failure(s))"
exit 1
