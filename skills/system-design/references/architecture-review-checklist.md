# Architecture Review Checklist

Scored checklist used by the `system-design-reviewer` agent and the `/system-design review` mode.

Each item is marked: PASS / FAIL / N/A (not applicable) / RISK (acceptable with documented rationale).

Score: `(PASS + N/A) / (PASS + FAIL + RISK + N/A) * 100`

Thresholds:
- **90–100%** — Approve
- **75–89%** — Conditional approval; address FAIL items before launch
- **< 75%** — Significant rework required

---

## 1. Resilience

### External calls

- [ ] Every HTTP client call has an explicit timeout (not default/infinite)
- [ ] Every database query has a statement timeout
- [ ] Every cache operation has a timeout (cache unavailability must not block the request path)
- [ ] Retry is implemented only for idempotent operations
- [ ] Retry uses exponential backoff with jitter; no fixed-interval retry
- [ ] Retry attempt count is bounded (max 3 for most cases)
- [ ] Circuit breaker is implemented for calls to external (non-owned) services
- [ ] Circuit breaker state is exported as a metric and alerted on

### Idempotency

- [ ] State-mutating operations that may be retried have idempotency keys
- [ ] Idempotency key implementation is server-side (not just client-side convention)
- [ ] Idempotency key TTL is defined and appropriate for the operation's resubmission window

### Messaging

- [ ] Every message consumer has a DLQ configured
- [ ] DLQ depth is monitored and alerted on
- [ ] Message handlers are idempotent
- [ ] Max retry attempts before DLQ are defined (not infinite)

### Degradation

- [ ] Graceful degradation behavior is defined for each external dependency
- [ ] Degradation does not compromise security (fallback cannot bypass auth)

---

## 2. Scalability

### Service design

- [ ] Services are stateless (no in-process session, no local file state)
- [ ] Session state is externalized (Redis, JWT)
- [ ] Uploaded files are stored in object storage (not local disk)
- [ ] Scheduled jobs use distributed locking or leader election (not multiple instances running the same job)

### Caching

- [ ] Cache is used for read-heavy paths (> 80% read ratio)
- [ ] Cache TTL is defined and appropriate for staleness tolerance
- [ ] Cache key includes all dimensions that differentiate the result (tenant, user, locale, version)
- [ ] Cache stampede / thundering herd is addressed (probabilistic early expiry or lock-on-miss)
- [ ] Cache invalidation strategy is defined and owned

### Database

- [ ] Read-heavy paths use read replicas or caching
- [ ] Connection pooling is configured
- [ ] Queries are paginated — no unbounded result sets in API responses
- [ ] N+1 query patterns are absent from hot paths
- [ ] Indexes exist for all filtered columns in hot queries

### Load testing

- [ ] Expected peak load is defined (requests/sec, concurrent users, data volume)
- [ ] Load test results exist or are planned before launch

---

## 3. Data Consistency

### Transaction boundaries

- [ ] Transaction boundaries are explicit and minimal (no long-running transactions holding locks)
- [ ] No distributed transactions (2PC) across service boundaries
- [ ] Dual-write to database and message broker is eliminated (outbox pattern or CDC in place)

### Event-driven systems

- [ ] Outbox pattern or CDC is used to guarantee at-least-once event delivery
- [ ] Event consumers are idempotent
- [ ] Event schema includes version field
- [ ] Breaking schema changes follow a versioning protocol (additive-only, deprecation window)

### Saga / long-running processes

- [ ] Saga compensation transactions are defined for each step
- [ ] Saga state is persisted (not in-memory)
- [ ] Saga timeout and failure escalation are handled

---

## 4. Data Ownership and Access

### Service boundaries

- [ ] Each service owns its own database — no shared DB schema between services
- [ ] Cross-service data access goes through APIs, not direct DB queries
- [ ] PII and sensitive data is identified and its storage location documented

### Multi-tenancy (if applicable)

- [ ] Tenant isolation strategy is defined (RLS, schema-per-tenant, DB-per-tenant)
- [ ] All queries enforce tenant scoping — no risk of cross-tenant data exposure
- [ ] Tenant isolation is tested (negative test: verify tenant A cannot see tenant B's data)

---

## 5. Security

### Authentication and authorization

- [ ] All endpoints require authentication (explicit public endpoints are documented)
- [ ] Authorization is checked at the service boundary, not only at the gateway
- [ ] Tokens have appropriate expiry; refresh token rotation is implemented

### Input validation

- [ ] All external inputs are validated before processing
- [ ] SQL queries use parameterized queries (no string concatenation)
- [ ] File uploads validate type and size before processing

### Secrets

- [ ] No secrets in code, config files, or environment variable literals in manifests
- [ ] Secrets are sourced from a secrets manager (Vault, AWS SSM, GCP Secret Manager)
- [ ] Secret rotation does not require a service restart

---

## 6. Observability

### Metrics

- [ ] Service exposes RED metrics (Rate, Errors, Duration) per endpoint
- [ ] Circuit breaker state is exported as a metric
- [ ] Queue consumer lag is monitored
- [ ] DLQ depth is monitored

### Logging

- [ ] Structured JSON logging on every service
- [ ] Log includes: trace_id, service, level, timestamp, message
- [ ] No PII in log lines (user data, payment info, credentials)

### Tracing

- [ ] Distributed tracing is configured (OTel or Datadog)
- [ ] Trace context is propagated through async boundaries (outbox/event metadata)

### Alerts

- [ ] SLO is defined for each user-facing operation
- [ ] Burn rate alerts are configured for SLO breach
- [ ] On-call runbook URL is included in every alert definition

### Health checks

- [ ] `/livez` and `/readyz` endpoints are implemented
- [ ] `/readyz` checks all required dependencies (DB, cache, required external services)
- [ ] Load balancer uses `/readyz` for traffic routing decisions

---

## 7. Operational Readiness

### Deployment

- [ ] Zero-downtime deployment is possible (rolling, blue-green, or canary)
- [ ] Schema migrations are backward-compatible (old code can run with new schema)
- [ ] Feature flags are used to gate risky features from full traffic exposure

### Failure recovery

- [ ] Recovery time objective (RTO) is defined and achievable
- [ ] Recovery point objective (RPO) is defined; backup frequency matches it
- [ ] Database backup and restore has been tested (not just configured)

### Documentation

- [ ] Architecture diagram exists (C4 context + container level minimum)
- [ ] ADRs (Architecture Decision Records) exist for major decisions
- [ ] On-call runbook covers common failure scenarios

---

## Review Output Template

```markdown
## Architecture Review: [System/Feature Name]

**Score:** [N]% ([PASS]/[total] checks passing)
**Verdict:** Approve / Conditional Approval / Rework Required

### Critical (must fix before launch)
- [Item]: [Description of the gap and risk]

### High (strongly recommended)
- [Item]: [Suggestion and rationale]

### Medium (worth addressing)
- [Item]: [Observation]

### Low (minor polish)
- [Item]: [Detail]

### N/A Items
- [Item]: [Why it does not apply to this design]
```
