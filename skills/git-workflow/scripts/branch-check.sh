#!/usr/bin/env bash
# branch-check.sh — Validate a branch name against naming conventions
#
# Usage: branch-check.sh <branch-name>
#
# Output:
#   PASS: <branch-name>
#   FAIL: <branch-name>
#     Reason: <explanation>
#     Suggestion: <corrected name>
#
# Exit codes:
#   0  - PASS: Branch name is valid
#   1  - FAIL: Branch name violates one or more conventions
#   2  - Usage error (no argument provided)
set -euo pipefail

# ── Usage ─────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Usage: branch-check.sh <branch-name>"
  echo ""
  echo "Examples:"
  echo "  branch-check.sh 'feature/PROJ-123-add-oauth-login'   # PASS"
  echo "  branch-check.sh 'Feature/AddOAuthLogin'              # FAIL"
  echo "  branch-check.sh 'fix/null-pointer-on-logout'         # PASS"
  echo ""
  echo "Valid types: feature, fix, hotfix, chore, docs, refactor, test, release, experiment"
  exit 2
fi

BRANCH="$1"

# ── Constants ─────────────────────────────────────────────────────────────────

VALID_TYPES="feature|fix|hotfix|chore|docs|refactor|test|release|experiment"
MAX_TOTAL_LEN=100
MAX_DESC_LEN=50

# ── Collect validation failures ───────────────────────────────────────────────

FAILURES=()
SUGGESTIONS=()

# ── Check: Has a type prefix ──────────────────────────────────────────────────

TYPE=$(echo "$BRANCH" | cut -d'/' -f1)
REST=$(echo "$BRANCH" | cut -d'/' -f2-)

if [ "$TYPE" = "$BRANCH" ]; then
  # No slash found — no type prefix at all
  FAILURES+=("Missing type prefix (e.g. 'feature/', 'fix/', 'chore/')")
  SUGGESTIONS+=("feature/$BRANCH")
  TYPE=""
  REST="$BRANCH"
fi

# ── Check: Type is valid ──────────────────────────────────────────────────────

if [ -n "$TYPE" ]; then
  if ! echo "$TYPE" | grep -qE "^($VALID_TYPES)$"; then
    # Check if it's just capitalized
    LOWER_TYPE=$(echo "$TYPE" | tr '[:upper:]' '[:lower:]')
    if echo "$LOWER_TYPE" | grep -qE "^($VALID_TYPES)$"; then
      FAILURES+=("Type '$TYPE' must be lowercase (found uppercase)")
      SUGGESTIONS+=("$LOWER_TYPE/$REST")
    else
      FAILURES+=("Unknown type '$TYPE'. Valid types: feature, fix, hotfix, chore, docs, refactor, test, release, experiment")
      SUGGESTIONS+=("feature/$REST")
    fi
  fi
fi

# ── Check: No uppercase letters ───────────────────────────────────────────────

if echo "$BRANCH" | grep -q '[A-Z]'; then
  LOWER=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]')
  FAILURES+=("Contains uppercase letters")
  SUGGESTIONS+=("$LOWER")
fi

# ── Check: No underscores ─────────────────────────────────────────────────────

if echo "$BRANCH" | grep -q '_'; then
  WITH_HYPHENS=$(echo "$BRANCH" | tr '_' '-')
  FAILURES+=("Contains underscores — use hyphens instead")
  SUGGESTIONS+=("$WITH_HYPHENS")
fi

# ── Check: No spaces ─────────────────────────────────────────────────────────

if echo "$BRANCH" | grep -q ' '; then
  NO_SPACES=$(echo "$BRANCH" | tr ' ' '-')
  FAILURES+=("Contains spaces")
  SUGGESTIONS+=("$NO_SPACES")
fi

# ── Check: No special characters (except /, -, .) ────────────────────────────

if echo "$BRANCH" | grep -qE '[^a-zA-Z0-9/\-\.]'; then
  FAILURES+=("Contains invalid special characters. Only alphanumerics, '/', '-', and '.' are allowed")
  CLEAN=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9\/\-\.]/-/g')
  SUGGESTIONS+=("$CLEAN")
fi

# ── Check: No trailing slash or hyphen ───────────────────────────────────────

if echo "$BRANCH" | grep -qE '[-/]$'; then
  FAILURES+=("Ends with a trailing '-' or '/'")
  TRIMMED=$(echo "$BRANCH" | sed 's/[-\/]*$//')
  SUGGESTIONS+=("$TRIMMED")
fi

# ── Check: Not empty after type ──────────────────────────────────────────────

if [ -n "$TYPE" ] && [ -z "$REST" ]; then
  FAILURES+=("Description segment is empty — add a description after the type prefix")
  SUGGESTIONS+=("$TYPE/describe-the-change")
fi

# ── Check: Description length ─────────────────────────────────────────────────

if [ -n "$REST" ]; then
  # Strip ticket ID prefix if present (e.g., PROJ-123-)
  DESC_WITHOUT_TICKET=$(echo "$REST" | sed 's/^[A-Z][A-Z0-9]*-[0-9]*-//')
  DESC_LEN=${#DESC_WITHOUT_TICKET}
  if [ "$DESC_LEN" -gt "$MAX_DESC_LEN" ]; then
    FAILURES+=("Description segment is ${DESC_LEN} chars (max ${MAX_DESC_LEN}): '$DESC_WITHOUT_TICKET'")
    TRUNCATED=$(echo "$DESC_WITHOUT_TICKET" | cut -c1-"$MAX_DESC_LEN" | sed 's/-[^-]*$//')
    TICKET_PREFIX=$(echo "$REST" | grep -oE '^[A-Z][A-Z0-9]*-[0-9]*-' || true)
    SUGGESTIONS+=("$TYPE/$TICKET_PREFIX$TRUNCATED")
  fi
fi

# ── Check: Total length ───────────────────────────────────────────────────────

TOTAL_LEN=${#BRANCH}
if [ "$TOTAL_LEN" -gt "$MAX_TOTAL_LEN" ]; then
  FAILURES+=("Total length is ${TOTAL_LEN} chars (max ${MAX_TOTAL_LEN})")
fi

# ── Output result ─────────────────────────────────────────────────────────────

if [ "${#FAILURES[@]}" -eq 0 ]; then
  echo "PASS: $BRANCH"
  exit 0
else
  echo "FAIL: $BRANCH"
  echo ""
  for reason in "${FAILURES[@]}"; do
    echo "  Reason: $reason"
  done
  echo ""
  # Show the first suggestion (most relevant fix)
  if [ "${#SUGGESTIONS[@]}" -gt 0 ]; then
    # Apply all suggestions sequentially to produce one final corrected name
    CORRECTED="$BRANCH"
    CORRECTED=$(echo "$CORRECTED" | tr '[:upper:]' '[:lower:]')
    CORRECTED=$(echo "$CORRECTED" | tr '_' '-')
    CORRECTED=$(echo "$CORRECTED" | tr ' ' '-')
    CORRECTED=$(echo "$CORRECTED" | sed 's/[^a-z0-9\/\-\.]/-/g')
    CORRECTED=$(echo "$CORRECTED" | sed 's/[-\/]*$//')
    echo "  Suggestion: $CORRECTED"
  fi
  exit 1
fi
