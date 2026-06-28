# TypeScript Async Patterns

Promises, async/await, AbortController, concurrency, and async patterns for TypeScript 5.x.

---

## async/await Basics

```typescript
// Always await in try/catch — not Promise.then().catch()
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const raw: unknown = await res.json();
  return UserSchema.parse(raw);
}
```

**Never** return a Promise from an async function without awaiting it — errors won't be caught:

```typescript
// Bad — error not caught by outer try/catch
async function bad() {
  return fetchUser("u1"); // missing await
}

// Good
async function good() {
  return await fetchUser("u1");
}
```

---

## AbortController for Cancellation

```typescript
async function fetchWithAbort(url: string, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// Usage — cancel after 5 seconds
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const res = await fetchWithAbort("/api/data", controller.signal);
  clearTimeout(timeout);
  return await res.json();
} catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") {
    throw new Error("Request timed out");
  }
  throw err;
}
```

---

## Concurrent Requests

```typescript
// All at once — fail fast if any fails
const [user, orders, settings] = await Promise.all([
  fetchUser(userId),
  fetchOrders(userId),
  fetchSettings(userId),
]);

// All at once — collect results and failures separately
const results = await Promise.allSettled([
  fetchUser(userId),
  fetchOrders(userId),
]);

for (const result of results) {
  if (result.status === "rejected") {
    console.error("failed:", result.reason);
  }
}

// First to succeed
const data = await Promise.any([
  fetchFromRegion("us-east"),
  fetchFromRegion("eu-west"),
]);
```

---

## Retry with Exponential Backoff

```typescript
interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

async function retry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000, signal }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
```

---

## Async Iterators

```typescript
async function* paginate<T>(
  fetch: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  do {
    const page = await fetch(cursor);
    for (const item of page.items) {
      yield item;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
}

// Usage
for await (const user of paginate(fetchUsersPage)) {
  await processUser(user);
}
```

---

## Deferred / Promisified Helpers

```typescript
// Delay
const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

// Race with timeout
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  return Promise.race([
    promise,
    delay(timeoutMs, controller.signal).then(() => {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }),
  ]).finally(() => controller.abort());
}
```

---

## Async Queue / Worker Pool

```typescript
class WorkerPool<T, R> {
  private queue: Array<{ item: T; resolve: (r: R) => void; reject: (e: unknown) => void }> = [];
  private active = 0;

  constructor(
    private readonly worker: (item: T) => Promise<R>,
    private readonly concurrency: number,
  ) {}

  async process(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.active++;
      this.worker(task.item)
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => { this.active--; this.drain(); });
    }
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `async` on sync functions | Unnecessary Promise wrapping | Remove `async` if no `await` |
| Missing `await` inside `try` | Errors escape the catch | Always `await` inside try/catch |
| Unhandled promise rejection | Silent failures | Always `.catch()` on fire-and-forget promises |
| `Promise.all` without error strategy | First failure cancels rest | Use `Promise.allSettled` for partial success |
| Sequential awaits when parallel is safe | Slower than needed | Use `Promise.all` for independent operations |
