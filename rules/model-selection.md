---
description: Guide model selection based on task complexity. Advisory — not blocking.
paths:
- '**/*'
---

## Model Selection Guidance

Match task complexity to model capability. Use the minimum model that can handle the task reliably.

### Task → Model Matrix

| Task Type | Examples | Recommended Model |
|-----------|----------|-------------------|
| **Mechanical** | Rename symbol, reformat code, update version string, fix typo, add import | `haiku` |
| **Standard** | Implement a feature, fix a bug, write tests, update docs, small refactor | `sonnet` |
| **Architecture** | System design, complex refactor spanning many files, security audit, performance investigation | `opus` |

### Decision Rules

**Use haiku when:**
- The change is deterministic and the output is fully predictable from the inputs
- No judgment calls are needed
- Failure cost is low and easy to spot

**Use sonnet when:**
- The task requires understanding context but the approach is known
- One or two judgment calls are needed
- This covers most day-to-day engineering tasks

**Use opus when:**
- The task requires reasoning about trade-offs across multiple competing constraints
- Deep context from many files must be synthesized
- The cost of a wrong architectural decision is high

### Roster Integration

If a roster is active (`persona.yaml` or role file), its `preferred-model` field overrides these defaults for the session.

### When in Doubt

Default to `sonnet`. It handles the majority of tasks well. Escalate to `opus` only when sonnet visibly struggles (misses edge cases, loses context, produces inconsistent output on the same task).

---
*Advisory only — this rule does not enforce model selection, it provides guidance.*
