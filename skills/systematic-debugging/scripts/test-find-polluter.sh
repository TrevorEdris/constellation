#!/usr/bin/env bash
# test-find-polluter.sh — Regression tests for find-polluter.sh
#
# Why this exists: the v5.0.5 find-polluter.sh reported "Found 1 test files"
# for two files, for zero files and for a './'-prefixed pattern. `find . -path`
# never matches a pattern written without './', and `echo "" | wc -l` counts an
# empty list as one line. With no files matched, the bisection loop never ran,
# so the script could not find a polluter at all. These tests pin the counting
# and matching behavior.
#
# Each case builds a fresh temp tree (src/top.test.ts, src/sub/nested.test.ts),
# cd's into it and runs the real script. The only fake is `npm`, put first on
# PATH: it exits 0 and creates .polluted when the test file it is given has
# "nested" in its name. That stands in for the external test runner; the
# counting, matching and bisection under test are the real script's.
#
# Usage: test-find-polluter.sh
#
# Output:
#   ok   / not ok  per case, then a summary line
#
# Exit codes:
#   0  - All cases passed
#   1  - One or more cases failed
#
# Note: find-polluter.sh is invoked via `bash`, the way the skill documents it,
# so the test does not depend on the exec bit that packagers can strip.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/find-polluter.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

# The stand-in test runner. find-polluter.sh calls `npm test <file>`, so the
# file name is $2. Exit 0 either way, as the real script ignores the result.
FAKE_BIN="$WORK/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
case "${2:-}" in
  *nested*) : > .polluted ;;
esac
exit 0
EOF
chmod +x "$FAKE_BIN/npm"

# new_fixture: print the path of a fresh tree holding one top-level and one
# nested test file. Fresh per case so a .polluted from one case cannot leak.
# mktemp, not a counter: this runs inside $(...), where a counter would reset.
new_fixture() {
  local dir
  dir="$(mktemp -d "$WORK/fixture.XXXXXX")"
  mkdir -p "$dir/src/sub"
  : > "$dir/src/top.test.ts"
  : > "$dir/src/sub/nested.test.ts"
  echo "$dir"
}

# run_polluter <pattern> <target>: run the script inside a fresh fixture with
# the fake npm first on PATH. Sets OUT (stdout+stderr) and STATUS.
run_polluter() {
  local dir
  dir="$(new_fixture)"
  OUT="$(cd "$dir" && PATH="$FAKE_BIN:$PATH" bash "$TARGET" "$2" "$1" 2>&1)"
  STATUS=$?
}

# expect_count <case-name> <pattern> <expected-count>: the pattern must report
# exactly that many files, and finding nothing must exit 0. The target is a
# path the fake npm never creates, so the run always ends clean.
expect_count() {
  local name="$1" pattern="$2" want="$3" got
  run_polluter "$pattern" "never-created"
  if [ "$STATUS" -eq 0 ] && printf '%s\n' "$OUT" | grep -Fxq "Found $want test files"; then
    report ok "$name"
  else
    got="$(printf '%s\n' "$OUT" | grep '^Found ' | head -1)"
    report "not ok" "$name" "expected 'Found $want test files' and exit 0, got exit $STATUS: ${got:-<no Found line>}"
  fi
}

# ── Cases: counting ───────────────────────────────────────────────────────────

# 'src/**/*.test.ts' must cover src/top.test.ts as well as src/sub/nested.test.ts.
expect_count "counts top-level and nested" 'src/**/*.test.ts' 2

# Zero matches is zero, not one.
expect_count "zero matches" 'none/**/*.test.ts' 0

# find prints './'-prefixed paths, so a pattern written with './' must work.
expect_count "leading ./ pattern" './src/**/*.test.ts' 2

# ── Cases: bisection ──────────────────────────────────────────────────────────

# Without './' on the pattern the old script matched nothing and never ran a
# test. nested.test.ts is the one the fake npm turns into a polluter.
run_polluter 'src/**/*.test.ts' ".polluted"
if [ "$STATUS" -eq 1 ] \
  && printf '%s\n' "$OUT" | grep -Fq "FOUND POLLUTER" \
  && printf '%s\n' "$OUT" | grep -Fq "src/sub/nested.test.ts"; then
  report ok "finds the polluter"
else
  report "not ok" "finds the polluter" "expected exit 1 naming FOUND POLLUTER and src/sub/nested.test.ts, got exit $STATUS"
fi

# ── Cases: argument handling ──────────────────────────────────────────────────

OUT="$(cd "$WORK" && bash "$TARGET" 2>&1)"
STATUS=$?
if [ "$STATUS" -eq 1 ] && printf '%s\n' "$OUT" | grep -Fq "Usage:"; then
  report ok "usage error"
else
  report "not ok" "usage error" "expected exit 1 and 'Usage:', got exit $STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
