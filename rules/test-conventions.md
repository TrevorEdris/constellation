---
description: Enforce E2E and integration test conventions when writing or editing
  test files.
paths:
- '**/**/*.{test'
- '**/spec}.{ts'
- '**/tsx'
- '**/js'
- '**/jsx}'
- '**/**/e2e/**'
- '**/**/integration/**'
- '**/**/__tests__/**'
---

## Test Conventions

### Structure: AAA Pattern

Every test must follow Arrange-Act-Assert. DO NOT add explicit section comments:

```typescript
test('should display error when form is submitted empty', async ({ page }) => {
  await page.goto('/contact');

  await page.getByTestId('submit-button').click();

  await expect(page.getByTestId('validation-error')).toBeVisible();
});
```

### Naming

- Test titles: `should [expected behavior] when [condition]`
- E2E files: `{feature}.e2e.test.ts` — placed in `tests/e2e/`
- Integration files: `{feature}.integration.test.ts` — placed in `tests/integration/`
- Page Objects: `{PageName}Page.ts` — placed in `tests/page-objects/`
- Factories: `{entity}.factory.ts` — placed in `tests/factories/`

### Selectors

- Prefer `data-testid` attributes: `page.getByTestId('submit-button')`
- Prefer ARIA roles: `page.getByRole('button', { name: 'Submit' })`
- Never use CSS class selectors as test anchors (classes change with styling)
- Never use XPath

### Waits

- Never use `page.waitForTimeout()`, `sleep()`, or `setTimeout()`
- Rely on Playwright auto-wait for element interactions
- Use `page.waitForURL()`, `page.waitForResponse()`, or `expect(locator).toBeVisible()` for explicit conditions

### Isolation

- Each test must be independent and pass when run in isolation
- No shared mutable state between tests (no module-level variables mutated during test execution)
- Clean up all created records in `afterEach` — never rely on global teardown for per-test data
- Browser cookies and storage are cleared between tests; never assume prior test's session

### Assertions

- Use Playwright's built-in locator assertions: `expect(locator).toBeVisible()` not `expect(await locator.isVisible()).toBe(true)`
- Assert observable behavior (what the user sees), not internal state
- Do not assert on data your test mocked — that tests the mock, not the application

### Test Budget

- Max 2 E2E tests per feature (high-ROI user journeys only)
- Max 3 integration tests per feature
- Prefer unit tests for logic validation; E2E for user-facing behavior

### Test Data

- Use factory functions for test entities: `createUser({ role: 'admin' })`
- Use fixture files for static reference data
- Never hardcode production email addresses, real credentials, or live API keys
- Never hardcode sequential IDs that may conflict between test runs

### Skeleton Comments (Required)

Every test must include these comments above the `test()` call:

```typescript
// AC: <acceptance criterion text>
// Behavior: <Trigger> -> <Process> -> <Observable Result>
// @category: e2e | integration
// @complexity: low | medium | high
// ROI: <1-10>
```
