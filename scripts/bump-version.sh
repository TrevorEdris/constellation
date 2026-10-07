#!/usr/bin/env bash
# Bump the constellation plugin version in one step, or verify the version
# files agree. Plugin changes must bump .claude-plugin/plugin.json and
# .claude-plugin/marketplace.json together and date a CHANGELOG.md entry; this
# keeps those three edits mechanical so a stack of PRs cannot drift.
#
#   bash scripts/bump-version.sh <X.Y.Z> --note "<text>" [--note "<text>"]...
#   bash scripts/bump-version.sh --next [--base <ref>] --note "<text>"...
#   bash scripts/bump-version.sh --check
#
# --next picks X.(Y+1).0 of the higher of origin/main and --base (use --base
#   <parent branch> inside a stack, whose parent is ahead of origin/main). It
#   reads those refs with `git show` and never fetches, so fetch first.
# --check exits 0 only if plugin.json and marketplace.json carry the same
#   version and CHANGELOG.md has a `## <version>` heading with a `- ` line.
#
# Acts on the git toplevel of the current directory, not on the repo that
# holds this script, so it can bump any worktree. It refuses (exit 1, writes
# nothing) if the new version is not above the tree's, if its CHANGELOG
# heading already exists, or if a manifest does not hold exactly one
# "version" key. Exit codes: 0 ok, 1 refused or failed, 2 usage error.
set -u

usage() {
  cat >&2 <<'EOF'
usage:
  bash scripts/bump-version.sh <X.Y.Z> --note "<text>" [--note "<text>"]...
  bash scripts/bump-version.sh --next [--base <ref>] --note "<text>" [--note "<text>"]...
  bash scripts/bump-version.sh --check
EOF
  exit 2
}

usage_error() {
  echo "bump-version: $1" >&2
  usage
}

CHECK=0
NEXT=0
VERSION=""
BASE=""
NOTES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --next) NEXT=1; shift ;;
    --base)
      [ $# -ge 2 ] || usage_error "--base needs a ref"
      case "$2" in
        ''|-*) usage_error "--base needs a ref, got '$2'" ;;
      esac
      BASE="$2"; shift 2 ;;
    --note)
      [ $# -ge 2 ] && [ -n "$2" ] || usage_error "--note needs non-empty text"
      NOTES+=("$2"); shift 2 ;;
    -*) usage_error "unknown option: $1" ;;
    *)
      [ -z "$VERSION" ] || usage_error "more than one version given"
      VERSION="$1"; shift ;;
  esac
done

SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

