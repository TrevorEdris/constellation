#!/usr/bin/env bash
# branch-check.sh — Validate a branch name against naming conventions
#
# Names are lowercase "<type>/<description>". The one uppercase exception is a
# ticket ID right after the type (feature/PROJ-42-add-login); suggestions keep it.
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

# ── Constants ─────────────────────────────────────────────────────────────────

# Single source of truth for the type list: every printed list derives from it.
VALID_TYPES="feature|feat|fix|hotfix|chore|docs|refactor|test|release|experiment|ci|perf"
MAX_TOTAL_LEN=100
MAX_DESC_LEN=50

# A ticket ID (PROJ-42) directly after "<type>/" may be uppercase; nothing else
# may. It needs digits after the hyphen and ends at '-' or the end of the name.
TICKET_RE='^[A-Z][A-Z0-9]*-[0-9]+(-|$)'

# ── Usage ─────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Usage: branch-check.sh <branch-name>"
  echo ""
  echo "Examples:"
  echo "  branch-check.sh 'feature/PROJ-123-add-oauth-login'   # PASS"
  echo "  branch-check.sh 'Feature/AddOAuthLogin'              # FAIL"
  echo "  branch-check.sh 'fix/null-pointer-on-logout'         # PASS"
  echo ""
  echo "Valid types: ${VALID_TYPES//|/, }"
  exit 2
fi

BRANCH="$1"

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
      FAILURES+=("Unknown type '$TYPE'. Valid types: ${VALID_TYPES//|/, }")
      SUGGESTIONS+=("feature/$REST")
    fi
  fi
fi

# ── Split off a leading ticket ID ─────────────────────────────────────────────
#
# TICKET keeps its case and trailing hyphen (e.g. "PROJ-42-"). Only a name that
# has a type prefix can carry one. DESC_WITHOUT_TICKET is what the uppercase and
# description-length checks look at.

TICKET=""
DESC_WITHOUT_TICKET="$REST"
if [ -n "$TYPE" ] && [[ "$REST" =~ $TICKET_RE ]]; then
  TICKET="${BASH_REMATCH[0]}"
  DESC_WITHOUT_TICKET="${REST#"$TICKET"}"
fi

lowercase() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# The name in lowercase, with the ticket ID left as typed.
if [ -n "$TICKET" ]; then
  LOWERED="$(lowercase "$TYPE")/$TICKET$(lowercase "$DESC_WITHOUT_TICKET")"
  UPPERCASE_SUBJECT="$TYPE/$DESC_WITHOUT_TICKET"
else
  LOWERED="$(lowercase "$BRANCH")"
  UPPERCASE_SUBJECT="$BRANCH"
fi

# ── Check: No uppercase letters (a leading ticket ID excepted) ────────────────

if echo "$UPPERCASE_SUBJECT" | grep -q '[A-Z]'; then
  FAILURES+=("Contains uppercase letters")
  SUGGESTIONS+=("$LOWERED")
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
#
# The hyphen must come last and unescaped in both classes below. Inside a POSIX
# bracket expression a backslash is a literal character, not an escape, so the
# earlier form '[^a-zA-Z0-9/\-\.]' parsed the hyphen as a range operator
# spanning '\' to '\'. That silently dropped the literal hyphen from the allowed
# set and rejected nearly every conventional branch name.

if echo "$BRANCH" | grep -qE '[^a-zA-Z0-9/._-]'; then
  FAILURES+=("Contains invalid special characters. Only alphanumerics, '/', '-', and '.' are allowed")
  CLEAN=$(echo "$BRANCH" | sed 's|[^a-zA-Z0-9/._-]|-|g')
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
  # The ticket ID (e.g. PROJ-123-) does not count toward the description.
  DESC_LEN=${#DESC_WITHOUT_TICKET}
  if [ "$DESC_LEN" -gt "$MAX_DESC_LEN" ]; then
    FAILURES+=("Description segment is ${DESC_LEN} chars (max ${MAX_DESC_LEN}): '$DESC_WITHOUT_TICKET'")
    TRUNCATED=$(echo "$DESC_WITHOUT_TICKET" | cut -c1-"$MAX_DESC_LEN" | sed 's/-[^-]*$//')
    SUGGESTIONS+=("$TYPE/$TICKET$TRUNCATED")
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
    # LOWERED already keeps a leading ticket ID's case, so the character
    # class admits A-Z: only that ticket can still be uppercase here.
    CORRECTED="$LOWERED"
    CORRECTED=$(echo "$CORRECTED" | tr '_' '-')
    CORRECTED=$(echo "$CORRECTED" | tr ' ' '-')
    CORRECTED=$(echo "$CORRECTED" | sed 's|[^A-Za-z0-9/._-]|-|g')
    CORRECTED=$(echo "$CORRECTED" | sed 's/[-\/]*$//')
    echo "  Suggestion: $CORRECTED"
  fi
  exit 1
fi
