#!/usr/bin/env bash
# Scaffold a session directory from templates with frontmatter pre-filled, and
# set the .active pointer so the session-doc hooks target THIS session.
#
#   scripts/new-session.sh <title-slug> [ticket] [session-id]
#
# Env: SESSION_ROOT (default ~/src/.ai/sessions)
set -euo pipefail

SLUG="${1:?usage: new-session.sh <title-slug> [ticket] [session-id]}"
TICKET="${2:-}"
SESSION_ID="${3:-}"
ROOT="${SESSION_ROOT:-$HOME/src/.ai/sessions}"
PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
DATE="$(date +%F)"

NAME="${DATE}_${TICKET:+${TICKET}_}${SLUG}"
DIR="$ROOT/$NAME"
mkdir -p "$DIR"
[ -z "$SESSION_ID" ] && SESSION_ID="${DATE}_${SLUG}"

fill() { # template -> dest
  sed -e "s|{{DATE}}|$DATE|g" -e "s|{{SLUG}}|$SLUG|g" -e "s|{{SESSION_ID}}|$SESSION_ID|g" "$1" > "$2"
}

[ -f "$DIR/SESSION.md" ]   || fill "$PLUGIN/docs/SESSION-TEMPLATE.md"   "$DIR/SESSION.md"
[ -f "$DIR/DISCOVERY.md" ] || fill "$PLUGIN/docs/DISCOVERY-TEMPLATE.md" "$DIR/DISCOVERY.md"
[ -f "$DIR/PLAN.md" ]      || fill "$PLUGIN/docs/PLAN-TEMPLATE.md"      "$DIR/PLAN.md"

printf '%s\n' "$NAME" > "$ROOT/.active"
printf '%s\n' "$DIR"
