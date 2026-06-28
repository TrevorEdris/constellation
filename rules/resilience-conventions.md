---
description: 'Enforces resilience patterns on HTTP client code and external service
  calls: explicit timeouts, bounded retry with jitter, circuit breaker usage, and
  idempotency key propagation for state-mutating operations.'
paths:
- '**/**/*client*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*http*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*grpc*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*service*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*gateway*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*adapter*.{go'
- '**/ts'
- '**/py'
- '**/java}'
---

## Resilience Conventions

### Every HTTP Client Call Must Set an Explicit Timeout

- [CRITICAL] An HTTP client with no timeout will hang indefinitely when the downstream is slow — one slow dependency can exhaust the entire thread pool
- Default HTTP clients in Go (`net/http`), Java (`HttpClient`), Python (`requests`), and Node.js (`node-fetch`) all have no timeout by default
- Set: `connect_timeout`, `read_timeout`, and overall request deadline

```go
// Go: required — no timeout is a [CRITICAL]
client := &http.Client{Timeout: 5 * time.Second}

// Also set per-request context deadline for finer control
ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
```

```java
// Java: required
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(1))
    .build();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create(url))
    .timeout(Duration.ofSeconds(5))
    .build();
```

```python
# Python: required
import requests
response = requests.get(url, timeout=(1.0, 5.0))  # (connect_timeout, read_timeout)
```

### Database Queries Must Have a Statement Timeout

- [CRITICAL] A runaway query with no timeout holds locks and consumes connection pool slots for the duration — cascade failure risk
- Set at connection level or per-query

```go
// Go + pgx: per-query timeout
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
rows, err := db.QueryContext(ctx, "SELECT ...")
```

```sql
-- Postgres: set session-level statement timeout
SET statement_timeout = '30s';
-- Or per-transaction
SET LOCAL statement_timeout = '10s';
```

### Retry Must Use Exponential Backoff with Jitter

- [CRITICAL] Fixed-interval retry without jitter causes thundering herd — all clients retry simultaneously, amplifying the failure
- Required formula: `sleep = min(cap, base * 2^attempt) + rand(0, jitter_max)`
- Maximum attempts: 3 for most cases; total retry duration must fit within caller's SLA budget

```go
// Go: exponential backoff with jitter
func retryWithBackoff(ctx context.Context, maxAttempts int, fn func() error) error {
    var err error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        if err = fn(); err == nil {
            return nil
        }
        if attempt == maxAttempts-1 {
            break
        }
        base := time.Duration(100<<uint(attempt)) * time.Millisecond
        jitter := time.Duration(rand.Intn(100)) * time.Millisecond
        sleep := base + jitter
        if sleep > 10*time.Second {
            sleep = 10 * time.Second
        }
        select {
        case <-time.After(sleep):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return err
}
```

### Retry Count Must Be Bounded

- [HIGH] Unbounded retries (while true, retry forever) will keep a service alive while causing cascading pressure on an already failing downstream
- Cap: 3 attempts for most idempotent calls; 1 attempt (no retry) for non-idempotent calls without idempotency keys
- Always honor the caller's context deadline — abort retries when context is cancelled

### Non-Idempotent Calls Must Not Be Retried Without Idempotency Keys

- [CRITICAL] Retrying a POST without an idempotency key on a state-mutating operation (payment, order creation, send email) will execute the operation multiple times — double charges, duplicate orders, duplicate emails
- Rule: if the operation is not idempotent by design AND you need retry, generate an idempotency key before the first attempt and send it on every retry

```go
// Required: idempotency key for retried state-mutating calls
idempotencyKey := uuid.New().String()

for attempt := 0; attempt < maxAttempts; attempt++ {
    req.Header.Set("Idempotency-Key", idempotencyKey)
    resp, err := client.Do(req)
    if err == nil && resp.StatusCode < 500 {
        break
    }
    // retry with same idempotencyKey
}
```

### Circuit Breaker Required for External (Non-Owned) Service Calls

- [HIGH] Without a circuit breaker, every instance of your service will keep calling a failed external dependency, wasting thread time and adding load to a service that is already failing
- "External" means: any service your team does not own and deploy (third-party APIs, partner services, other teams' services in different SLAs)
- States: Closed (normal) → Open (stop calling; return fallback) → Half-Open (probe recovery)

```go
// Go: circuit breaker wrapping an external call
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "payment-gateway",
    MaxRequests: 1,
    Interval:    10 * time.Second,
    Timeout:     30 * time.Second,
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        return counts.Requests >= 10 &&
               float64(counts.TotalFailures)/float64(counts.Requests) >= 0.5
    },
})

result, err := cb.Execute(func() (interface{}, error) {
    return externalPaymentClient.Charge(ctx, req)
})
if err == gobreaker.ErrOpenState {
    return fallbackResponse()  // circuit is open; return safe default
}
```

### Circuit Breaker State Must Be Observable

- [MEDIUM] A circuit breaker with no metrics is invisible during incidents — you won't know which dependency is open
- Export: `circuit_breaker_state{service, name}` (0=closed, 1=open, 2=half-open)
- Alert: if `circuit_breaker_state == 1` (open) for > 60 seconds → page on-call

### Fallback Must Not Bypass Security Decisions

- [CRITICAL] A fallback that returns "allow" when the authorization service is unavailable creates a security hole that an attacker can trigger deliberately
- For authorization, the fail-safe default is always DENY: if auth service is unreachable, reject the request with a 503 — do not assume permission

### Timeout Budget Must Fit Within Caller's SLA

- [HIGH] If your service has a 2s SLA and you call a dependency with a 3s timeout with 3 retries, you will always violate your SLA on retries
- Calculate: `max_total_duration = n * per_call_timeout + sum(backoff_delays) < caller_sla - network_buffer`
- Reduce per-call timeout or retry count to fit; or accept the SLA degradation and document it

### Every External Call Must Have a Documented Fallback

- [MEDIUM] "What happens when this service is unavailable?" should have an explicit answer for every external dependency
- Options: cached response, static default, graceful error to the user, circuit breaker + fallback value
- Document the fallback behavior in the code (comment or doc) and in the service's runbook
