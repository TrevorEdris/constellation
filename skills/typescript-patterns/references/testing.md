# TypeScript Testing

Vitest, Jest, type-safe mocks, coverage, and testing patterns for TypeScript 5.x.

---

## Basic Test Structure (Vitest)

```typescript
// src/user-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "./user-service";
import type { UserStore } from "./store";

describe("UserService", () => {
  let store: UserStore;
  let service: UserService;

  beforeEach(() => {
    store = createFakeStore();
    service = new UserService(store);
  });

  describe("getUser", () => {
    it("returns the user when found", async () => {
      const user = await service.getUser("u1");
      expect(user.email).toBe("alice@example.com");
    });

    it("throws NotFoundError when user does not exist", async () => {
      await expect(service.getUser("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });
});
```

---

## Type-Safe Mocks

Use `vi.fn()` or construct fakes that satisfy the interface.

```typescript
import { vi } from "vitest";
import type { UserStore } from "./store";

// vi.fn() with typed implementation
const mockStore: UserStore = {
  get: vi.fn().mockResolvedValue({ id: "u1", email: "alice@example.com" }),
  save: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

// Assert calls
expect(mockStore.save).toHaveBeenCalledOnce();
expect(mockStore.save).toHaveBeenCalledWith(
  expect.objectContaining({ email: "alice@example.com" })
);

// Hand-rolled fake (preferred for complex logic)
class FakeUserStore implements UserStore {
  private users = new Map<string, User>();

  async get(id: string): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new NotFoundError("user", id);
    return user;
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  seed(user: User): this {
    this.users.set(user.id, user);
    return this;
  }
}
```

---

## Testing HTTP (with MSW)

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.get("/api/users/:id", ({ params }) => {
    if (params.id === "u1") {
      return HttpResponse.json({ id: "u1", email: "alice@example.com" });
    }
    return HttpResponse.json({ error: "not found" }, { status: 404 });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it("fetches user from API", async () => {
  const user = await fetchUser("u1");
  expect(user.email).toBe("alice@example.com");
});
```

---

## Testing Async Code

```typescript
// Promise rejection
await expect(service.delete("nonexistent")).rejects.toThrow(NotFoundError);

// Resolved value
await expect(service.getUser("u1")).resolves.toMatchObject({ email: "alice@example.com" });

// Timeout behavior
vi.useFakeTimers();

const promise = service.fetchWithRetry("url", { maxAttempts: 3, baseDelayMs: 1000 });
await vi.runAllTimersAsync(); // advance all pending timers
await expect(promise).rejects.toThrow();

vi.useRealTimers();
```

---

## Parametrized Tests

```typescript
import { it, expect } from "vitest";

it.each([
  ["42", 42],
  ["0", 0],
  ["-1", -1],
])("parses %s as %d", (input, expected) => {
  expect(parseInt(input, 10)).toBe(expected);
});

it.each([
  { input: "", label: "empty string" },
  { input: "abc", label: "non-numeric" },
])("throws on $label", ({ input }) => {
  expect(() => parsePositiveInt(input)).toThrow();
});
```

---

## Coverage Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
      exclude: ["**/*.test.ts", "**/index.ts", "**/types.ts"],
    },
  },
});
```

---

## Type Testing

Verify that types behave correctly at compile time using `expectTypeOf` (Vitest) or `tsd`.

```typescript
import { expectTypeOf } from "vitest";
import { parseId } from "./parse-id";

it("returns Result<number, string>", () => {
  const result = parseId("42");
  expectTypeOf(result).toMatchTypeOf<Result<number, string>>();
});

it("ok branch has number value", () => {
  const result = parseId("42");
  if (result.ok) {
    expectTypeOf(result.value).toBeNumber();
  }
});
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `as unknown as MockType` for mocks | Bypasses type checking | Use `vi.fn()` with typed implementation or hand-rolled fake |
| Testing implementation details | Brittle tests | Test behavior through public interface |
| No `beforeEach` reset | State leaks between tests | Reset mocks/fakes in `beforeEach` |
| `expect.assertions(n)` forgotten in async tests | Tests pass even if assertion never runs | Always use `await expect(...)` not `expect(await ...)` for rejection |
| Mocking entire modules | Overly broad; hides integration issues | Mock only the dependency being isolated |
