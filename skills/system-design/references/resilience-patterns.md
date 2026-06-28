# Resilience Patterns Reference

Detailed theory and decision guidance for building resilient distributed services.

---

## Timeout

### Why it matters

Without a timeout, a hung dependency holds a thread or connection slot open indefinitely. In high-concurrency systems, 10% of requests hanging can saturate the thread pool and cascade into a full outage.

### Configuration guidance

```
connect_timeout:  time to establish TCP connection (typically 100-500ms)
read_timeout:     time to receive the first byte after connection (typically 1-30s)
write_timeout:    time to write the full request body (typically 1-10s)
idle_timeout:     time to keep idle connection alive in pool (typically 60-90s)
```

Set timeouts at every layer:
- HTTP client timeout
- DB query timeout (statement_timeout in Postgres)
- Cache operation timeout
- Message broker operation timeout

### Common mistake: inheriting default timeouts

Most HTTP clients (Go's `net/http`, Java's `HttpClient`) default to no timeout. Always set explicitly.

```go
// Go: explicit timeout required
client := &http.Client{
    Timeout: 5 * time.Second,
}
```

---

## Retry with Exponential Backoff + Jitter

### When to retry

Retry only on transient failures:
- Network timeouts
- 429 Too Many Requests (with Retry-After header)
- 502, 503, 504 (gateway/upstream errors)
- Connection refused

