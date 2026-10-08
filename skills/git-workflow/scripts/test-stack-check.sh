#!/usr/bin/env bash
# test-stack-check.sh — Tests for stack-check.sh
#
# Why this exists: stack-check.sh is the gate an agent runs before touching a
# stacked-PR workflow. If it reports a clean bill of health when the repo is
# mid-rebase, dirty, or locked by another worktree, the agent proceeds into a
# broken state. These tests pin each blocking condition.
#
# Each case runs in a throwaway repository under mktemp -d, so nothing here
# touches the working repo.
#
# Usage: test-stack-check.sh
#
# Exit codes:
#   0  - All cases passed
#   1  - One or more cases failed
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/stack-check.sh"

PASSED=0
FAILED=0
WORKDIRS=()

cleanup() {
  local d
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && [ -d "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

report() {
  if [ "$1" = "ok" ]; then
    PASSED=$((PASSED + 1))
    echo "ok       $2"
  else
    FAILED=$((FAILED + 1))
    echo "not ok   $2"
    [ $# -ge 3 ] && echo "           $3"
  fi
}

# Build a throwaway git repo with one commit and echo its path.
make_repo() {
  local d
  d="$(mktemp -d)"
  WORKDIRS+=("$d")
  git -C "$d" init -q
  git -C "$d" config user.email test@example.invalid
  git -C "$d" config user.name "Test"
  echo "seed" > "$d/seed.txt"
  git -C "$d" add seed.txt
  git -C "$d" commit -qm "seed"
  echo "$d"
}

# run_in <dir> [args...] -> sets OUT and STATUS
run_in() {
  local dir="$1"; shift
  OUT="$(cd "$dir" && bash "$TARGET" "$@" 2>&1)"
  STATUS=$?
}

expect_status() {
  local name="$1" want="$2"
  if [ "$STATUS" -eq "$want" ]; then
    report ok "$name (exit $want)"
  else
    report "not ok" "$name" "expected exit $want, got $STATUS: $(printf '%s' "$OUT" | tail -2 | tr '\n' ' ')"
  fi
}

expect_output() {
  local name="$1" pattern="$2"
  if printf '%s' "$OUT" | grep -q "$pattern"; then
    report ok "$name"
  else
    report "not ok" "$name" "output did not match '$pattern'"
  fi
}

# ── Case: argument handling ───────────────────────────────────────────────────

repo="$(make_repo)"
run_in "$repo" --nonsense
expect_status "unknown flag rejected" 2

# ── Case: not a git repository ────────────────────────────────────────────────

nonrepo="$(mktemp -d)"; WORKDIRS+=("$nonrepo")
run_in "$nonrepo"
expect_status "outside a git repo fails" 1
expect_output "outside a git repo reports FAIL" "FAIL"

# ── Case: clean repo that is not part of a stack ──────────────────────────────
# Not being in a stack is normal before `gh stack init`, so it must be
# informational, not a failure.

repo="$(make_repo)"
run_in "$repo"
expect_status "clean repo outside a stack passes" 0
expect_output "clean repo outside a stack reports INFO" "INFO"

# ── Case: dirty working tree ──────────────────────────────────────────────────
# A cascading rebase refuses to run against uncommitted changes.

repo="$(make_repo)"
echo "uncommitted" > "$repo/dirty.txt"
git -C "$repo" add dirty.txt
run_in "$repo"
expect_status "dirty tree fails" 1
expect_output "dirty tree names the working tree" "working tree"

# ── Case: interrupted gh stack rebase ─────────────────────────────────────────
# gh-stack stores its rebase state in the COMMON git dir, so this must be
# detected via --git-common-dir rather than --git-dir.

repo="$(make_repo)"
touch "$repo/.git/gh-stack-rebase-state"
run_in "$repo"
expect_status "interrupted gh stack rebase fails" 1
expect_output "interrupted gh stack rebase is named" "rebase"

# ── Case: interrupted plain git rebase ────────────────────────────────────────
# Plain git rebase state is per-worktree, unlike gh-stack's.

repo="$(make_repo)"
mkdir -p "$repo/.git/rebase-merge"
run_in "$repo"
expect_status "interrupted git rebase fails" 1

# ── Case: a leftover lock file is not an active lock ──────────────────────────
# `gh stack init` leaves a zero-byte .git/gh-stack.lock behind permanently, so
# its presence says nothing about whether the stack is locked. Failing on mere
# existence made the preflight fail in every initialized repository. A real
# lock surfaces as exit status 8 from gh itself.

repo="$(make_repo)"
touch "$repo/.git/gh-stack.lock"
run_in "$repo"
expect_status "leftover lock file does not fail" 0

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
