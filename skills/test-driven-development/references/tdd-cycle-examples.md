# TDD Cycle Examples

Concrete RED-GREEN-REFACTOR examples in three languages. Each example is minimal and realistic — small enough to understand completely, substantial enough to show the discipline.

---

## Example 1: Bug Fix — TypeScript/JavaScript

**Scenario:** Users can submit a registration form with an empty email address. The backend accepts it and creates a broken account. Bug: `validateEmail('')` returns `true`.

### RED: Write the Failing Test

```typescript
// src/validation/__tests__/validateEmail.test.ts
import { validateEmail } from '../validateEmail';

describe('validateEmail', () => {
  it('should return false for an empty string', () => {
    expect(validateEmail('')).toBe(false);
  });
});
```

### Verify RED

```
$ npm test src/validation/__tests__/validateEmail.test.ts

FAIL src/validation/__tests__/validateEmail.test.ts
  validateEmail
    ✕ should return false for an empty string (3ms)

  ● validateEmail › should return false for an empty string

    expect(received).toBe(expected)

    Expected: false
    Received: true

Tests: 1 failed, 0 passed
```

Failure is for the expected reason: `validateEmail('')` returns `true` when it should return `false`. RED is confirmed.

### GREEN: Minimal Implementation

```typescript
// src/validation/validateEmail.ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  if (email.trim() === '') return false;
  return EMAIL_REGEX.test(email);
}
```

### Verify GREEN

```
$ npm test src/validation/__tests__/validateEmail.test.ts

PASS src/validation/__tests__/validateEmail.test.ts
  validateEmail
    ✓ should return false for an empty string (2ms)

Tests: 1 passed, 0 failed
```

Run the full suite:

```
$ npm test

PASS src/validation/__tests__/validateEmail.test.ts
PASS src/auth/__tests__/registration.test.ts
PASS src/users/__tests__/userService.test.ts

Tests: 47 passed, 0 failed
```

All green. No regressions.

### REFACTOR

The implementation is already clean. No duplication. The `trim()` guard is intentional — whitespace-only strings should fail validation. No changes needed.

### Verify REFACTOR

```
$ npm test

Tests: 47 passed, 0 failed
```

---

## Example 2: New Feature — Python

**Scenario:** A data pipeline needs a function to validate incoming webhook payloads. The payload must contain `event_type` and `timestamp` fields, and `event_type` must be one of an allowed set.

### RED: Write the Failing Test

```python
# tests/test_webhook_validation.py
import pytest
from app.validation import validate_webhook_payload

ALLOWED_EVENTS = {'user.created', 'user.deleted', 'order.placed'}

def test_valid_payload_passes():
    payload = {'event_type': 'user.created', 'timestamp': '2025-01-01T00:00:00Z'}
    assert validate_webhook_payload(payload, ALLOWED_EVENTS) is True

def test_missing_event_type_fails():
    payload = {'timestamp': '2025-01-01T00:00:00Z'}
    with pytest.raises(ValueError, match="Missing required field: event_type"):
        validate_webhook_payload(payload, ALLOWED_EVENTS)

def test_unknown_event_type_fails():
    payload = {'event_type': 'unknown.event', 'timestamp': '2025-01-01T00:00:00Z'}
    with pytest.raises(ValueError, match="Unknown event_type"):
        validate_webhook_payload(payload, ALLOWED_EVENTS)

def test_missing_timestamp_fails():
    payload = {'event_type': 'user.created'}
    with pytest.raises(ValueError, match="Missing required field: timestamp"):
        validate_webhook_payload(payload, ALLOWED_EVENTS)
```

### Verify RED

```
$ pytest tests/test_webhook_validation.py -v

FAILED tests/test_webhook_validation.py::test_valid_payload_passes
  ImportError: cannot import name 'validate_webhook_payload' from 'app.validation'

ERROR: 4 errors during collection
```

Not yet a pure RED — the module doesn't exist. Fix the import first:

```python
# app/validation.py
def validate_webhook_payload(payload, allowed_events):
    pass
```

```
$ pytest tests/test_webhook_validation.py -v

FAILED tests/test_webhook_validation.py::test_valid_payload_passes - AssertionError: assert None is True
FAILED tests/test_webhook_validation.py::test_missing_event_type_fails - Failed: DID NOT RAISE <class 'ValueError'>
FAILED tests/test_webhook_validation.py::test_unknown_event_type_fails - Failed: DID NOT RAISE <class 'ValueError'>
FAILED tests/test_webhook_validation.py::test_missing_timestamp_fails - Failed: DID NOT RAISE <class 'ValueError'>

4 failed, 0 passed
```

All four tests fail for the expected reasons. RED confirmed.

### GREEN: Minimal Implementation

```python
# app/validation.py
def validate_webhook_payload(payload: dict, allowed_events: set) -> bool:
    for field in ('event_type', 'timestamp'):
        if field not in payload:
            raise ValueError(f"Missing required field: {field}")

    if payload['event_type'] not in allowed_events:
        raise ValueError(f"Unknown event_type: {payload['event_type']}")

    return True
```

### Verify GREEN

```
$ pytest tests/test_webhook_validation.py -v

PASSED tests/test_webhook_validation.py::test_valid_payload_passes
PASSED tests/test_webhook_validation.py::test_missing_event_type_fails
PASSED tests/test_webhook_validation.py::test_unknown_event_type_fails
PASSED tests/test_webhook_validation.py::test_missing_timestamp_fails

4 passed, 0 failed
```