Do NOT retry on:
- 400 Bad Request (client error; retry won't help)
- 401/403 (auth failure; retry leaks credentials)
- 404 Not Found (entity doesn't exist; retry won't help)
- 422 Unprocessable Entity (validation failure)

### Retry budget

Never retry indefinitely. Two constraints:

1. **Max attempts:** typically 3 (1 initial + 2 retries)
2. **Max total duration:** must fit within the caller's SLA budget
   - If caller SLA is 2s and each attempt has a 500ms timeout, you have 4 attempts before you blow the budget
   - Leave headroom for retry delays: `n * timeout + sum(delays) < caller_sla`

### Backoff formula

```
sleep_ms = min(cap, base * 2^attempt) + random(0, base)

Example:
  base = 100ms, cap = 10s
  Attempt 0: sleep = 100ms + jitter
  Attempt 1: sleep = 200ms + jitter
  Attempt 2: sleep = 400ms + jitter
  Attempt 3: sleep = 800ms + jitter
```

**Why jitter is mandatory:** Without jitter, all clients that hit an error simultaneously will retry at the same time — thundering herd. Jitter desynchronizes retries and distributes load.

### Non-idempotent operations

POST, PATCH, and most business mutations are not safely retried without idempotency keys. If you retry a payment without an idempotency key, you may charge the customer twice.

Rule: any retried operation must be idempotent by design.

---

## Idempotency Keys

### When required

- Payment processing (charge, refund, transfer)
- Order creation
- Provisioning operations (create VM, send SMS, send email)
- Any state-mutating operation that flows through a retry-capable path

### Implementation

**Client-side:**
1. Generate a UUID v4 before the first attempt
2. Include as `Idempotency-Key: {uuid}` header (REST) or field in request body (gRPC)
3. Reuse the same key on all retries for the same logical operation
4. Generate a new key for intentional new operations

**Server-side:**
1. Extract idempotency key from request
2. Check `idempotency_keys` table: `SELECT result FROM idempotency_keys WHERE key = $1`
3. If found: return cached result (do not execute operation again)
4. If not found: execute operation, store result with key in same transaction
5. TTL key storage based on acceptable resubmission window (e.g., 24h for payments)

```sql
CREATE TABLE idempotency_keys (
    key         UUID PRIMARY KEY,
    response    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Index for TTL cleanup
CREATE INDEX ON idempotency_keys (expires_at);
```

### Stripe's model (reference implementation)

- Key is tied to API key + idempotency key (prevents cross-customer collisions)
- Keys expire after 24 hours
- In-flight deduplication: second request with same key blocks until first completes
- Returns `Idempotent-Replayed: true` header on cache hits

---

## Circuit Breaker

### State machine

```
CLOSED (normal operation)
  All requests pass through.
  Track failure count in rolling window.
  If failures exceed threshold → OPEN

OPEN (protecting downstream)
  All requests fail immediately (no call to downstream).
  Fallback response returned.
  After sleep duration → HALF-OPEN

HALF-OPEN (probing recovery)
  Allow one request through.
  If success → CLOSED (reset failure count)
  If failure → OPEN (with longer sleep duration)
```

### Configuration parameters

| Parameter | Typical Value | Purpose |
|-----------|--------------|---------|
| failure_threshold | 50% over 10s | Percentage of failures to trigger open |
| min_requests | 10 | Minimum requests before evaluating threshold (prevents false trips on low volume) |
| sleep_duration | 30s | How long to stay open before probing |
| half_open_max | 1-3 requests | How many probes to allow in half-open |

### Library examples

**Go (gobreaker):**
```go
st := gobreaker.Settings{
    Name:        "order-service",
    MaxRequests: 1,
    Interval:    10 * time.Second,
    Timeout:     30 * time.Second,
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
        return counts.Requests >= 10 && failureRatio >= 0.5
    },
}
cb := gobreaker.NewCircuitBreaker(st)
result, err := cb.Execute(func() (interface{}, error) {
    return callDownstream(ctx, req)
})
```

**Java (resilience4j):**
```java
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .slidingWindowType(COUNT_BASED)
    .slidingWindowSize(10)
    .failureRateThreshold(50)
    .waitDurationInOpenState(Duration.ofSeconds(30))
    .permittedNumberOfCallsInHalfOpenState(1)
    .build();
CircuitBreaker cb = CircuitBreaker.of("order-service", config);
```

### Observability

Export circuit breaker state as a metric:
```
circuit_breaker_state{service="order-service", state="open|closed|half_open"} 1
circuit_breaker_calls_total{service="order-service", outcome="success|failure|rejected"} N
```

Alert: if `circuit_breaker_state == open` for more than 60 seconds → page on-call.

---

## Bulkhead

### Purpose

Prevent one slow dependency from exhausting all threads/connections and taking down unrelated functionality.

### Thread pool bulkhead (Java/JVM)

```java
// Separate thread pool per downstream service
ThreadPoolBulkheadConfig config = ThreadPoolBulkheadConfig.custom()
    .maxThreadPoolSize(5)
    .coreThreadPoolSize(3)
    .queueCapacity(10)
    .build();
```

### Connection pool bulkhead (databases)

```yaml
# Separate connection pool per read/write path
datasource:
  primary:
    maximum-pool-size: 20    # writes go here
  replica:
    maximum-pool-size: 30    # reads go here
```

### Semaphore bulkhead

Limit concurrent calls without a separate thread pool:
```go
sem := make(chan struct{}, maxConcurrent)
select {
case sem <- struct{}{}:
    defer func() { <-sem }()
    return callDownstream(ctx)
default:
    return nil, ErrBulkheadFull
}
```

---

## Dead Letter Queue (DLQ)

See `/event-driven consumer-design` for broker-specific DLQ implementation.

### Design principles

- Every queue consumer must have a DLQ — no exceptions
- DLQ is not a graveyard; it is a staging area for investigation
- Alert immediately on DLQ depth > 0 (or threshold for high-volume queues)
- Remediation process: investigate → fix consumer → replay from DLQ → confirm

### DLQ message envelope

Include in every DLQ message:
```json
{
  "original_message": { ... },
  "failure_reason": "NullPointerException: order.user_id is null",
  "attempt_count": 3,
  "first_attempt_at": "2024-01-15T10:00:00Z",
  "last_attempt_at": "2024-01-15T10:05:00Z",
  "consumer_group": "inventory-service-orders-consumer",
  "source_topic": "orders",
  "source_partition": 2,
  "source_offset": 98745
}
```

---

## Timeout + Retry + Fallback Chain

### Composition order

1. **Timeout** wraps the outermost call (prevents hanging forever)
2. **Retry** wraps the timed call (retries on transient failure within timeout budget)
3. **Circuit breaker** wraps the retry (prevents retrying a known-broken dependency)
4. **Fallback** is invoked when the circuit is open (returns safe default)

```go
// Pseudocode: correct composition
func callWithResilience(ctx context.Context) (Result, error) {
    if circuitBreaker.IsOpen() {
        return fallback()
    }

    var result Result
    err := retry.Do(func() error {
        ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
        defer cancel()
        var e error
        result, e = callDownstream(ctx)
        return e
    }, retry.Attempts(3), retry.DelayType(retry.BackOffDelay))

    if err != nil {
        circuitBreaker.RecordFailure()
        return fallback()
    }

    circuitBreaker.RecordSuccess()
    return result, nil
}
```

### When fallback is not acceptable

Fallback implies stale or synthetic data is acceptable. It is NOT acceptable for:
- Financial operations (balance checks, payment authorization)
- Authorization decisions (must not fall back to "allow")
- Safety-critical operations

In these cases: fail fast with a clear error. Do not serve stale data to appear healthy.
