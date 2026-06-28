---
description: When a roster.yaml exists, constrain available skills to those listed
  in the active role.
paths:
- '**/*'
---

## Roster Enforcement

If a `roster.yaml` config exists in the tool's config directory:

1. Read the `role` field to identify the active role
2. Read the corresponding role definition from the roster
3. Prefer skills listed in `allowed-skills` for the active role
4. Avoid skills listed in `denied-skills` unless explicitly requested by the user
5. If `preferred-model` is set, use that model tier unless overridden

This is advisory enforcement — the user can always override by explicit request.
The roster guides default behavior, it does not hard-block.