Run the full suite:

```
$ pytest

================================= 63 passed in 0.84s =================================
```

All green.

### REFACTOR

Extract the required fields as a constant. The loop approach is clean but the magic strings should be named.

```python
# app/validation.py
REQUIRED_FIELDS = ('event_type', 'timestamp')

def validate_webhook_payload(payload: dict, allowed_events: set) -> bool:
    for field in REQUIRED_FIELDS:
        if field not in payload:
            raise ValueError(f"Missing required field: {field}")

    if payload['event_type'] not in allowed_events:
        raise ValueError(f"Unknown event_type: {payload['event_type']}")

    return True
```

### Verify REFACTOR

```
$ pytest

================================= 63 passed in 0.82s =================================
```

---

## Example 3: New Feature — Go

**Scenario:** An API needs a health check handler that returns `{"status": "ok"}` with HTTP 200 when the service is healthy, and `{"status": "degraded", "reason": "..."}` with HTTP 503 when a dependency is unavailable.

### RED: Write the Failing Test

```go
// internal/handlers/health_test.go
package handlers_test

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/yourorg/yourapp/internal/handlers"
)

type mockChecker struct {
    healthy bool
    reason  string
}

func (m *mockChecker) Check() (bool, string) {
    return m.healthy, m.reason
}

func TestHealthHandler_Healthy(t *testing.T) {
    checker := &mockChecker{healthy: true}
    handler := handlers.NewHealthHandler(checker)

    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("expected status 200, got %d", rec.Code)
    }

    var body map[string]string
    json.NewDecoder(rec.Body).Decode(&body)

    if body["status"] != "ok" {
        t.Errorf("expected status ok, got %s", body["status"])
    }
}

func TestHealthHandler_Degraded(t *testing.T) {
    checker := &mockChecker{healthy: false, reason: "database unreachable"}
    handler := handlers.NewHealthHandler(checker)

    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusServiceUnavailable {
        t.Errorf("expected status 503, got %d", rec.Code)
    }

    var body map[string]string
    json.NewDecoder(rec.Body).Decode(&body)

    if body["status"] != "degraded" {
        t.Errorf("expected status degraded, got %s", body["status"])
    }
    if body["reason"] != "database unreachable" {
        t.Errorf("expected reason 'database unreachable', got %s", body["reason"])
    }
}
```

### Verify RED

```
$ go test ./internal/handlers/...

# github.com/yourorg/yourapp/internal/handlers_test
./health_test.go:10:2: no required module provides package github.com/yourorg/yourapp/internal/handlers; to add it:
        go get github.com/yourorg/yourapp/internal/handlers
FAIL    github.com/yourorg/yourapp/internal/handlers [build failed]
```

The package doesn't exist yet. Create an empty stub:

```go
// internal/handlers/health.go
package handlers
```

```
$ go test ./internal/handlers/...

./health_test.go:14:14: undefined: handlers.NewHealthHandler
FAIL    github.com/yourorg/yourapp/internal/handlers [build failed]
```

Getting closer. The function doesn't exist yet. This is the expected RED state — the test cannot compile because the implementation is missing.

### GREEN: Minimal Implementation

```go
// internal/handlers/health.go
package handlers

import (
    "encoding/json"
    "net/http"
)

type HealthChecker interface {
    Check() (bool, string)
}

type HealthHandler struct {
    checker HealthChecker
}

func NewHealthHandler(checker HealthChecker) *HealthHandler {
    return &HealthHandler{checker: checker}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    healthy, reason := h.checker.Check()

    w.Header().Set("Content-Type", "application/json")

    if healthy {
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
        return
    }

    w.WriteHeader(http.StatusServiceUnavailable)
    json.NewEncoder(w).Encode(map[string]string{
        "status": "degraded",
        "reason": reason,
    })
}
```

### Verify GREEN

```
$ go test ./internal/handlers/...

ok  github.com/yourorg/yourapp/internal/handlers  0.003s
```

Run the full suite:

```
$ go test ./...

ok  github.com/yourorg/yourapp/internal/handlers  0.003s
ok  github.com/yourorg/yourapp/internal/middleware  0.002s
ok  github.com/yourorg/yourapp/pkg/validation  0.001s
ok  github.com/yourorg/yourapp/pkg/database  0.008s

All tests passed.
```

### REFACTOR

The response encoding is repeated. Extract a helper:

```go
// internal/handlers/health.go
package handlers

import (
    "encoding/json"
    "net/http"
)

type HealthChecker interface {
    Check() (bool, string)
}

type HealthHandler struct {
    checker HealthChecker
}

func NewHealthHandler(checker HealthChecker) *HealthHandler {
    return &HealthHandler{checker: checker}
}

func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    healthy, reason := h.checker.Check()
    if healthy {
        writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
        return
    }
    writeJSON(w, http.StatusServiceUnavailable, map[string]string{
        "status": "degraded",
        "reason": reason,
    })
}

func writeJSON(w http.ResponseWriter, status int, body any) {
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(body)
}
```

### Verify REFACTOR

```
$ go test ./...

ok  github.com/yourorg/yourapp/internal/handlers  0.003s
ok  github.com/yourorg/yourapp/internal/middleware  0.002s
ok  github.com/yourorg/yourapp/pkg/validation  0.001s
ok  github.com/yourorg/yourapp/pkg/database  0.008s
```

All green. Cycle complete.
