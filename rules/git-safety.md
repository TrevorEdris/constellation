---
description: Enforce safe git practices — no direct pushes to main, no credential
  commits.
paths:
- '**/*'
---

## Git Safety

- Never push directly to `main` or `master` without explicit approval
- Always check the current branch before making changes
- Don't commit `.env` files, credentials, or secrets
- Prefer specific file staging over `git add -A`
- Create atomic commits with clear messages

### Branch Check Protocol

Before making any code changes:
1. Check the current branch with `git branch --show-current`
2. If on `main` or `master`: **STOP** and ask for explicit consent
3. Suggest creating a feature branch if appropriate

Never force push to main without explicit approval.
