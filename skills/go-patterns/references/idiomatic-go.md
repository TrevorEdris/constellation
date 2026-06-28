# Idiomatic Go

Core language idioms and design principles for Go 1.21+.

---

## Interface Design

**Accept interfaces, return concrete types.** Functions take the narrowest interface that satisfies their needs; they return the actual type so callers are not boxed in.

```go
// Good — accepts io.Reader, returns *bytes.Buffer (concrete)
func readAll(r io.Reader) (*bytes.Buffer, error) {
    var buf bytes.Buffer
    if _, err := io.Copy(&buf, r); err != nil {
        return nil, fmt.Errorf("reading: %w", err)
    }
    return &buf, nil
}

// Bad — returns interface; forces callers to type-assert or use reflection
func readAll(r io.Reader) (io.Reader, error) { ... }
```

**Define interfaces where they are used, not where types are defined.**

```go
// In package store
type Querier interface {
    QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// The postgres concrete type (in package postgres) does NOT embed this interface.
// store.Querier is defined by the consumer.
```

**Small interfaces.** The most useful interfaces have 1–3 methods.

```go
type Closer interface{ Close() error }
type ReadCloser interface{ Read([]byte) (int, error); Close() error }
```

---

## Zero Values

Design types so the zero value is useful with no initialization required.

```go
// sync.Mutex — zero value is an unlocked mutex, no Init() needed
var mu sync.Mutex
mu.Lock()

// bytes.Buffer — zero value is an empty, ready-to-use buffer
var buf bytes.Buffer
buf.WriteString("hello")

// Custom type — make zero value meaningful
type Cache struct {
    mu    sync.RWMutex
    items map[string]any // lazy-initialized
}

func (c *Cache) Get(key string) (any, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.items[key]
    return v, ok
}

func (c *Cache) Set(key string, val any) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.items == nil {
        c.items = make(map[string]any)
    }
    c.items[key] = val
}
```

---

## Composition Over Inheritance

Go has no inheritance. Embed types and interfaces to compose behavior.

```go
type Logger struct {
    *slog.Logger // embedded — all Logger methods promoted to Writer
    component string
}

func (l *Logger) With(component string) *Logger {
    return &Logger{Logger: l.Logger.With("component", component), component: component}
}
```

---

## Generics (Go 1.18+)

Use generics to eliminate repetition, not to build frameworks.

```go
// Generic map transform
func Map[T, U any](s []T, fn func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = fn(v)
    }
    return result
}

// Type constraint for ordered types
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}

func Min[T Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}
```

Only use generics when the type parameter genuinely varies. Do not generify code that only has one concrete use.

---

## Functional Options Pattern

For constructors with many optional parameters, prefer functional options over config structs.

```go
type Server struct {
    addr    string
    timeout time.Duration
    tls     *tls.Config
}

type Option func(*Server)

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func WithTLS(cfg *tls.Config) Option {
    return func(s *Server) { s.tls = cfg }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, timeout: 30 * time.Second}
    for _, o := range opts {
        o(s)
    }
    return s
}
```

---

## Constants and Iota

```go
type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusClosed
)

func (s Status) String() string {
    switch s {
    case StatusPending: return "pending"
    case StatusActive:  return "active"
    case StatusClosed:  return "closed"
    default:            return fmt.Sprintf("Status(%d)", int(s))
}
```

---

## Named vs Anonymous Structs

Named structs for domain objects; anonymous structs for local grouping.

```go
// Named — domain type with behavior
type User struct {
    ID    string
    Email string
}

// Anonymous — local data grouping in tests or table-driven logic
tests := []struct {
    input string
    want  int
}{
    {"a", 1},
    {"ab", 2},
}
```

---

## Defer

Use defer for cleanup — it runs even on panic. Pair every `Open`/`Lock`/`Begin` with a deferred `Close`/`Unlock`/`Rollback`.

```go
func openFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("open %s: %w", path, err)
    }
    defer f.Close() // guaranteed

    // ... use f
    return nil
}
```

**Caution:** defer inside a loop defers until the function returns, not the iteration. Use a helper function or explicit close in loops.
