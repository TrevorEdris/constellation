# Go Error Handling

Comprehensive patterns for error creation, wrapping, inspection, and custom types in Go 1.21+.

---

## Core Rule

Errors are values. Return them; do not panic. Every caller is responsible for handling or propagating the error.

```go
// Always check the error
n, err := w.Write(data)
if err != nil {
    return fmt.Errorf("writing response: %w", err)
}
```

---

## Wrapping with Context

Use `fmt.Errorf` with `%w` to add context while preserving the original error for unwrapping.

```go
func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
    row, err := s.db.QueryRowContext(ctx, "SELECT ...", id)
    if err != nil {
        return nil, fmt.Errorf("store.GetUser id=%s: %w", id, err)
    }
    // ...
}
```

Call stack in error message should read like a breadcrumb trail:
```
store.GetUser id=abc123: sql: no rows in result set
handler.getProfile: store.GetUser id=abc123: sql: no rows in result set
```

Do **not** include "error" or "err" in the context message — the error structure already implies it.

---

## Sentinel Errors

Sentinel errors are package-level values used for identity comparison.

```go
package store

var (
    ErrNotFound   = errors.New("not found")
    ErrConflict   = errors.New("conflict")
    ErrUnauthorized = errors.New("unauthorized")
)
```

Callers check with `errors.Is`, which traverses the wrap chain:

```go
user, err := store.GetUser(ctx, id)
if errors.Is(err, store.ErrNotFound) {
    http.Error(w, "user not found", http.StatusNotFound)
    return
}
if err != nil {
    http.Error(w, "internal error", http.StatusInternalServerError)
    return
}
```

---

## Custom Error Types

When callers need to extract structured data from the error, define a type.

```go
package store

// NotFoundError carries the resource type and ID.
type NotFoundError struct {
    Resource string
    ID       string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %q not found", e.Resource, e.ID)
}

// Usage in store
func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
    // ...
    if !found {
        return nil, &NotFoundError{Resource: "user", ID: id}
    }
}

// Usage in handler
var nfe *store.NotFoundError
if errors.As(err, &nfe) {
    http.Error(w, nfe.Error(), http.StatusNotFound)
    return
}
```

`errors.As` searches the entire wrap chain for a matching type.

---

## Joining Multiple Errors (Go 1.20+)

`errors.Join` creates a multi-error that `errors.Is`/`errors.As` can inspect.

```go
func validateUser(u *User) error {
    var errs []error
    if u.Email == "" {
        errs = append(errs, errors.New("email required"))
    }
    if u.Name == "" {
        errs = append(errs, errors.New("name required"))
    }
    return errors.Join(errs...)
}
```

---

## Error Groups in Concurrent Code

Use `golang.org/x/sync/errgroup` to collect errors from concurrent goroutines.

```go
func fetchAll(ctx context.Context, ids []string) ([]*Item, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]*Item, len(ids))

    for i, id := range ids {
        i, id := i, id // capture
        g.Go(func() error {
            item, err := fetch(ctx, id)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", id, err)
            }
            results[i] = item
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

---

## When to Use `panic`

Panic only for programmer errors — invariants that should never be violated at runtime.

```go
// Acceptable: invalid usage of a constructor
func NewPositive(n int) int {
    if n <= 0 {
        panic(fmt.Sprintf("NewPositive: n must be > 0, got %d", n))
    }
    return n
}
```

Libraries must never let panics escape to the caller. Recover only at the top of a goroutine to convert panics to errors:

```go
func safeGo(fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    return fn()
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `_ = fn()` | Silently discards errors | At minimum log: `if err := fn(); err != nil { log.Error(...) }` |
| String comparison on errors | Breaks when message changes | Use `errors.Is` / `errors.As` |
| Re-wrapping the same error at every level | Double-context clutter | Wrap once, propagate with `%w` |
| Panic for expected failures | Crashes instead of graceful handling | Return `error` |
| `errors.New` inside functions | Creates unique values each call; breaks `errors.Is` | Use package-level sentinels |
