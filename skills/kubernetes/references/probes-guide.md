# Kubernetes Probes Guide

## Three Probe Types

| Probe | What It Checks | Failure Action |
|-------|---------------|----------------|
| `startupProbe` | Has the app finished initialization? | Restart (container killed, replaced) |
| `livenessProbe` | Is the app stuck or deadlocked? | Restart the container |
| `readinessProbe` | Is the app ready to receive traffic? | Remove from Service endpoints (no restart) |

**Critical distinction:** Liveness restarts the pod. Readiness only stops traffic routing.

---

## Probe Decision Tree

```
Is the service expected to take more than ~30s to start?
├─ Yes → Add startupProbe (prevents liveness from killing during startup)
└─ No  → Set initialDelaySeconds on liveness instead

Should traffic be withheld during:
├─ Dependency unavailability (DB down)? → readinessProbe checks dependencies
└─ Internal processing (draining a queue)? → readinessProbe returns 503 during drain

Should the container restart when:
├─ It's in a deadlock? → livenessProbe (HTTP or exec)
└─ A dependency fails? → Do NOT use liveness for external deps (causes cascade restarts)
```

---

## Startup Probe

Use for services with variable or long startup times (JVM warmup, database migrations, model loading).

```yaml
startupProbe:
  httpGet:
    path: /livez
    port: 8080
  # Allow up to failureThreshold * periodSeconds for startup
  failureThreshold: 30    # 30 attempts
  periodSeconds: 10       # every 10 seconds = 5 minutes max startup time
  successThreshold: 1
```

Once the startup probe succeeds, Kubernetes switches to liveness and readiness probes.

---

## Liveness Probe

Detects deadlocked, frozen, or permanently unhealthy processes.

```yaml
livenessProbe:
  httpGet:
    path: /livez      # Must only check process health — NOT external dependencies
    port: 8080
    httpHeaders:
      - name: User-Agent
        value: kube-liveness-probe
  initialDelaySeconds: 5    # Wait before first check (skip if startupProbe is set)
  periodSeconds: 10         # Check every 10 seconds
  timeoutSeconds: 5         # Consider failed if no response in 5s
  failureThreshold: 3       # Restart after 3 consecutive failures (30s window)
  successThreshold: 1       # (Always 1 for liveness — cannot be > 1)
```

**What `/livez` should check:**
- Process is alive and its goroutines/threads are not deadlocked
- Internal state consistency (e.g., a background worker is running)

**What `/livez` must NOT check:**
- Database connectivity (DB down → liveness fails → pod restarts → repeat = thundering herd)
- External API availability
- Queue connectivity

---

## Readiness Probe

Gates traffic routing. Pod is excluded from Service load balancing while readiness fails.

```yaml
readinessProbe:
  httpGet:
    path: /readyz     # May check dependencies
    port: 8080
  initialDelaySeconds: 3
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3    # Remove from endpoints after 3 failures
  successThreshold: 1    # Re-add to endpoints after 1 success
```

**What `/readyz` should check:**
- Database connection pool is established
- Required downstream services are reachable
- Application-specific warm-up is complete (caches loaded, connections established)

**Common pattern (Go example):**
```go
// /livez — fast, process-only check
func LivezHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// /readyz — checks all required dependencies
func ReadyzHandler(db *sql.DB, cache *redis.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        checks := map[string]string{}
        status := http.StatusOK

        if err := db.PingContext(r.Context()); err != nil {
            checks["database"] = "unhealthy: " + err.Error()
            status = http.StatusServiceUnavailable
        } else {
            checks["database"] = "ok"
        }

        w.WriteHeader(status)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "status": map[int]string{200: "ok", 503: "degraded"}[status],
            "checks": checks,
        })
    }
}
```

---

## Exec and TCP Probes

For non-HTTP services:

```yaml
# Exec probe (runs a command in the container)
livenessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - redis-cli ping | grep -q PONG
  periodSeconds: 10

# TCP probe (checks if a port is open — no application-level check)
readinessProbe:
  tcpSocket:
    port: 5432
  periodSeconds: 5
```

Use exec probes sparingly — they spawn a new process per check and can be expensive.

---

## gRPC Probe (Kubernetes 1.27+)

```yaml
livenessProbe:
  grpc:
    port: 50051
    service: "grpc.health.v1.Health"   # Standard gRPC health protocol
  periodSeconds: 10
```

Requires the service to implement the [gRPC Health Checking Protocol](https://github.com/grpc/grpc/blob/master/doc/health-checking.md).

---

## Anti-Patterns

| Anti-Pattern | Risk | Correct Approach |
|-------------|------|-----------------|
| Liveness checks external DB | DB outage → cascade pod restarts | Use liveness for process health only |
| No startup probe + short initialDelaySeconds | Pod OOMKills during JVM warmup | Add startupProbe with high failureThreshold |
| `failureThreshold: 1` on liveness | One slow response → restart | Use failureThreshold 3+ with appropriate timeouts |
| Same endpoint for liveness + readiness | Can't distinguish process from dep failure | Separate `/livez` and `/readyz` |
| Readiness never fails | Traffic sent to unhealthy pod | Test that `/readyz` returns 503 when a dep is down |
