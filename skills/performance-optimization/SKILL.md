---
name: performance-optimization
description: "Use when investigating performance -- slow queries, N+1, algorithmic complexity, memory leaks, caching gaps, bundle size, latency -- or auditing a PR for performance impact."
context: fork
agent: performance-optimization
model: opus
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status), Bash(git branch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Read, Glob, Grep, LS, Task
tags: [review]
---

# Performance Optimization

Conduct a performance-focused analysis of the pending changes.

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

COMMITS:

```
!`gh pr view --json commits --jq '.commits[].messageHeadline' 2>/dev/null || git log --oneline origin/HEAD...`
```

DIFF CONTENT:

```
!`gh pr diff 2>/dev/null || git diff --merge-base origin/HEAD`
```

## Objective

Use the performance-optimization agent to analyze the code above for performance bottlenecks. Produce a prioritized performance report covering database queries, algorithmic complexity, memory management, caching, bundle size, and I/O patterns. Your final reply must contain the markdown report.

## Triggers

| Trigger | Example |
|---------|---------|
| `performance review` | "run a performance review on this PR" |
| `find bottlenecks` | "find bottlenecks in the API layer" |
| `optimize queries` | "optimize the slow queries in user service" |
| `bundle size` | "analyze bundle size impact of this change" |
| `memory leak` | "check for memory leak patterns" |
| `n+1 queries` | "detect N+1 queries in this code" |

## References

- `references/PERFORMANCE_CHECKLIST.md` — Full performance review checklist
- `references/N_PLUS_ONE_PATTERNS.md` — N+1 detection patterns by framework
- `references/CACHING_STRATEGIES.md` — Caching pattern reference
