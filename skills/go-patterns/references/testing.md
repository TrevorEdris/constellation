# Go Testing

Table-driven tests, subtests, testify, mocks, and test organization for Go 1.21+.

---

## Table-Driven Tests

The standard Go testing pattern. All cases in one test function, clearly named.

```go
func TestParseAmount(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name    string
        input   string
        want    int64
        wantErr bool
    }{
        {name: "valid integer", input: "42", want: 42},
        {name: "valid with decimal", input: "42.50", want: 4250},
        {name: "empty string", input: "", wantErr: true},
        {name: "non-numeric", input: "abc", wantErr: true},
        {name: "negative", input: "-10", wantErr: true},
    }

    for _, tc := range tests {
        tc := tc // capture (pre-Go 1.22)
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            got, err := ParseAmount(tc.input)
            if tc.wantErr {
                if err == nil {
                    t.Fatalf("expected error, got nil")
                }
                return
            }
            if err != nil {
                t.Fatalf("unexpected error: %v", err)
            }
            if got != tc.want {
                t.Errorf("got %d, want %d", got, tc.want)
            }
        })
    }
}
```

---

## Testify

`github.com/stretchr/testify/assert` and `require` reduce boilerplate.

```go
import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestCreateUser(t *testing.T) {
    user, err := store.CreateUser(ctx, CreateUserParams{
        Email: "alice@example.com",
        Name:  "Alice",
    })
    require.NoError(t, err)         // stops test on failure
    require.NotNil(t, user)
    assert.Equal(t, "alice@example.com", user.Email)
    assert.NotEmpty(t, user.ID)
}
```

**`require` vs `assert`:**
- `require` — stops the test immediately on failure (use when subsequent assertions would panic)
- `assert` — records the failure and continues (use for non-fatal checks)

---

## Testing with Interfaces (Mocks)

Design production code to accept interfaces; inject fakes in tests.

```go
// Production interface
type UserStore interface {
    GetUser(ctx context.Context, id string) (*User, error)
    CreateUser(ctx context.Context, params CreateUserParams) (*User, error)
}

// Hand-rolled fake
type fakeUserStore struct {
    users map[string]*User
}

func (f *fakeUserStore) GetUser(_ context.Context, id string) (*User, error) {
    u, ok := f.users[id]
    if !ok {
        return nil, store.ErrNotFound
    }
    return u, nil
}

// Test
func TestGetUserHandler(t *testing.T) {
    fake := &fakeUserStore{users: map[string]*User{
        "u1": {ID: "u1", Email: "alice@example.com"},
    }}
    h := NewUserHandler(fake)
    // ...
}
```

For generated mocks, use `github.com/stretchr/testify/mock` or `go.uber.org/mock/gomock`.

---

## Testing HTTP Handlers

Use `net/http/httptest` — no real server needed.

```go
func TestGetUser_OK(t *testing.T) {
    store := &fakeUserStore{ /* ... */ }
    handler := NewUserHandler(store)

    req := httptest.NewRequest(http.MethodGet, "/users/u1", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    assert.Equal(t, http.StatusOK, rec.Code)

    var resp UserResponse
    require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
    assert.Equal(t, "u1", resp.ID)
}
```

---

## Testing with a Real Database (Integration Tests)

Use build tags to separate integration tests:

```go
//go:build integration

package store_test

func TestStore_CreateUser_Integration(t *testing.T) {
    // ...
}
```

Run: `go test -tags integration ./...`

For DB setup, use `testcontainers-go` or a shared test helper that creates/tears down a schema.

---

## Subtests and Test Helpers

```go
// t.Helper() makes failure lines point to the caller, not the helper
func assertUser(t *testing.T, got *User, wantEmail string) {
    t.Helper()
    if got == nil {
        t.Fatal("user is nil")
    }
    assert.Equal(t, wantEmail, got.Email)
}
```

---

## Race Detection and Parallel Tests

```bash
# Always run with race detector in CI
go test -race -count=1 ./...

# -count=1 disables test caching (important for flaky test detection)
```

Mark tests that can safely run in parallel:

```go
func TestSomething(t *testing.T) {
    t.Parallel()
    // ...
}
```

Do not use `t.Parallel()` on tests that share mutable global state.

---

## Benchmarks

```go
func BenchmarkParseAmount(b *testing.B) {
    b.ReportAllocs()
    for range b.N {
        _, _ = ParseAmount("1234.56")
    }
}
```

Run: `go test -bench=. -benchmem ./...`

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| No `t.Parallel()` on independent tests | Slow test suite | Add `t.Parallel()` |
| Testing implementation details | Brittle tests | Test behavior through public API |
| `init()` global state in tests | Test pollution | Use `TestMain` or per-test setup |
| Skipping `-race` in CI | Races slip to production | Always include `-race` |
| `time.Sleep` in tests | Flaky tests | Use channels, `eventually`, or deterministic clocks |
