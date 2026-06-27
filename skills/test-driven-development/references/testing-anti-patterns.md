# Testing Anti-Patterns

**Load when:** Writing tests, reviewing test coverage, working with mocks, or debugging why tests pass but code is broken.

---

## Iron Laws of Testing

These are non-negotiable. Violating them produces tests that provide false confidence.

1. **Never test mock behavior.** If a test only verifies that a mock was called with certain arguments, it is testing nothing about production code.
2. **Never add test-only methods to production code.** If you need to expose internal state to test it, the design is wrong. Refactor so behavior is testable through the public interface.
3. **Never mock without understanding the real implementation.** A mock that does not reflect actual behavior will let bugs through. Read the real code first.
4. **Never assert on implementation details.** Tests should assert on observable behavior (return values, side effects, state changes), not on how the code achieves it.
5. **Never write tests after the fact and call it TDD.** Tests written after implementation verify what the code does, not what it should do. They encode bugs as expected behavior.

---

## Anti-Pattern 1: The Mock Forest

**The Violation:**
```python
def test_process_order(mock_db, mock_email, mock_inventory, mock_payment, mock_logger):
    mock_db.get_user.return_value = User(id=1)
    mock_inventory.check.return_value = True
    mock_payment.charge.return_value = {"status": "ok"}
    mock_email.send.return_value = None

    result = process_order(order_id=42)

    mock_payment.charge.assert_called_once_with(amount=99.99)
    mock_email.send.assert_called_once()
```

**Why it's wrong:** This test exercises no production logic. It verifies that the mock was called — which is only true if the code calls the mock. If the code calls the mock incorrectly, the mock still returns the configured value. Real bugs pass through.

**The Fix:** Test through the real dependency graph. If the payment service makes network calls, mock only the HTTP client at the lowest level — not the service itself. Test that a payment of $99.99 with a valid card produces a success record in the database.

**Gate Function:** Before mocking a dependency, ask: "Does removing this mock and using the real implementation require network I/O or filesystem access?" If no, do not mock it.

---

## Anti-Pattern 2: The Tautology Test

**The Violation:**
```typescript
it('should return what getUserById returns', async () => {
  const user = await userService.getUserById(1);
  expect(user).toEqual(user);  // Always true
});

// Or the slightly less obvious version:
it('should call repository.findById', async () => {
  mockRepo.findById.mockResolvedValue({ id: 1, name: 'Test' });
  const result = await userService.getUserById(1);
  expect(mockRepo.findById).toHaveBeenCalledWith(1);
  // Never checks what result contains
});
```

**Why it's wrong:** The first always passes. The second only verifies the plumbing exists, not that the plumbing produces correct output. Neither test can catch a bug in the logic that transforms the repository result before returning it.

**The Fix:** Assert on the specific observable outcome. What should `getUserById(1)` return? Assert that exact shape, value, or behavior.

**Gate Function:** Before writing an assertion, ask: "Would this assertion still pass if I introduced an obvious bug in the implementation?" If yes, the assertion is insufficient.

---

## Anti-Pattern 3: The Test That Tests the Test Framework

**The Violation:**
```go
func TestUserCreation(t *testing.T) {
    user := User{Name: "Alice", Email: "alice@example.com"}
    if user.Name != "Alice" {
        t.Error("expected Alice")
    }
}
```

**Why it's wrong:** This test verifies struct literal assignment works — a property of Go itself, not of any production code. The `User` struct was never persisted, validated, or transformed.

**The Fix:** Tests must exercise production code. Call the function that creates users, and assert on the behavior that function is supposed to guarantee (validation, persistence, event emission).

**Gate Function:** Before writing a test, ask: "Does this test call any production code?" If the answer is no, delete it.

---

## Anti-Pattern 4: The Brittle Test

**The Violation:**
```typescript
it('should format user display name', () => {
  const user = { firstName: 'Jane', lastName: 'Doe', title: 'Dr.', suffix: 'PhD' };
  expect(formatDisplayName(user)).toBe('Dr. Jane Marie Doe, PhD');
  // Fails because the test fixture doesn't have 'middleName'
});
```

**Why it's wrong:** The test is tightly coupled to internal formatting logic and a specific fixture shape. Any change to the format (business requirement) or the fixture breaks the test, even if the behavior is still correct.

