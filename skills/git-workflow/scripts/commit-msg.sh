#!/usr/bin/env bash
# commit-msg.sh — Analyze staged changes and suggest a conventional commit message
#
# Usage: commit-msg.sh
#
# Reads staged diff from git, outputs:
#   TYPE:  Suggested commit type (feat, fix, refactor, etc.)
#   SCOPE: Suggested scope (package/module/component name)
#   DESC:  Suggested short description
#   FULL:  Formatted conventional commit subject line
#
# Exit codes:
#   0  - Success, suggestions printed to stdout
#   1  - Not in a git repository
#   2  - No staged changes found
set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

die() {
  echo "ERROR: $*" >&2
  exit "${2:-1}"
}

# ── Verify git context ────────────────────────────────────────────────────────

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  die "Not in a git repository" 1
fi

# ── Collect staged diff information ──────────────────────────────────────────

STAGED_STAT=$(git diff --cached --stat 2>/dev/null)
if [ -z "$STAGED_STAT" ]; then
  die "No staged changes. Stage files with 'git add' before running this script." 2
fi

# Get list of staged files with change type
STAGED_FILES=$(git diff --cached --name-status 2>/dev/null)
# Get just the file names
STAGED_NAMES=$(git diff --cached --name-only 2>/dev/null)
# Count files changed
FILE_COUNT=$(echo "$STAGED_NAMES" | grep -c . || true)

# ── Detect file categories ────────────────────────────────────────────────────

# Test files
TEST_FILES=$(echo "$STAGED_NAMES" | grep -iE '(_test\.|\.test\.|_spec\.|\.spec\.|tests/|test/|__tests__/)' || true)
TEST_COUNT=$(echo "$TEST_FILES" | grep -c . || true)

# Documentation files
DOC_FILES=$(echo "$STAGED_NAMES" | grep -iE '\.(md|rst|txt|adoc)$|^docs/|^documentation/' || true)
DOC_COUNT=$(echo "$DOC_FILES" | grep -c . || true)

# CI/CD files
CI_FILES=$(echo "$STAGED_NAMES" | grep -iE '(\.github/workflows/|\.gitlab-ci|Jenkinsfile|\.circleci|\.buildkite|\.drone)' || true)
CI_COUNT=$(echo "$CI_FILES" | grep -c . || true)

# Build / config / dependency files
BUILD_FILES=$(echo "$STAGED_NAMES" | grep -iE '(Makefile|Taskfile|Dockerfile|\.dockerignore|package\.json|go\.mod|go\.sum|requirements.*\.txt|Pipfile|pyproject\.toml|\.github/(?!workflows))' || true)
BUILD_COUNT=$(echo "$BUILD_FILES" | grep -c . || true)

# Deleted files
DELETED_FILES=$(echo "$STAGED_FILES" | awk '$1 == "D" { print $2 }' || true)
DELETED_COUNT=$(echo "$DELETED_FILES" | grep -c . || true)

# Added files (new)
ADDED_FILES=$(echo "$STAGED_FILES" | awk '$1 == "A" { print $2 }' || true)
ADDED_COUNT=$(echo "$ADDED_FILES" | grep -c . || true)

# Modified files
MODIFIED_COUNT=$(echo "$STAGED_FILES" | awk '$1 == "M"' | grep -c . || true)

# ── Detect scope from file paths ──────────────────────────────────────────────

