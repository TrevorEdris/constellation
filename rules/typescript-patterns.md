---
description: TypeScript idioms, type system, and tooling conventions.
paths:
- '**/**/*.ts'
- '**/**/*.tsx'
- '**/**/tsconfig*.json'
---

## TypeScript Patterns

### Core Principles

- **Strict mode always** — `"strict": true` in tsconfig; never disable for convenience
- **No `any`** — use `unknown` for truly unknown values; narrow before use; `any` disables all checks
- **Discriminated unions over class hierarchies** — model state with tagged unions for exhaustive handling
- **`const` assertions and `satisfies`** — lock down literal types at definition; validate shape without widening
- **Prefer type narrowing** — use `typeof`, `in`, `instanceof`, and custom type guards over casting

### Error Handling

- Do not `throw` strings or plain objects — always `throw new Error("message")` or a subclass
- Use `Result<T, E>` pattern for expected failures in domain logic (avoid exception-driven control flow):

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function parseId(raw: string): Result<number, string> {
  const n = Number(raw);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `invalid id: ${raw}` };
}
```

- Validate external data with Zod at system boundaries; do not trust `as T` casts on API responses

### Tooling

| Tool | Command | Purpose |
|------|---------|---------|
| `tsc` | `tsc --noEmit` | Type-check without emitting |
| `eslint` | `eslint . --max-warnings 0` | Lint |
| `prettier` | `prettier --check .` | Format |
| `vitest` / `jest` | `vitest run` | Test runner |

### Anti-Patterns

- **`as unknown as T`** — double-cast is a sign of a type design problem; fix the types instead
- **`// @ts-ignore`** — use `// @ts-expect-error` with a comment; error disappears when fixed
- **Optional chaining to silence errors** — `a?.b?.c` can hide bugs; assert non-null when you own the invariant
- **`enum`** — prefer `const` object + `typeof` or union of string literals; enums have surprising JS output
- **Untyped event handlers** — always type event parameters; `(e: React.ChangeEvent<HTMLInputElement>)` not `(e: any)`

### Deep Reference

For comprehensive patterns, code examples, and project structure guidance, use the `/typescript-patterns` skill.