**The Fix:** Test the behavior contract, not the implementation. What must always be true? "The display name must include the last name." Test that invariant. For formatting, consider snapshot tests that explicitly opt into brittleness.

**Gate Function:** Before writing a fixture, ask: "Am I including fields that the behavior under test actually requires, or am I copying a full object shape out of habit?" Include only what is necessary.

---

## Anti-Pattern 5: The God Test

**The Violation:**
```python
def test_complete_checkout_flow():
    # Sets up cart
    # Applies coupon
    # Validates inventory
    # Processes payment
    # Sends confirmation email
    # Updates loyalty points
    # Verifies order history
    # Checks audit log
    # ... 80 more lines
```

**Why it's wrong:** When this test fails, you do not know which behavior broke. It couples unrelated behaviors, making failures ambiguous and maintenance expensive. Any change to any part of the flow requires updating this test.

**The Fix:** One test per behavior. Each test is small enough to read in 10 seconds and fail for exactly one reason. Integration tests that span multiple behaviors are appropriate at higher levels of the test pyramid, but they must be clearly separated from unit tests and must not replace them.

**Gate Function:** Before writing a new assertion in an existing test, ask: "Is this assertion testing the same behavior, or a different one?" If different, create a new test.

---

## Anti-Pattern 6: The Pesticide Paradox

**The Violation:** Running the same test suite continuously without expanding it. Tests that never fail stop finding bugs.

**Why it's wrong:** Tests become documentation of past bugs, not detectors of future ones. New code paths added without tests are invisible to the test suite.

**The Fix:** Every new behavior requires a new test. Every bug fix requires a new reproduction test. Coverage is not the metric — behavior coverage is. Ask: "What behaviors does the system have that no test currently exercises?"

**Gate Function:** After any implementation task, list every distinct behavior the code can exhibit. Verify each has at least one test. Add tests for any that don't.

---

## Anti-Pattern 7: The False Green

**The Violation:** The test passes, but it never exercises the production code path it claims to cover. It asserts on injected state, a fake/stub return value, or a mock — so it stays green even when the real code is broken or absent.

```python
def test_discount_applied(monkeypatch):
    # Injects the result the code is supposed to compute
    monkeypatch.setattr(cart, "total", 90.0)
    assert cart.total == 90.0  # Green forever — apply_discount() never ran
```

**Why it's wrong:** Green here means "the test harness works," not "the feature works." This is the dominant way TDD produces false confidence: the cycle looks correct (RED then GREEN) but RED failed for the wrong reason and GREEN passed against a fake.

**The Fix:** Every test must drive the real code path. Mock only external I/O at the lowest level. Then prove the test is load-bearing with a break-the-code sanity check.

### Break-the-Code Sanity Check (mutation test)

A test you have never seen fail against the *real* implementation has not been verified. After GREEN, prove the test is wired to the real path:

1. Introduce one deliberate defect in the production code under test — invert a condition, return a wrong constant, delete a line.
2. Re-run the test. It MUST fail.
3. Revert the defect. Re-run. It MUST pass again.

If the test stays green while the production code is broken, the test is testing a fake, a mock, or injected state — not the code. Fix the test before claiming the behavior is covered.

```
BEFORE marking a behavior covered:
  Break the production code the test claims to exercise.
  Re-run the test.

  IF the test still passes:
    STOP — the test does not drive the real code path.
    Remove the fake/injected state. Drive the real function. Re-verify.
```

## Quick Reference

| Anti-Pattern | Signal | Fix |
|---|---|---|
| Mock Forest | 3+ mocks, no behavior assertions | Mock only external I/O |
| Tautology Test | Test passes with any implementation | Assert on specific outcomes |
| Tests the Framework | No production code called | Call real production functions |
| Brittle Test | Breaks on unrelated changes | Test behavioral invariants |
| God Test | Test covers multiple behaviors | One test per behavior |
| Pesticide Paradox | New code, no new tests | Test every new behavior |
| False Green | Passes against fake/mock/injected state | Drive real path; break-the-code check |

---

## Red Flags

Stop and reassess if any of these are true:

- A test file has more mock setup lines than assertion lines.
- Removing a production function does not cause any test to fail.
- Tests pass faster after a new implementation than before.
- Adding a new behavior to production code requires no new test.
- A test was written "just to get coverage."
- You cannot describe what specific behavior would cause a test to fail.
