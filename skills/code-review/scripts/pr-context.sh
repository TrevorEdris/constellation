#!/bin/bash
# Usage: pr-context.sh <pr-number> [repo]
# Fetches: title, description, author, files changed, diff stats, linked issues
set -e

PR_NUM="$1"
REPO="${2:-}"

if [ -z "$PR_NUM" ]; then
  echo "Usage: pr-context.sh <pr-number> [repo]"
  echo "Example: pr-context.sh 123"
  echo "Example: pr-context.sh 123 backend"
  exit 1
fi

echo "=== PR Metadata ==="
if [ -n "$REPO" ]; then
  gh pr view "$PR_NUM" -R "$REPO" --json title,body,author,files,additions,deletions,headRefName,url,state,reviewDecision
else
  gh pr view "$PR_NUM" --json title,body,author,files,additions,deletions,headRefName,url,state,reviewDecision
fi

echo ""
echo "=== Diff Stats ==="
if [ -n "$REPO" ]; then
  gh pr diff "$PR_NUM" -R "$REPO" --stat
else
  gh pr diff "$PR_NUM" --stat
fi
