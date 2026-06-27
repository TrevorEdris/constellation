#!/bin/bash
# Usage: extract-ticket-ids.sh <pr-number> [repo]
# Extracts Jira ticket IDs from PR title, body, and branch name
# Pattern: PROJECT-1234 (e.g., HT-1702, EFI-456)
set -e

PR_NUM="$1"
REPO="${2:-}"

if [ -z "$PR_NUM" ]; then
  echo "Usage: extract-ticket-ids.sh <pr-number> [repo]"
  exit 1
fi

if [ -n "$REPO" ]; then
  PR_JSON=$(gh pr view "$PR_NUM" -R "$REPO" --json title,body,headRefName)
else
  PR_JSON=$(gh pr view "$PR_NUM" --json title,body,headRefName)
fi

# Extract all Jira-style ticket IDs and deduplicate
TICKETS=$(echo "$PR_JSON" | grep -oE '[A-Z]+-[0-9]+' | sort -u)

if [ -z "$TICKETS" ]; then
  echo "No Jira ticket IDs found in PR title, body, or branch name."
  exit 0
fi

echo "Found Jira ticket IDs:"
echo "$TICKETS"
