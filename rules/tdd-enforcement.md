---
description: Enforce test-driven development — no production code without a failing
  test first.
paths:
- '**/*'
---

## The Iron Law

No production code without a failing test first. This is not a suggestion.

### When This Applies

- New features or endpoints
- Bug fixes (reproduce the bug as a test)
- Behavior changes to existing code
- Refactoring that changes observable behavior

### When This Does NOT Apply

- Configuration files (YAML, JSON, env)
- Documentation and comments
- Generated code (protobuf, OpenAPI output, ORM migrations)
- Throwaway prototypes — but human must explicitly approve the skip

### Quick Reference — RED-GREEN-REFACTOR

1. **RED** — Write a test for the desired behavior. Run it. Confirm it fails.
2. **Verify RED** — Failure message must match the missing behavior, not a syntax error.
3. **GREEN** — Write the minimal production code to make the test pass. Nothing more.
4. **Verify GREEN** — Run the full test suite. All tests pass. No warnings.
5. **REFACTOR** — Clean up code without adding behavior. All tests stay green.
6. **Verify REFACTOR** — Run the full test suite again. All green.

Repeat for each new behavior.

### Violation Recovery

If production code was written before a failing test existed:
- **Delete the production code.** Not "adapt." Not "keep as reference." Delete it.
- Write the test first.
- Implement again from scratch following the cycle above.

Use `/tdd` to invoke the full TDD methodology and guided cycle.
