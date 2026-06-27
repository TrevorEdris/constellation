# TDD Verification Checklist

Fill in this checklist before marking any implementation task complete.

**Task:** <!-- Describe the feature or bug fix -->
**Date:**
**Test command used:**

---

## Test-First Compliance

- [ ] All new production code was preceded by a failing test
- [ ] No production code was written without an existing failing test for it
- [ ] No production code was deleted and rewritten without first writing a test

## RED Phase Verification

- [ ] Each test was run and observed to fail before implementing
- [ ] Each test failure was for the expected reason (missing behavior, not syntax error or import error)
- [ ] No test passed immediately without implementation (if it did, the test was revised)

## GREEN Phase Verification

- [ ] Each test was run and observed to pass after minimal implementation
- [ ] The implementation was minimal — no code added beyond what the test required
- [ ] No behavior was added during GREEN that was not required by the current test

## Full Suite

- [ ] The full test suite passes — not just the new tests
- [ ] No previously passing tests were broken
- [ ] No warnings or errors appear in the test output

## REFACTOR Phase Verification

- [ ] Any refactoring was done only after GREEN was confirmed
- [ ] No new behavior was added during refactoring
- [ ] The full test suite passes after refactoring

## Test Quality

- [ ] Tests use real production code paths (mocks limited to external I/O)
- [ ] Each test asserts on observable behavior, not implementation details
- [ ] One behavior per test — no god tests
- [ ] Test names clearly describe the behavior under test
- [ ] Break-the-code check passed: deliberately breaking the production code made a test fail (then reverted) — proves tests drive the real path, not fakes/mocks/injected state

## Coverage

- [ ] Every new public function or method has at least one test
- [ ] Edge cases are covered: empty inputs, boundary values, null/nil/undefined
- [ ] Error paths are covered: invalid inputs, failed dependencies, unexpected states
- [ ] If coverage tooling is available: coverage delta recorded below

**Coverage before:** ____%
**Coverage after:** ____%

---

## Sign-off

All items checked. Implementation follows TDD. Ready for code review.
