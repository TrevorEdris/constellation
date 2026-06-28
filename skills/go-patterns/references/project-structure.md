# Go Project Structure

Module layout, package organization, and naming conventions for Go services and libraries.

---

## Standard Service Layout

```
myservice/
├── cmd/
│   └── myservice/
│       └── main.go          # Thin entrypoint: wire deps, start server
├── internal/                # Private packages — not importable by external modules
│   ├── api/                 # HTTP/gRPC handlers
│   │   ├── handler.go
│   │   └── handler_test.go
│   ├── store/               # Data access layer
│   │   ├── store.go         # Interface definition
│   │   ├── postgres.go      # Postgres implementation
│   │   └── store_test.go
│   ├── domain/              # Business logic, domain types
│   │   └── user.go
│   └── config/              # Config loading (env, file)
│       └── config.go
├── pkg/                     # Exported packages (public library code only)
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

**Key rule:** Keep `main.go` minimal — only wiring and startup. All business logic belongs in `internal/`.

---

## Library Layout

For libraries without a service entry point:

```
mylib/
├── doc.go          # Package documentation only
├── mylib.go        # Primary exported API
├── mylib_test.go   # Unit tests
├── internal/       # Private implementation details
└── go.mod
```

---

## Package Naming

- **All lowercase, no underscores or mixed case** — `httputil`, not `http_util` or `HttpUtil`
- **Singular** — `user`, not `users`; `store`, not `stores`
- **No `util`, `common`, `misc`, `helpers`** — these are grab-bags; name by responsibility
- **No stutter** — if the package is `user`, the type is `User`, not `UserUser` or `user.UserType`

```go
// Good
package store
type Store struct { ... }

// Bad — stutter
package userstore
type UserStore struct { ... }
```

---

## cmd/ Directory

Each binary gets its own subdirectory:

```
cmd/
├── server/main.go    # HTTP API server
├── worker/main.go    # Background job processor
└── migrate/main.go   # DB migration runner
```

`main.go` should be < 50 lines. Wire dependencies here, not in business logic.

```go
func main() {
    cfg, err := config.Load()
    if err != nil {
        log.Fatal("load config:", err)
    }

    db, err := postgres.Connect(cfg.DatabaseURL)
    if err != nil {
        log.Fatal("connect db:", err)
    }
    defer db.Close()

    store := store.New(db)
    api := api.New(store, cfg)

    log.Fatal(api.ListenAndServe(cfg.Addr))
}
```

---

## go.mod

```
module github.com/myorg/myservice

go 1.22

require (
    golang.org/x/sync v0.7.0
    github.com/jackc/pgx/v5 v5.6.0
)
```

- Set the minimum Go version explicitly
- Run `go mod tidy` after adding/removing dependencies
- Commit both `go.mod` and `go.sum`
- Do not vendor unless required by policy (use Go module proxy instead)

---

## Internal Package Rules

`internal/` enforces package privacy at the module boundary. External modules cannot import `internal/` packages.

Use `internal/` for:
- Domain types that should not leak into external APIs
- Implementation details of the service
- Packages you want to refactor without breaking external consumers

---

## Test File Organization

- Unit tests: same package, `_test.go` suffix, `package foo` (white-box)
- Black-box tests: `package foo_test` (tests the public API only)
- Integration tests: build tag `//go:build integration`, same directory or `testdata/`

```go
// White-box test (same package)
package store

func TestPostgresStore_internalMethod(t *testing.T) { ... }

// Black-box test (external test package)
package store_test

func TestPostgresStore_CreateUser(t *testing.T) { ... }
```

---

## Makefile Targets

```makefile
.PHONY: build test lint fmt

build:
    go build ./cmd/...

test:
    go test -race -count=1 ./...

test-integration:
    go test -race -tags integration ./...

lint:
    golangci-lint run ./...

fmt:
    goimports -w .
```