detect_scope() {
  local files="$1"
  if [ -z "$files" ]; then
    echo ""
    return
  fi

  # Extract the first directory component(s) of the changed paths
  # Try to find the most common top-level directory
  local top_dirs
  top_dirs=$(echo "$files" | awk -F/ '{ if (NF > 1) print $1 }' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')

  # If files are spread across multiple dirs, try second-level
  local dir_count
  dir_count=$(echo "$files" | awk -F/ '{ if (NF > 1) print $1 }' | sort -u | wc -l | tr -d ' ')

  if [ "$dir_count" -le 1 ] && [ -n "$top_dirs" ]; then
    echo "$top_dirs"
  elif [ "$dir_count" -gt 1 ]; then
    # Multiple top-level dirs — scope is ambiguous, try to find a common parent
    local common
    common=$(echo "$files" | awk -F/ '{ if (NF > 2) print $1"/"$2 }' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
    if [ -n "$common" ]; then
      echo "$common"
    else
      echo ""
    fi
  else
    echo ""
  fi
}

SCOPE=$(detect_scope "$STAGED_NAMES")

# ── Determine commit type ─────────────────────────────────────────────────────

determine_type() {
  # Pure test changes
  if [ "$TEST_COUNT" -gt 0 ] && [ "$FILE_COUNT" -eq "$TEST_COUNT" ]; then
    echo "test"
    return
  fi

  # Pure documentation changes
  if [ "$DOC_COUNT" -gt 0 ] && [ "$FILE_COUNT" -eq "$DOC_COUNT" ]; then
    echo "docs"
    return
  fi

  # Pure CI changes
  if [ "$CI_COUNT" -gt 0 ] && [ "$FILE_COUNT" -eq "$CI_COUNT" ]; then
    echo "ci"
    return
  fi

  # Pure build/config/dependency changes (no test or doc files)
  if [ "$BUILD_COUNT" -gt 0 ] && [ "$FILE_COUNT" -eq "$BUILD_COUNT" ]; then
    echo "chore"
    return
  fi

  # All files are deletions — likely a cleanup/refactor
  if [ "$DELETED_COUNT" -gt 0 ] && [ "$FILE_COUNT" -eq "$DELETED_COUNT" ]; then
    echo "refactor"
    return
  fi

  # New files added (but not test or doc) — likely a feature
  if [ "$ADDED_COUNT" -gt 0 ] && [ "$MODIFIED_COUNT" -eq 0 ] && [ "$DELETED_COUNT" -eq 0 ]; then
    echo "feat"
    return
  fi

  # Mix of new and modified files — could be feature or fix
  # Default to feat for new additions, fix otherwise
  if [ "$ADDED_COUNT" -gt 0 ]; then
    echo "feat"
  else
    echo "fix"
  fi
}

COMMIT_TYPE=$(determine_type)

# ── Generate description hint ─────────────────────────────────────────────────

generate_desc_hint() {
  local type="$1"
  local scope="$2"
  local file_count="$3"

  case "$type" in
    feat)
      echo "add <describe new capability>"
      ;;
    fix)
      echo "fix <describe the incorrect behavior>"
      ;;
    refactor)
      echo "extract/restructure <describe what changed structurally>"
      ;;
    test)
      echo "add tests for <component or behavior>"
      ;;
    docs)
      echo "document <what was documented>"
      ;;
    chore)
      echo "update <dependency or tooling>"
      ;;
    ci)
      echo "add/update <pipeline or job name>"
      ;;
    *)
      echo "<describe the change in imperative mood>"
      ;;
  esac
}

DESC_HINT=$(generate_desc_hint "$COMMIT_TYPE" "$SCOPE" "$FILE_COUNT")

# ── Format scope for output ───────────────────────────────────────────────────

if [ -n "$SCOPE" ]; then
  SCOPE_DISPLAY="($SCOPE)"
  FULL_SUBJECT="${COMMIT_TYPE}${SCOPE_DISPLAY}: ${DESC_HINT}"
else
  SCOPE_DISPLAY=""
  FULL_SUBJECT="${COMMIT_TYPE}: ${DESC_HINT}"
fi

# ── Output ────────────────────────────────────────────────────────────────────

echo ""
echo "=== Staged Changes Summary ==="
echo "$STAGED_STAT"
echo ""
echo "=== Suggested Conventional Commit ==="
echo "TYPE:  $COMMIT_TYPE"
echo "SCOPE: ${SCOPE:-<none detected — set manually>}"
echo "DESC:  $DESC_HINT"
echo ""
echo "FULL:  $FULL_SUBJECT"
echo ""
echo "=== File Breakdown ==="
echo "  Total staged: $FILE_COUNT"
[ "$ADDED_COUNT" -gt 0 ]    && echo "  Added:    $ADDED_COUNT"
[ "$MODIFIED_COUNT" -gt 0 ] && echo "  Modified: $MODIFIED_COUNT"
[ "$DELETED_COUNT" -gt 0 ]  && echo "  Deleted:  $DELETED_COUNT"
[ "$TEST_COUNT" -gt 0 ]     && echo "  Test files: $TEST_COUNT"
[ "$DOC_COUNT" -gt 0 ]      && echo "  Doc files:  $DOC_COUNT"
[ "$CI_COUNT" -gt 0 ]       && echo "  CI files:   $CI_COUNT"
echo ""
echo "Edit the FULL line above, then commit:"
echo "  git commit -m \"<your message>\""
