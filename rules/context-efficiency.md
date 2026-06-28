---
description: Prefer phase-scoped context when a skill has a context-manifest.
paths:
- '**/*'
---

## Context Efficiency

When working with skills that have a `context-manifest` in their SKILL.md frontmatter:

1. During Discover phase: prefer discover-scoped references
2. During Plan phase: prefer plan-scoped references
3. During Implement phase: prefer implement-scoped references
4. Only load `always` references + phase-specific references
5. Do not load references for other phases unless explicitly needed

This reduces token usage and keeps context focused on the current task.
