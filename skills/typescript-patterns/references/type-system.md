# TypeScript Type System

Generics, discriminated unions, branded types, conditional types, and advanced patterns for TypeScript 5.x.

---

## Generics

```typescript
// Generic function
function identity<T>(value: T): T {
  return value;
}

// Generic with constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Generic with default
interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  message: string;
}

// Multiple type parameters
function zip<A, B>(as: A[], bs: B[]): [A, B][] {
  return as.map((a, i) => [a, bs[i]] as [A, B]);
}
```

---

## Discriminated Unions

The primary pattern for modeling state and variant types.

```typescript
// Payment method variants
type PaymentMethod =
  | { type: "card"; lastFour: string; brand: "visa" | "mastercard" }
  | { type: "bank_transfer"; accountNumber: string; routingNumber: string }
  | { type: "crypto"; address: string; currency: string };

function formatPayment(method: PaymentMethod): string {
  switch (method.type) {
    case "card":
      return `${method.brand} ending in ${method.lastFour}`;
    case "bank_transfer":
      return `Bank transfer from ${method.accountNumber}`;
    case "crypto":
      return `${method.currency} wallet ${method.address.slice(0, 8)}...`;
    // TypeScript error if you add a new variant without updating this switch
  }
}
```

---

## Branded Types

Prevent mixing structurally identical primitives.

```typescript
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
type Email = Brand<string, "Email">;

// Constructor functions
const UserId = (id: string): UserId => id as UserId;
const Email = (raw: string): Email => {
  if (!raw.includes("@")) throw new Error(`Invalid email: ${raw}`);
  return raw as Email;
};

// Now mixing is a compile error
function getUser(id: UserId): User { ... }
const oid = OrderId("o123");
getUser(oid); // TypeScript error: Argument of type 'OrderId' is not assignable to parameter of type 'UserId'
```

---

## Conditional Types

Type-level if/else based on type relationships.

```typescript
// Extract array element type
type Unpack<T> = T extends (infer U)[] ? U : T;
type A = Unpack<string[]>; // string
type B = Unpack<number>;   // number

// Extract Promise return type
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

// Distributive conditional types
type NonNullable<T> = T extends null | undefined ? never : T;
type C = NonNullable<string | null | undefined>; // string

// Exclude/Extract
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;

type Status = "pending" | "active" | "deleted";
type ActiveStatus = Exclude<Status, "deleted">; // "pending" | "active"
```

---

## Mapped Types

Transform all properties of a type.

```typescript
// Make all properties optional
type Partial<T> = { [K in keyof T]?: T[K] };

// Make all properties readonly
type Readonly<T> = { readonly [K in keyof T]: T[K] };

// Custom — convert all string values to uppercase brands
type EventMap = {
  click: MouseEvent;
  keydown: KeyboardEvent;
};

// Pick only specific keys
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type ClickOnly = Pick<EventMap, "click">;

// Remap keys
type PrefixedKeys<T, Prefix extends string> = {
  [K in keyof T as `${Prefix}${Capitalize<string & K>}`]: T[K];
};
```

---

## Template Literal Types with Inference

```typescript
type EventName<T extends string> = `on${Capitalize<T>}`;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type ApiRoute = `/${string}`;

// Extract path params
type ExtractParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParams<`/${Rest}`>
    : T extends `${string}:${infer Param}`
    ? Param
    : never;

type Params = ExtractParams<"/users/:userId/orders/:orderId">;
// "userId" | "orderId"
```

---

## Utility Types Cheat Sheet

```typescript
Partial<T>          // All keys optional
Required<T>         // All keys required
Readonly<T>         // All keys readonly
Record<K, V>        // Object with keys K and values V
Pick<T, K>          // Object with subset of keys K from T
Omit<T, K>          // Object without keys K from T
Exclude<T, U>       // Members of T not assignable to U
Extract<T, U>       // Members of T assignable to U
NonNullable<T>      // Remove null and undefined
ReturnType<T>       // Return type of function type T
Parameters<T>       // Parameter tuple type of function T
InstanceType<T>     // Instance type of constructor T
Awaited<T>          // Unwrap Promise types recursively
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `type Foo = object` | Too broad — accepts anything | Define specific shape |
| `Record<string, any>` | Loses value types | `Record<string, User>` or define interface |
| `Function` type | No argument/return type info | Use `(...args: unknown[]) => unknown` or specific signature |
| Excessive `extends` chains | Hard to read, slow to compile | Flatten with intersection types |
| `as const` on mutable data | False sense of immutability (shallow) | Use `DeepReadonly<T>` if deep immutability needed |
