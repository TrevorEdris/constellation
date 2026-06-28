---
description: Guardrails for cross-repository changes — only touch explicitly named
  repos.
paths:
- '**/*'
---

## Multi-Repo Safety Rules

- Only operate on repos explicitly named in PLAN.md or the current task
- Never modify repos "opportunistically"
- Cross-repo changes: keep commits aligned, verify each repo independently
- If repos not specified, ask before planning/editing

Never commit `.env` files, credentials, or secrets.
