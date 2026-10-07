#!/usr/bin/env bash
# test-branch-check.sh — Regression tests for branch-check.sh
#
# Why this exists: branch-check.sh shipped a bracket expression that silently
# excluded the literal hyphen, so it rejected nearly every real branch name
# while its own error text claimed hyphens were allowed. These tests pin the
# accept/reject boundary so that class of bug cannot return unnoticed. They also
# pin the full type list and the uppercase-ticket exception.
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
    report "not ok" "valid: $branch" "expected PASS/exit 0, got exit $status: $(printf '%s' "$out" | sed -n 's/^ *Reason: //p' | paste -sd ';' -)"
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

# The suggestion must be exactly the expected corrected name. This is stricter
# than expect_suggestion_differs: it catches a fix that rewrites the ticket ID.
expect_suggestion() {
  local branch="$1" expected="$2" out suggestion
  out="$(bash "$TARGET" "$branch" 2>&1)"
  suggestion="$(printf '%s' "$out" | sed -n 's/^ *Suggestion: //p' | head -1)"
  if [ "$suggestion" = "$expected" ]; then
    report ok "suggestion: $branch -> $expected"
  else
    report "not ok" "suggestion: $branch" "expected '$expected', got '${suggestion:-<none>}'"
  fi
}

# Both printed type lists (usage text, Unknown-type reason) must name every type
# as a whole word. Only the list line is searched, so an example such as
# 'fix/null-pointer' elsewhere in the output cannot satisfy 'fix'. A whole-word
# match also stops 'feature' from satisfying 'feat'.
ALL_TYPES="feature feat fix hotfix chore docs refactor test release experiment ci perf"

expect_types_listed() {
  local out line type missing
  out="$(bash "$TARGET" 2>&1)"
  line="$(printf '%s\n' "$out" | grep '^Valid types:')"
  missing=""
  for type in $ALL_TYPES; do
    printf '%s' "$line" | grep -qw -- "$type" || missing="$missing $type"
  done
  if [ -z "$missing" ]; then
    report ok "usage lists every type"
  else
    report "not ok" "usage lists every type" "missing:$missing"
  fi

  out="$(bash "$TARGET" "banana/x" 2>&1)"
  line="$(printf '%s\n' "$out" | grep "Unknown type")"
  missing=""
  for type in $ALL_TYPES; do
    printf '%s' "$line" | grep -qw -- "$type" || missing="$missing $type"
  done
  if [ -z "$missing" ]; then
    report ok "Unknown-type reason lists every type"
  else
    report "not ok" "Unknown-type reason lists every type" "missing:$missing"
  fi
}

# <n> lowercase 'a' characters, for building descriptions of an exact length.
repeat_a() {
  printf '%*s' "$1" '' | tr ' ' a
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

# Every type in the convention, including the ones the repo's own branches use
# (feat/, ci/) and SKILL.md teaches (ci, perf). A dropped type fails here.
expect_valid "feat/add-login"
expect_valid "ci/version-check"
expect_valid "perf/cache-warmup"
expect_valid "release/v2.3.0"

# A ticket ID right after the type may be uppercase. Checking uppercase on the
# whole name instead of the part after the ticket fails all three.
expect_valid "feature/PROJ-42-add-oauth"
expect_valid "feature/PROJ-42-add-oauth-login"
expect_valid "fix/ENG-456-null-pointer"

# The ticket does not count toward the 50-char description limit. With a 48-char
# description the part after the type is 56 chars (ticket plus description), so
# measuring that instead of the description fails this case.
expect_valid "feature/PROJ-42-$(repeat_a 48)"

# ── Cases: names that must still be rejected ──────────────────────────────────
# Widening the character class must not swallow these.

expect_invalid "feature/has_underscore" "underscores"
expect_invalid "feature/has space"      "spaces"
expect_invalid "feature/has!bang"       "invalid special characters"
expect_invalid "feature/has@at"         "invalid special characters"
expect_invalid "banana/some-thing"      "Unknown type"

# Uppercase is allowed only in the ticket. Everything else stays lowercase.
expect_invalid "feature/AddOAuthLogin"      "uppercase"
expect_invalid "feature/PROJ-42-AddLogin"   "uppercase"
expect_invalid "Feat/add-login"             "must be lowercase"
# The ticket exception sits right after the type, and needs digits after the
# hyphen. 'PROJ--' only passed while the pattern read [0-9]* instead of [0-9]+.
expect_invalid "feature/add-PROJ-42-login"  "uppercase"
expect_invalid "feature/PROJ--add-login"    "uppercase"
# A description over 50 chars is still rejected when a ticket precedes it.
expect_invalid "feature/PROJ-42-$(repeat_a 51)" "Description segment"

# ── Cases: rejection output must be actionable ────────────────────────────────

expect_suggestion_differs "feature/has_underscore"
expect_suggestion_differs "feature/has!bang"

# The suggestion must keep the ticket ID's case. Lowercasing the whole name
# would turn PROJ-42 into proj-42.
expect_suggestion "feature/PROJ-42-Add-Login" "feature/PROJ-42-add-login"

# ── Cases: printed type lists come from VALID_TYPES ───────────────────────────

expect_types_listed

# ── Cases: argument handling ──────────────────────────────────────────────────

expect_usage_error

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
