#!/usr/bin/env bash
# Scaffold a session directory holding a SESSION.md stamped with the session id,
# and point the id at the directory so the session-doc hooks find it again.
#
#   bash scripts/new-session.sh <title-slug> [ticket] [session-id]
#
# The last line of stdout is the realpath of the session dir.
#
# Env:
#   SESSION_ROOT            sessions root (default ~/src/.ai/sessions)
#   SESSION_DATE            YYYY-MM-DD used in the dir name and SESSION.md. The
#                           Stop hook passes its own local date so both agree;
#                           by default it is today's local date.
#   CLAUDE_CODE_SESSION_ID  session id, used when no third argument is given
#
# The id is the third argument, else CLAUDE_CODE_SESSION_ID, else "<date>_<slug>".
# That last form is only stamped; a pointer (<root>/.sessions/<id>, holding the
# dir's realpath) is written only for an id that was supplied.
#
# A dir that exists already is reused only when its SESSION.md carries the same
# id; otherwise the name gets a -2 .. -99 suffix, so parallel sessions with the
# same title never share a dir.
#
# Exit: 0 ok, 1 runtime failure, 2 usage or invalid input (nothing is written).
set -eu
unset CDPATH
export LC_ALL=C # the regex ranges below mean ASCII only

die() { # <exit code> <message>
  echo "new-session.sh: $2" >&2
  exit "$1"
}

# The top-level session_id of a SESSION.md's leading frontmatter block, or nothing.
session_id_of() {
  awk -v q="'" '
    NR == 1 { if ($0 != "---") exit; next }
    $0 == "---" { exit }
    /^session_id:/ {
      v = $0
      sub(/^session_id:[ \t]*/, "", v)
      sub(/[ \t]+#.*$/, "", v)
      sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ ("^" q ".*" q "$")) v = substr(v, 2, length(v) - 2)
      print v
      exit
    }' "$1" 2>/dev/null || true
}

NAME_RE='^[A-Za-z0-9][A-Za-z0-9_-]*$'
ID_RE='^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'

SLUG="${1:-}"
TICKET="${2:-}"
SESSION_ID="${3:-}"
ROOT="${SESSION_ROOT:-$HOME/src/.ai/sessions}"
PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$PLUGIN/docs/SESSION-TEMPLATE.md"
DATE="${SESSION_DATE:-$(date +%F)}"

# Validate everything before touching disk. The slug, date and id are also
# substituted into the template by sed below, so their charsets must exclude
# sed's delimiter, "&" and "\".
[[ $SLUG =~ $NAME_RE ]] || die 2 "usage: new-session.sh <title-slug> [ticket] [session-id]; invalid slug: $SLUG"
if [ -n "$TICKET" ]; then
  [[ $TICKET =~ $NAME_RE ]] || die 2 "invalid ticket: $TICKET"
fi
[[ $DATE =~ $DATE_RE ]] || die 2 "invalid SESSION_DATE: $DATE"

BIND=1
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"
fi
if [ -n "$SESSION_ID" ]; then
  [[ $SESSION_ID =~ $ID_RE ]] || die 2 "invalid session id: $SESSION_ID"
else
  SESSION_ID="${DATE}_${SLUG}"
  BIND=0
fi

[ -f "$TEMPLATE" ] || die 1 "missing template: $TEMPLATE"
err=$(mkdir -p "$ROOT" 2>&1) || die 1 "cannot create session root: $err"

# Take the first free name. mkdir without -p is atomic, so two sessions that
# race for one name cannot both win it.
BASE="${DATE}_${TICKET:+${TICKET}_}${SLUG}"
N=1
while :; do
  if [ "$N" -eq 1 ]; then NAME="$BASE"; else NAME="$BASE-$N"; fi
  DIR="$ROOT/$NAME"
  if err=$(mkdir "$DIR" 2>&1); then
    FRESH=1
    break
  fi
  [ -e "$DIR" ] || die 1 "cannot create $DIR: $err"
  if [ "$(session_id_of "$DIR/SESSION.md")" = "$SESSION_ID" ]; then
    FRESH=0
    break
  fi
  N=$((N + 1))
  [ "$N" -le 99 ] || die 1 "no free directory name for $BASE (tried suffixes -2 to -99)"
done

if [ "$FRESH" -eq 1 ]; then
  if ! err=$(sed -e "s|{{DATE}}|$DATE|g" -e "s|{{SLUG}}|$SLUG|g" -e "s|{{SESSION_ID}}|$SESSION_ID|g" \
      "$TEMPLATE" 2>&1 > "$DIR/SESSION.md"); then
    rm -f "$DIR/SESSION.md"
    rmdir "$DIR" 2>/dev/null || true
    die 1 "cannot write $DIR/SESSION.md: $err"
  fi
fi

REAL="$(cd "$DIR" && pwd -P)"

if [ "$BIND" -eq 1 ]; then
  POINTERS="$ROOT/.sessions"
  # A leading dot keeps the temp name out of the valid-id namespace.
  TMP="$POINTERS/.tmp-$$"
  if ! err=$( { mkdir -p "$POINTERS" && printf '%s\n' "$REAL" > "$TMP" && mv -f "$TMP" "$POINTERS/$SESSION_ID"; } 2>&1 ); then
    rm -f "$TMP"
    die 1 "cannot write the pointer for session $SESSION_ID: $err"
  fi
fi

printf '%s\n' "$REAL"
