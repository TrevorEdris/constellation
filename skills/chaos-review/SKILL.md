---
name: chaos-review
description: "Use when you want brutal, worst-case review of code resilience -- failure modes, race conditions, blast radius, and edge cases optimistic reviewers miss."
context: fork
agent: chaos-engineer
model: opus
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status), Bash(git branch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Grep, Glob, LS, Read, WebFetch
tags: [review, security]
---

# Chaos Review

Adversarial review of pending changes. Assumes the worst about every line.

## Context

GIT STATUS:

```
!`git status`
```

PR METADATA:

```
!`gh pr view --json title,body,author,files,additions,deletions,headRefName,state 2>/dev/null || echo "No PR context - reviewing local branch"`
```

FILES MODIFIED:

```
!`gh pr diff --name-only 2>/dev/null || git diff --name-only origin/HEAD...`
```

DIFF CONTENT:

```
!`gh pr diff 2>/dev/null || git diff --merge-base origin/HEAD`
```

## Objective

Use the chaos-engineer agent to conduct an adversarial review of the diff above.
For every finding, describe the specific failure scenario and blast radius.
Your final reply must contain the markdown report.

## References

- `references/attack-patterns.md` — Common failure patterns and attack categories
