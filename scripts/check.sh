#!/usr/bin/env bash
# Run every repo check and report each as PASS, FAIL or SKIP.
#
#   bash scripts/check.sh
#
# This is the one entry point for local runs and for the plugin-check CI job
# (.github/workflows/plugin-check.yml), so the two cannot drift. Steps, in
# order:
#
#   node-syntax    node --check on each .js file under hooks/, one run per file
#                  (node checks only the first file it is given)
#   node-tests     node --test hooks/test/*.test.js
#   pytest         every test_*.py in the repo, from the repo root; two files
#                  with the same basename would clash, so keep them unique
#   gen-catalog    python3 scripts/gen-catalog.py --check
#   gen-bootstrap  python3 scripts/gen-bootstrap.py --check
#   version-files  bash scripts/bump-version.sh --check
#   bash-tests     every skills/**/scripts/test-*.sh at any depth, plus
#                  scripts/test-*.sh
#
# Every step runs even if an earlier one failed, so one run lists every
# problem. A step with nothing to run is a SKIP, never a FAIL. A failing
# step prints its output indented under its FAIL line. The last line is
# "ALL CHECKS PASSED" (exit 0) or "CHECKS FAILED: <n>" (exit 1), where <n>
# counts failed steps. No `set -e`, because one failure must not stop the
# run. Written for bash 3.2 (macOS).

cd "$(dirname "$0")/.." || exit 1

FAILS=0

# find expression that skips directories no check should look inside.
PRUNE=( \( -name .git -o -name .worktrees -o -name node_modules -o -name __pycache__ \) -prune -o )

pass() { echo "PASS $1"; }

skip() { echo "SKIP $1: $2"; }

# fail <step> <detail> <command output>
fail() {
  local body
  echo "FAIL $1: $2"
  # Indent non-empty lines only, and let $(...) drop trailing blank lines.
  body=$(printf '%s\n' "$3" | sed 's/^\(.\)/    \1/')
  if [ -n "$body" ]; then
    printf '%s\n' "$body"
  fi
  FAILS=$((FAILS + 1))
}

# run_step <step> <command...>: PASS if the command exits 0, else FAIL.
run_step() {
  local step=$1 out rc
  shift
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "$step"
  else
    fail "$step" "exit $rc" "$out"
  fi
}

step_node_syntax() {
  local files f out o total=0 bad=0 first=""
  files=$(find hooks "${PRUNE[@]}" -type f -name '*.js' -print 2>/dev/null | sort)
  if [ -z "$files" ]; then
    skip node-syntax "no files"
    return
  fi
  out=""
  while IFS= read -r f; do
    total=$((total + 1))
    if ! o=$(node --check "$f" 2>&1); then
      bad=$((bad + 1))
      if [ -z "$first" ]; then first=$f; fi
      out="$out$o"$'\n'
    fi
  done <<< "$files"
  if [ "$bad" -eq 0 ]; then
    pass node-syntax
  else
    fail node-syntax "$bad of $total files failed, first: $first" "$out"
  fi
}

step_node_tests() {
  local files=() f
  for f in hooks/test/*.test.js; do
    if [ -f "$f" ]; then files+=("$f"); fi
  done
  if [ "${#files[@]}" -eq 0 ]; then
    skip node-tests "no files"
    return
  fi
  run_step node-tests node --test "${files[@]}"
}

step_pytest() {
  local out rc
  out=$(PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider 2>&1)
  rc=$?
  case "$rc" in
    0) pass pytest ;;
    5) skip pytest "no files" ;; # pytest exit 5: nothing collected
    *) fail pytest "exit $rc" "$out" ;;
  esac
}

step_bash_tests() {
  local files f out o total=0 bad=0 first=""
  files=$(
    {
      find skills "${PRUNE[@]}" -type f -path '*/scripts/test-*.sh' -print 2>/dev/null
      find scripts -maxdepth 1 -type f -name 'test-*.sh' -print 2>/dev/null
    } | sort -u
  )
  if [ -z "$files" ]; then
    skip bash-tests "no files"
    return
  fi
  out=""
  while IFS= read -r f; do
    total=$((total + 1))
    if ! o=$(bash "$f" 2>&1); then
      bad=$((bad + 1))
      if [ -z "$first" ]; then first=$f; fi
      out="$out$f"$'\n'"$o"$'\n'
    fi
  done <<< "$files"
  if [ "$bad" -eq 0 ]; then
    pass bash-tests
  else
    fail bash-tests "$bad of $total files failed, first: $first" "$out"
  fi
}

step_node_syntax
step_node_tests
step_pytest
run_step gen-catalog python3 scripts/gen-catalog.py --check
run_step gen-bootstrap python3 scripts/gen-bootstrap.py --check
run_step version-files bash scripts/bump-version.sh --check
step_bash_tests

if [ "$FAILS" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
fi
echo "CHECKS FAILED: $FAILS"
exit 1
