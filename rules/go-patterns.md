---
description: Go idioms, error handling, and tooling conventions.
paths:
- '**/**/*.go'
- '**/**/go.mod'
- '**/**/go.sum'
---

## Go Patterns

### Core Principles

- **Accept interfaces, return structs** — callers depend on behavior, not implementation; producers own the concrete type
- **Zero value utility** — design types so the zero value is valid and useful (e.g., `sync.Mutex`, `bytes.Buffer`)
- **Small interfaces** — prefer 1–3 method interfaces; `io.Reader`, `io.Writer` are the model
- **Explicit over magic** — no reflection-based field injection; no framework auto-wiring in business logic
- **Package by responsibility** — `internal/` for private packages; avoid circular imports by layering strictly

### Error Handling

- Always wrap errors with context using `fmt.Errorf("doing X: %w", err)`
- Use `errors.Is` for sentinel comparison, `errors.As` for type extraction — never string matching
- Define custom error types for callers that need to branch on error kind:

```go
type NotFoundError struct{ ID string }
func (e *NotFoundError) Error() string { return fmt.Sprintf("id %s not found", e.ID) }

if err != nil {
    var nfe *NotFoundError
    if errors.As(err, &nfe) { /* handle */ }
}
```

- Return errors, do not panic in library code; panics are reserved for programmer errors

### Tooling

| Tool | Command | Purpose |
|------|---------|---------|
| `gofmt` / `goimports` | `goimports -w .` | Format + organize imports |
| `go vet` | `go vet ./...` | Static analysis (always run) |
| `golangci-lint` | `golangci-lint run` | Aggregated linters |
| `go test` | `go test -race ./...` | Tests with race detector |
| `go build` | `go build ./...` | Compile check |

### Anti-Patterns

- **`interface{}`/`any` without reason** — use generics (Go 1.18+) or typed parameters instead
- **Goroutine leaks** — every goroutine needs an exit path; use `context.Context` for cancellation
- **Named return values as shortcuts** — only use for deferred cleanup clarity; avoid "naked returns"
- **`init()` with side effects** — prefer explicit initialization; `init()` order is fragile
- **Swallowing errors** — `_ = fn()` is almost always wrong; at minimum log the discarded error

### Deep Reference

For comprehensive patterns, code examples, and project structure guidance, use the `/go-patterns` skill.
