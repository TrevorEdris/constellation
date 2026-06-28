# Go Concurrency

Goroutines, channels, context cancellation, and safe concurrent patterns for Go 1.21+.

---

## Goroutines

A goroutine is cheap (~2KB stack) but not free. Every goroutine needs a defined exit condition.

```go
// Always pair goroutine launch with a termination mechanism
func startWorker(ctx context.Context, jobs <-chan Job) {
    go func() {
        for {
            select {
            case job, ok := <-jobs:
                if !ok {
                    return // channel closed
                }
                process(job)
            case <-ctx.Done():
                return // context cancelled
            }
        }
    }()
}
```

**Goroutine leak checklist:**
- Every goroutine that blocks on a channel must have a `ctx.Done()` case
- Close channels from the sender side only
- Use `golangci-lint` with `gocritic` or `staticcheck` to detect leaks

---

## Channels

```go
// Unbuffered — synchronous handoff (sender blocks until receiver is ready)
ch := make(chan int)

// Buffered — sender blocks only when buffer is full
ch := make(chan int, 100)

// Directional types in function signatures
func producer(out chan<- int) { out <- 42 }
func consumer(in <-chan int) { v := <-in; _ = v }
```

**Pattern: fan-out / fan-in**

```go
func fanOut(ctx context.Context, in <-chan Task, workers int) <-chan Result {
    out := make(chan Result, workers)
    var wg sync.WaitGroup

    for range workers {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for task := range in {
                select {
                case out <- process(ctx, task):
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() { wg.Wait(); close(out) }()
    return out
}
```

---

## Context

`context.Context` is the standard mechanism for cancellation, deadlines, and request-scoped values.

```go
// Creating contexts
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel() // always defer cancel to free resources

ctx, cancel = context.WithDeadline(ctx, time.Now().Add(30*time.Second))
defer cancel()

ctx, cancel = context.WithCancel(ctx)
defer cancel()
```

**Rules:**
- Pass `ctx` as the first argument to every function that does I/O
- Never store `ctx` in a struct field — pass it per-call
- Check `ctx.Err()` or `ctx.Done()` in long-running loops

```go
func processItems(ctx context.Context, items []Item) error {
    for _, item := range items {
        if err := ctx.Err(); err != nil {
            return fmt.Errorf("context cancelled before processing %s: %w", item.ID, err)
        }
        if err := process(ctx, item); err != nil {
            return fmt.Errorf("processing %s: %w", item.ID, err)
        }
    }
    return nil
}
```

**Context values:** Use only for request-scoped metadata (trace ID, auth token). Never for passing functional dependencies.

```go
type ctxKey string
const requestIDKey ctxKey = "requestID"

func WithRequestID(ctx context.Context, id string) context.Context {
    return context.WithValue(ctx, requestIDKey, id)
}

func RequestID(ctx context.Context) string {
    id, _ := ctx.Value(requestIDKey).(string)
    return id
}
```

---

## errgroup

`golang.org/x/sync/errgroup` runs goroutines and collects the first non-nil error.

```go
import "golang.org/x/sync/errgroup"

func runAll(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx) // ctx cancelled on first error

    g.Go(func() error { return serviceA.Run(ctx) })
    g.Go(func() error { return serviceB.Run(ctx) })
    g.Go(func() error { return serviceC.Run(ctx) })

    return g.Wait()
}
```

**Bounded concurrency with errgroup:**

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(10) // max 10 goroutines at once (Go 1.20+)

for _, id := range ids {
    id := id
    g.Go(func() error {
        return process(ctx, id)
    })
}
return g.Wait()
```

---

## sync.Mutex and sync.RWMutex

```go
type SafeMap struct {
    mu sync.RWMutex
    m  map[string]string
}

func (s *SafeMap) Get(key string) (string, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    v, ok := s.m[key]
    return v, ok
}

func (s *SafeMap) Set(key, val string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.m == nil {
        s.m = make(map[string]string)
    }
    s.m[key] = val
}
```

**Lock rules:**
- Lock for the minimum duration; no I/O or slow ops while holding a lock
- Never copy a `sync.Mutex` after first use (use pointer receivers)

---

## sync.Once

```go
type DB struct {
    once sync.Once
    conn *sql.DB
}

func (db *DB) Conn() *sql.DB {
    db.once.Do(func() {
        db.conn, _ = sql.Open("postgres", dsn)
    })
    return db.conn
}
```

---

## Race Detection

Run tests with `-race` to catch data races:

```
go test -race ./...
```

For CI, always run with race detection. The overhead is ~5–10x but catches real bugs.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Goroutine with no exit path | Memory leak | Add `ctx.Done()` case or close channel |
| Sending on closed channel | Panic | Only close from sender; use `sync.Once` for safe close |
| Copying a mutex | Deadlock/undefined behavior | Always use pointer receiver for types with mutex |
| Sharing a map across goroutines without lock | Data race | Use `sync.Map` or `sync.RWMutex` |
| `time.Sleep` instead of channel/timer | Flaky tests, busy-wait | Use `time.After`, `time.Ticker`, or condition variables |
