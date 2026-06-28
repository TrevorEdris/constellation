# Idiomatic TypeScript

Core idioms, strict mode, and best practices for TypeScript 5.x.

---

## Strict Mode

Always enable `"strict": true` in tsconfig. This activates:
- `strictNullChecks` — `null`/`undefined` are not assignable to other types
- `noImplicitAny` — variables must have explicit types or inferrable types
- `strictFunctionTypes` — stricter function type checking
- `exactOptionalPropertyTypes` — `{ a?: string }` means `a` is `string | undefined`, not `string | undefined | absent`

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

---

## Type Narrowing

Use narrowing instead of type assertions. The compiler tracks narrowed types through control flow.

```typescript
function processInput(input: string | number | null): string {
  if (input === null) {
    return "empty";
  }
  if (typeof input === "number") {
    return input.toFixed(2);
  }
  return input.toUpperCase(); // TypeScript knows: string here
}

// `in` narrowing for object shapes
function handleEvent(event: MouseEvent | KeyboardEvent): void {
  if ("key" in event) {
    console.log(event.key); // KeyboardEvent
  } else {
    console.log(event.button); // MouseEvent
  }
}
```

---

## `const` Assertions

Lock down literal types at definition site.

```typescript
// Without const assertion — widened to string[]
const directions = ["north", "south", "east", "west"];
// type: string[]

// With const assertion — narrowed to readonly tuple of literals
const directions = ["north", "south", "east", "west"] as const;
// type: readonly ["north", "south", "east", "west"]

type Direction = (typeof directions)[number];
// type: "north" | "south" | "east" | "west"
```

---

## `satisfies` Operator

Validates a value satisfies a type while preserving the most specific type.

```typescript
const config = {
  host: "localhost",
  port: 8080,
  tls: false,
} satisfies { host: string; port: number; tls: boolean };

// config.port is inferred as 8080 (literal), not number
// Without satisfies: config.port would be number after annotation

type Config = { host: string; port: number; tls: boolean };
const config2: Config = { host: "localhost", port: 8080, tls: false };
// config2.port is now number — literal information lost
```

---

## Non-Null Assertion vs. Optional Chaining

```typescript
// Non-null assertion (!) — use only when you own the invariant
// and the compiler cannot prove it
const element = document.getElementById("root")!;

// Optional chaining — when the value may legitimately be absent
const name = user?.profile?.displayName ?? "Anonymous";

// Use assertion functions to narrow types with runtime checks
function assertDefined<T>(val: T | null | undefined, msg: string): asserts val is T {
  if (val == null) throw new Error(msg);
}

assertDefined(element, "root element missing");
element.appendChild(child); // TypeScript knows element is non-null
```

---

## Object Spreading and Immutability

```typescript
// Spread creates shallow copies — safe for immutable update patterns
const updated = { ...user, email: newEmail };

// Readonly for immutable data
type ReadonlyUser = Readonly<User>;

// Deep readonly with utility type
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

---

## Template Literal Types

```typescript
type EventName = `on${Capitalize<string>}`;
type CSSUnit = `${number}${"px" | "em" | "rem" | "%"}`;

type Endpoint = `/api/${string}`;
const path: Endpoint = "/api/users"; // valid
const bad: Endpoint = "/users"; // type error
```

---

## Discriminated Union State Machines

Model application state with discriminated unions for exhaustive handling.

```typescript
type RequestState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

function renderUser(state: RequestState<User>): string {
  switch (state.status) {
    case "idle":    return "Not started";
    case "loading": return "Loading...";
    case "success": return state.data.name; // data is User here
    case "error":   return `Error: ${state.error.message}`;
    default:
      // Exhaustive check — compile error if a case is missing
      const _: never = state;
      return _;
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `any` type | Disables all type checking | Use `unknown`, proper union, or generics |
| `as X` without validation | Unsafe cast; hides bugs | Validate with Zod, then infer type |
| `// @ts-ignore` | Suppresses all errors on that line | Use `// @ts-expect-error` + comment |
| `!` on user input | Crashes on null | Validate, assert, or use optional chaining |
| `enum` | Unexpected JS output, not erased | Use `const` objects or union string literals |
