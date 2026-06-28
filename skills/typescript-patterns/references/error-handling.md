# TypeScript Error Handling

Result types, Zod validation, typed errors, and error boundaries for TypeScript 5.x.

---

## Always Throw Error Instances

```typescript
// Bad — string throws lose stack traces and type information
throw "something went wrong";

// Good
throw new Error("something went wrong");

// Better — domain-specific error classes
class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(
    readonly resource: string,
    readonly id: string,
  ) {
    super(`${resource} '${id}' not found`);
    this.name = "NotFoundError";
    // Fix prototype chain for instanceof checks in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(
    readonly field: string,
    readonly message: string,
  ) {
    super(`Validation failed on '${field}': ${message}`);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

---

## Result Type Pattern

For domain operations where failure is expected, use a Result type instead of exceptions.

```typescript
type Ok<T> = { readonly ok: true; readonly value: T };
type Err<E> = { readonly ok: false; readonly error: E };
type Result<T, E = Error> = Ok<T> | Err<E>;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = <E>(error: E): Err<E> => ({ ok: false, error });

// Usage
function parseId(raw: string): Result<number, string> {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return err(`invalid id: ${JSON.stringify(raw)}`);
  }
  return ok(n);
}

const result = parseId("42");
if (!result.ok) {
  console.error(result.error); // string
  return;
}
console.log(result.value); // number
```

---

## Zod for Runtime Validation

Validate external data (API responses, user input, env vars) with Zod. The schema becomes the type source of truth.

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.coerce.date(),
});

type User = z.infer<typeof UserSchema>;

// Validate at the boundary (e.g., API response)
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  const raw: unknown = await res.json();
  return UserSchema.parse(raw); // throws ZodError if invalid
}

// Safe parse (no throw)
const result = UserSchema.safeParse(raw);
if (!result.success) {
  console.error(result.error.flatten());
  return;
}
const user = result.data; // User — fully typed
```

---

## Catching and Typing Errors

TypeScript `catch` clause variables are `unknown` in strict mode.

```typescript
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

try {
  await fetchUser("u1");
} catch (err) {
  // err is `unknown` — must narrow before using
  if (err instanceof NotFoundError) {
    // handle 404
  } else if (isError(err)) {
    console.error(err.message);
  } else {
    console.error("unexpected throw:", err);
  }
}
```

---

## Error Discriminators

Use a shared discriminant field to identify error variants without instanceof.

```typescript
type AppError =
  | { code: "NOT_FOUND"; resource: string; id: string }
  | { code: "UNAUTHORIZED"; userId: string }
  | { code: "RATE_LIMITED"; retryAfter: number }
  | { code: "INTERNAL"; message: string };

function handleError(error: AppError): Response {
  switch (error.code) {
    case "NOT_FOUND":
      return Response.json({ error: `${error.resource} not found` }, { status: 404 });
    case "UNAUTHORIZED":
      return Response.json({ error: "unauthorized" }, { status: 401 });
    case "RATE_LIMITED":
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": String(error.retryAfter) },
      });
    case "INTERNAL":
      return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
```

---

## Async Error Handling

```typescript
// Always await before catching
async function loadUser(id: string): Promise<User | null> {
  try {
    return await fetchUser(id);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err; // re-throw unexpected errors
  }
}

// Promise.allSettled for partial failures
async function loadMany(ids: string[]): Promise<Array<User | null>> {
  const results = await Promise.allSettled(ids.map(fetchUser));
  return results.map((r) =>
    r.status === "fulfilled" ? r.value : null
  );
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `throw "string"` | Loses type info and stack trace | `throw new Error("string")` |
| `catch (e: any)` | Bypasses `unknown` safety | Leave as `unknown`, narrow explicitly |
| Silent catch blocks | Hidden bugs | At minimum log; re-throw if unexpected |
| `as T` on API responses | Crashes at runtime if shape changes | Use Zod `.parse()` |
| Not calling `Object.setPrototypeOf` in Error subclass | `instanceof` fails after transpilation | Add `Object.setPrototypeOf(this, new.target.prototype)` |