if [ "$CHECK" = 1 ]; then
  [ "$NEXT" = 0 ] && [ -z "$VERSION" ] && [ -z "$BASE" ] && [ ${#NOTES[@]} -eq 0 ] \
    || usage_error "--check takes no other arguments"
  MODE=check
else
  if [ "$NEXT" = 1 ]; then
    [ -z "$VERSION" ] || usage_error "give either a version or --next, not both"
    MODE=next
  else
    [ -n "$VERSION" ] || usage_error "give a version, --next, or --check"
    [ -z "$BASE" ] || usage_error "--base only applies to --next"
    [[ $VERSION =~ $SEMVER ]] || usage_error "version must look like X.Y.Z, got '$VERSION'"
    MODE=explicit
  fi
  [ ${#NOTES[@]} -gt 0 ] || usage_error "--note is required"
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "bump-version: not inside a git work tree" >&2
  exit 1
}

# The logic below needs JSON parsing and multi-line text edits, which python3
# does without a jq dependency. "${NOTES[@]+...}" keeps an empty array legal
# under `set -u` on bash 3.2.
exec python3 - "$ROOT" "$MODE" "$VERSION" "$BASE" ${NOTES[@]+"${NOTES[@]}"} <<'PY'
import json
import os
import re
import subprocess
import sys
from datetime import date

root, mode, explicit_version, base = sys.argv[1:5]
notes = sys.argv[5:]

PLUGIN_NAME = "constellation"
PLUGIN = ".claude-plugin/plugin.json"
MARKET = ".claude-plugin/marketplace.json"
CHANGELOG = "CHANGELOG.md"

SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
VERSION_KEY = re.compile(r'"version"\s*:')
VERSION_VALUE = re.compile(r'("version"\s*:\s*")([^"]*)(")')
LINE_HEADING = re.compile(r"^## ", re.M)


def fail(message):
    print("bump-version: " + message, file=sys.stderr)
    sys.exit(1)


def read(rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", newline="") as fh:
            return fh.read()
    except (OSError, ValueError) as err:
        fail("cannot read %s: %s" % (rel, err))


def write(rel, text):
    # newline="" keeps the file's own line endings byte for byte.
    with open(os.path.join(root, rel), "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def parse_json(label, text):
    try:
        return json.loads(text)
    except ValueError as err:
        fail("%s is not valid JSON: %s" % (label, err))


def version_of(label, obj):
    value = obj.get("version") if isinstance(obj, dict) else None
    if not isinstance(value, str) or not value:
        fail("%s has no string \"version\"" % label)
    return value


def semver_of(label, obj):
    value = version_of(label, obj)
    if not SEMVER.match(value):
        fail("%s version %r is not X.Y.Z" % (label, value))
    return value


def as_tuple(version):
    return tuple(int(part) for part in version.split("."))


def market_entry(data):
    plugins = data.get("plugins") if isinstance(data, dict) else None
    for entry in plugins if isinstance(plugins, list) else []:
        if isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME:
            return entry
    fail("%s has no plugins entry named %s" % (MARKET, PLUGIN_NAME))


def heading_for(version):
    # `## <version>` followed by a space or the end of the line, so 0.1.0 does
    # not match a 0.1.01 heading.
    return re.compile(r"^## " + re.escape(version) + r"(?: |\r?$)", re.M)


def ref_version(ref):
    label = "%s at %s" % (PLUGIN, ref)
    proc = subprocess.run(
        ["git", "show", "%s:%s" % (ref, PLUGIN)],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
    )
    if proc.returncode != 0:
        first = (proc.stderr.strip().splitlines() or ["git show failed"])[0]
        fail("cannot read %s (this script never fetches): %s" % (label, first))
    return semver_of(label, parse_json(label, proc.stdout))


def check():
    plugin_version = version_of(PLUGIN, parse_json(PLUGIN, read(PLUGIN)))
    market_version = version_of(MARKET, market_entry(parse_json(MARKET, read(MARKET))))
    if plugin_version != market_version:
        fail("version mismatch: %s is %s but %s is %s"
             % (PLUGIN, plugin_version, MARKET, market_version))

    log = read(CHANGELOG)
    heading = heading_for(plugin_version).search(log)
    if not heading:
        fail("%s has no '## %s' heading" % (CHANGELOG, plugin_version))
    # The entry body runs from the line after the heading to the next `## `.
    line_end = log.find("\n", heading.end())
    body_start = len(log) if line_end == -1 else line_end + 1
    following = LINE_HEADING.search(log, body_start)
    body = log[body_start:following.start() if following else len(log)]
    if not re.search(r"^- ", body, re.M):
        fail("%s entry '## %s' has no '- ' line" % (CHANGELOG, plugin_version))
    print("version files agree: %s" % plugin_version)


def bump():
    plugin_text = read(PLUGIN)
    market_text = read(MARKET)
    log = read(CHANGELOG)

    plugin = parse_json(PLUGIN, plugin_text)
    old = semver_of(PLUGIN, plugin)

    if mode == "next":
        refs = ["origin/main"] + ([base] if base else [])
        top = max((ref_version(ref) for ref in refs), key=as_tuple)
        major, minor, _ = as_tuple(top)
        new = "%d.%d.0" % (major, minor + 1)
    else:
        new = explicit_version

    if as_tuple(new) <= as_tuple(old):
        hint = ("; in a stack, pass --base <parent branch> so --next builds on its version"
                if mode == "next" else "")
        fail("new version %s is not above the tree's version %s%s" % (new, old, hint))
    if heading_for(new).search(log):
        fail("%s already has a '## %s' heading" % (CHANGELOG, new))
    for rel, text in ((PLUGIN, plugin_text), (MARKET, market_text)):
        count = len(VERSION_KEY.findall(text))
        if count != 1:
            fail("%s has %d \"version\" keys, expected exactly 1" % (rel, count))

    # Replace only the version string, so the rest of each file stays byte for
    # byte, then re-parse to prove the edit changed nothing but the version.
    def swap(text):
        return VERSION_VALUE.sub(lambda m: m.group(1) + new + m.group(3), text, count=1)

    new_plugin = swap(plugin_text)
    expected = parse_json(PLUGIN, plugin_text)
    expected["version"] = new
    if parse_json(PLUGIN, new_plugin) != expected:
        fail("editing %s would change more than its version" % PLUGIN)

    new_market = swap(market_text)
    expected = parse_json(MARKET, market_text)
    market_entry(expected)["version"] = new
    if parse_json(MARKET, new_market) != expected:
        fail("editing %s would change more than the %s version" % (MARKET, PLUGIN_NAME))

    # The old entry stops being unreleased; the new one goes above the first heading.
    unreleased = re.compile(r"^(## " + re.escape(old) + r") \(unreleased\)(?=[ \t]*\r?$)", re.M)
    new_log = unreleased.sub(lambda m: m.group(1), log, count=1)
    first = LINE_HEADING.search(new_log)
    if not first:
        fail("%s has no '## ' heading to add the new entry above" % CHANGELOG)
    entry = "## %s (%s)\n\n%s\n" % (new, date.today().isoformat(), "".join("- %s\n" % n for n in notes))
    new_log = new_log[:first.start()] + entry + new_log[first.start():]

    write(PLUGIN, new_plugin)
    write(MARKET, new_market)
    write(CHANGELOG, new_log)
    print("bumped %s -> %s" % (old, new))


if mode == "check":
    check()
else:
    bump()
PY
