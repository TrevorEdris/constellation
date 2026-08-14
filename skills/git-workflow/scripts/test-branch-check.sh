#!/usr/bin/env bash
# test-branch-check.sh — Regression tests for branch-check.sh
#
# Why this exists: branch-check.sh shipped a bracket expression that silently
# excluded the literal hyphen, so it rejected nearly every real branch name
# while its own error text claimed hyphens were allowed. These tests pin the
# accept/reject boundary so that class of bug cannot return unnoticed.
#
# Usage: test-branch-check.sh
#
# Output:
#   ok   / not ok  per case, then a summary line
#
# Exit codes:
#   0  - All cases passed
#   1  - One or more cases failed
#
# Note: branch-check.sh is invoked via `bash` so it resolves the real grep
# binary. Some interactive shells alias or shim `grep`, which masks the very
# bug this file guards against.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/branch-check.sh"

PASSED=0
FAILED=0

# ── Helpers ───────────────────────────────────────────────────────────────────

report() {
  # report <ok|not ok> <case-name> [detail]
  if [ "$1" = "ok" ]; then
    PASSED=$((PASSED + 1))
    echo "ok       $2"
  else
    FAILED=$((FAILED + 1))
    echo "not ok   $2"
    [ $# -ge 3 ] && echo "           $3"
  fi
}

# A valid name must exit 0 and announce PASS.
expect_valid() {
  local branch="$1" out status
  out="$(bash "$TARGET" "$branch" 2>&1)"
  status=$?
  if [ "$status" -eq 0 ] && [ "${out%%$'\n'*}" = "PASS: $branch" ]; then
    report ok "valid: $branch"
  else
    report "not ok" "valid: $branch" "expected PASS/exit 0, got exit $status: ${out%%$'\n'*}"
  fi
}

# An invalid name must exit 1, announce FAIL, and cite the expected reason.
expect_invalid() {
  local branch="$1" reason="$2" out status
  out="$(bash "$TARGET" "$branch" 2>&1)"
  status=$?
  if [ "$status" -eq 1 ] && printf '%s' "$out" | grep -q "$reason"; then
    report ok "invalid: $branch ($reason)"
  else
    report "not ok" "invalid: $branch" "expected exit 1 citing '$reason', got exit $status"
  fi
}

# A rejection is only actionable if the suggestion actually changes something.
# The hyphen bug produced a suggestion byte-identical to the rejected input.
expect_suggestion_differs() {
  local branch="$1" out suggestion
  out="$(bash "$TARGET" "$branch" 2>&1)"
  suggestion="$(printf '%s' "$out" | sed -n 's/^ *Suggestion: //p' | head -1)"
  if [ -n "$suggestion" ] && [ "$suggestion" != "$branch" ]; then
    report ok "suggestion differs: $branch -> $suggestion"
  else
    report "not ok" "suggestion differs: $branch" "suggestion was '${suggestion:-<none>}'"
  fi
}

expect_usage_error() {
  local out status
  out="$(bash "$TARGET" 2>&1)"
  status=$?
  if [ "$status" -eq 2 ]; then
    report ok "usage error with no arguments"
  else
    report "not ok" "usage error with no arguments" "expected exit 2, got $status"
  fi
}

# ── Cases: names that must be accepted ────────────────────────────────────────
# Every one of these contains a hyphen, which the original bracket expression
# excluded. They are the direct regression guard.

expect_valid "feature/stack-preflight"
expect_valid "fix/null-pointer-on-logout"
expect_valid "feature/stack-preflight-script"
expect_valid "feature/stacked-pr-template"
expect_valid "feature/git-workflow-stack-mode"
expect_valid "chore/bump-deps-v2.1.0"
expect_valid "hotfix/payment-gateway-timeout"

# ── Cases: names that must still be rejected ──────────────────────────────────
# Widening the character class must not swallow these.

expect_invalid "feature/has_underscore" "underscores"
expect_invalid "feature/has space"      "spaces"
expect_invalid "feature/has!bang"       "invalid special characters"
expect_invalid "feature/has@at"         "invalid special characters"
expect_invalid "banana/some-thing"      "Unknown type"

# ── Cases: rejection output must be actionable ────────────────────────────────

expect_suggestion_differs "feature/has_underscore"
expect_suggestion_differs "feature/has!bang"

# ── Cases: argument handling ──────────────────────────────────────────────────

expect_usage_error

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
