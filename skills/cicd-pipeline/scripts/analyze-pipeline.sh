#!/usr/bin/env bash
# analyze-pipeline.sh -- Parse existing CI config and report structure, gaps, and anti-patterns
#
# Usage: ./analyze-pipeline.sh [ci-config-path]
#
# If no path is provided, auto-detects:
#   1. .github/workflows/*.yml  (GitHub Actions)
#   2. .gitlab-ci.yml           (GitLab CI)
#
# Outputs a structured analysis of the existing pipeline with pass/warn/fail items.
#
# Exit codes:
#   0 -- Analysis completed
#   1 -- No CI config found and none specified

set -euo pipefail

# ---- Helpers ----------------------------------------------------------------

PASS="[PASS]"
WARN="[WARN]"
FAIL="[FAIL]"
INFO="[INFO]"

pass() { echo "$PASS $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
warn() { echo "$WARN $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { echo "$FAIL $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo "$INFO $1"; }

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

contains_pattern() {
  local file="$1"
  local pattern="$2"
  grep -qE "$pattern" "$file" 2>/dev/null
}

# ---- Config Detection -------------------------------------------------------

CI_TYPE=""
CI_FILES=()

if [[ -n "${1:-}" ]]; then
  if [[ ! -f "$1" ]]; then
    echo "ERROR: Specified config file '$1' does not exist" >&2
    exit 1
  fi
  CI_FILES=("$1")
  if [[ "$1" == *.gitlab-ci.yml ]]; then
    CI_TYPE="gitlab"
  else
    CI_TYPE="github-actions"
  fi
else
  # Auto-detect
  if [[ -d ".github/workflows" ]]; then
    while IFS= read -r -d '' f; do
      CI_FILES+=("$f")
    done < <(find .github/workflows -name "*.yml" -o -name "*.yaml" -print0 2>/dev/null)
    CI_TYPE="github-actions"
  fi

  if [[ -f ".gitlab-ci.yml" ]]; then
    CI_FILES+=(".gitlab-ci.yml")
    CI_TYPE="${CI_TYPE:+mixed}${CI_TYPE:-gitlab}"
  fi
fi

if [[ ${#CI_FILES[@]} -eq 0 ]]; then
  echo "ERROR: No CI configuration found." >&2
  echo "Looked for: .github/workflows/*.yml, .gitlab-ci.yml" >&2
  echo "Specify a config file as the first argument to analyze it directly." >&2
  exit 1
fi

# ---- Analysis ---------------------------------------------------------------

echo "=== CI/CD Pipeline Analysis ==="
echo ""
echo "Platform: $CI_TYPE"
echo "Files analyzed:"
for f in "${CI_FILES[@]}"; do
  echo "  - $f"
done
echo ""

# Combine all files for analysis
COMBINED_CONTENT=""
for f in "${CI_FILES[@]}"; do
  COMBINED_CONTENT+="$(cat "$f")"$'\n'
done

TMP_COMBINED=$(mktemp)
echo "$COMBINED_CONTENT" > "$TMP_COMBINED"
trap 'rm -f "$TMP_COMBINED"' EXIT

# ---- Performance Checks -----------------------------------------------------

echo "--- Performance ---"
echo ""

# Caching
if contains_pattern "$TMP_COMBINED" "actions/cache|cache:"; then
  pass "Caching is configured"
else
  fail "No caching detected -- dependency downloads will run on every job"
fi

# Concurrency controls (GitHub Actions)
if [[ "$CI_TYPE" == "github-actions" ]] || [[ "$CI_TYPE" == "mixed" ]]; then
  if contains_pattern "$TMP_COMBINED" "^concurrency:"; then
    pass "Concurrency group configured -- redundant runs will be cancelled"
  else
    warn "No concurrency group -- redundant runs may execute in parallel (e.g., on force-push)"
  fi
fi

# Interruptible (GitLab CI)
if [[ "$CI_TYPE" == "gitlab" ]] || [[ "$CI_TYPE" == "mixed" ]]; then
  if contains_pattern "$TMP_COMBINED" "interruptible:"; then
    pass "Interruptible jobs configured (GitLab)"
  else
    warn "No interruptible: true -- redundant GitLab pipelines will not be auto-cancelled"
  fi
fi

# Shallow clone
if contains_pattern "$TMP_COMBINED" "fetch-depth: 0"; then
  warn "Full git history clone detected (fetch-depth: 0) -- use shallow clone unless full history is needed"
elif contains_pattern "$TMP_COMBINED" "fetch-depth: 1" || ! contains_pattern "$TMP_COMBINED" "fetch-depth:"; then
  pass "Shallow clone in use (fetch-depth: 1 is the default for actions/checkout)"
fi

# Timeout limits
if contains_pattern "$TMP_COMBINED" "timeout-minutes:"; then
  pass "Timeout limits configured on jobs/steps"
else
  warn "No timeout-minutes detected -- hung jobs will run until the platform limit (6h for GitHub Actions)"
fi

# Artifact passing
if contains_pattern "$TMP_COMBINED" "upload-artifact|download-artifact|artifacts:"; then
  pass "Artifact passing detected between jobs"
else
  info "No artifact passing detected -- verify build outputs are not being re-built in each job"
fi

echo ""

# ---- Reliability Checks -----------------------------------------------------

echo "--- Reliability ---"
echo ""

# Matrix fail-fast
if contains_pattern "$TMP_COMBINED" "strategy:"; then
  if contains_pattern "$TMP_COMBINED" "fail-fast:"; then
    pass "Matrix fail-fast explicitly configured"
  else
    warn "Matrix detected without explicit fail-fast setting -- defaults to true (cancels all jobs on first failure)"
  fi
fi

# Triggers -- overly broad
if [[ "$CI_TYPE" == "github-actions" ]] || [[ "$CI_TYPE" == "mixed" ]]; then
  if contains_pattern "$TMP_COMBINED" "on:\s*push:\s*$" || contains_pattern "$TMP_COMBINED" "push:\s*$"; then
    warn "Pipeline triggers on all pushes -- consider limiting to main branch and pull_request"
  else
    pass "Pipeline triggers appear scoped (not running on every push to every branch)"
  fi
fi

# Retry on failure
if contains_pattern "$TMP_COMBINED" "retry:" || contains_pattern "$TMP_COMBINED" "continue-on-error:"; then
  pass "Retry or continue-on-error configured for some steps"
else
  info "No retry configuration -- flaky steps will fail the build without retry"
fi

echo ""

# ---- Security Checks --------------------------------------------------------

echo "--- Security ---"
echo ""

# Permissions block (GitHub Actions)
if [[ "$CI_TYPE" == "github-actions" ]] || [[ "$CI_TYPE" == "mixed" ]]; then
  if contains_pattern "$TMP_COMBINED" "^permissions:"; then
    pass "Permissions block present at workflow level"
  else
    fail "No permissions block -- GITHUB_TOKEN has write access to all scopes by default"
  fi
fi

# Action pinning (GitHub Actions)
if [[ "$CI_TYPE" == "github-actions" ]] || [[ "$CI_TYPE" == "mixed" ]]; then
  # Check for SHA pinning (40-char hex after @)
  SHA_PINNED=$(grep -cE "uses: .+@[0-9a-f]{40}" "$TMP_COMBINED" 2>/dev/null || true)
  TAG_PINNED=$(grep -cE "uses: .+@v[0-9]" "$TMP_COMBINED" 2>/dev/null || true)

  if [[ "$TAG_PINNED" -gt 0 ]] && [[ "$SHA_PINNED" -eq 0 ]]; then
    fail "Actions pinned to mutable tags (e.g., @v4) -- pin to full SHA for supply chain security"
  elif [[ "$TAG_PINNED" -gt 0 ]] && [[ "$SHA_PINNED" -gt 0 ]]; then
    warn "Mix of SHA-pinned ($SHA_PINNED) and tag-pinned ($TAG_PINNED) actions -- migrate tag-pinned actions to SHA"
  elif [[ "$SHA_PINNED" -gt 0 ]]; then
    pass "Actions pinned to full SHAs ($SHA_PINNED detected)"
  else
    info "Could not determine action pinning status -- manually verify all uses: directives"
  fi
fi

# pull_request_target risk
if contains_pattern "$TMP_COMBINED" "pull_request_target"; then
  if contains_pattern "$TMP_COMBINED" "event.pull_request.head.sha"; then
    fail "CRITICAL: pull_request_target combined with PR head checkout -- poisoned pipeline attack vector"
  else
    warn "pull_request_target in use -- ensure PR code is not checked out in this workflow"
  fi
fi

# Secret patterns in config (obvious leaks)
if contains_pattern "$TMP_COMBINED" 'echo \$\{?' && contains_pattern "$TMP_COMBINED" "SECRET\|TOKEN\|KEY\|PASSWORD"; then
  fail "Possible secret echo detected -- verify no credentials are being printed to logs"
else
  pass "No obvious secret echo patterns detected in config"
fi

# OIDC usage
if contains_pattern "$TMP_COMBINED" "id-token: write\|oidc\|workload.identity\|role-to-assume"; then
  pass "OIDC detected for cloud authentication (no long-lived credentials)"
else
  info "No OIDC detected -- verify cloud credentials are not stored as long-lived secrets"
fi

echo ""

# ---- Maintainability Checks -------------------------------------------------

echo "--- Maintainability ---"
echo ""

# Reusable workflows
if contains_pattern "$TMP_COMBINED" "workflow_call\|workflow_dispatch"; then
  pass "Reusable workflow or manual dispatch trigger present"
else
  info "No reusable workflows (workflow_call) detected"
fi

# Comments
COMMENT_COUNT=$(grep -c "^\s*#" "$TMP_COMBINED" 2>/dev/null || true)
if [[ "$COMMENT_COUNT" -gt 5 ]]; then
  pass "Pipeline has inline comments ($COMMENT_COUNT comment lines)"
elif [[ "$COMMENT_COUNT" -gt 0 ]]; then
  info "Few inline comments ($COMMENT_COUNT) -- consider documenting non-obvious steps"
else
  warn "No inline comments -- complex steps should be documented"
fi

# Job count
JOB_COUNT=$(grep -c "^\s\{2,4\}[a-z][a-z0-9_-]*:\s*$" "$TMP_COMBINED" 2>/dev/null || true)
if [[ "$JOB_COUNT" -gt 20 ]]; then
  warn "Large number of jobs ($JOB_COUNT) -- consider consolidating into reusable workflows"
elif [[ "$JOB_COUNT" -gt 0 ]]; then
  pass "Reasonable job count ($JOB_COUNT jobs detected)"
fi

echo ""

# ---- Summary ----------------------------------------------------------------

echo "==========================="
echo "Analysis Summary"
echo "==========================="
echo ""
printf "  %s  %d checks passed\n" "$PASS" "$PASS_COUNT"
printf "  %s  %d warnings\n"      "$WARN" "$WARN_COUNT"
printf "  %s  %d failures\n"      "$FAIL" "$FAIL_COUNT"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "Priority: Address FAIL items before the next release."
fi
if [[ "$WARN_COUNT" -gt 0 ]]; then
  echo "Recommended: Address WARN items in the next sprint."
fi
if [[ "$FAIL_COUNT" -eq 0 ]] && [[ "$WARN_COUNT" -eq 0 ]]; then
  echo "Pipeline meets baseline security and performance standards."
fi
