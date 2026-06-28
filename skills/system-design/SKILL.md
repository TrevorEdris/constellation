---
name: system-design
description: "Use when choosing or reviewing distributed-system architecture -- resilience (circuit breaker, retry, bulkhead, idempotency), scalability (caching, sharding, CQRS), sync-vs-async messaging, data patterns (CDC, multi-tenancy), or migration strategies."
context: fork
agent: system-design-reviewer
allowed-tools: Read, Grep, Glob
model: sonnet
argument-hint: "[mode: resilience|scalability|data|messaging|migration|review]"
tags: [architecture]
---

# System Design

Hub for distributed system architecture decisions. Select a mode to focus the analysis.

## When to Use

- Choosing between synchronous and asynchronous communication
- Designing a resilient service (retries, circuit breakers, idempotency)
- Deciding how to scale a service (caching, sharding, read replicas)
- Selecting a messaging technology or pattern
- Planning a migration from a monolith or legacy system
- Reviewing an architecture design, ADR, or RFC

## Modes

| Mode | Trigger | Focus |
|------|---------|-------|
| `resilience` | `/system-design resilience` | Circuit breaker, retry, bulkhead, idempotency, DLQ |
| `scalability` | `/system-design scalability` | Caching selection, sharding, CQRS, read replicas |
| `data` | `/system-design data` | DB per service, CDC, polyglot persistence, multi-tenancy |
| `messaging` | `/system-design messaging` | Sync vs async, queue vs stream, broker selection |
| `migration` | `/system-design migration` | Strangler fig, feature flags, anti-corruption layer |
| `review` | `/system-design review` | Architecture review against scored checklist |

If no mode is specified, ask the user which problem they are solving and select the most relevant mode.

## Mode: Resilience

**Goal:** Every external call must be protected. Apply patterns in this order: timeout → retry → circuit breaker → fallback.

### Tier 1 — Apply to every service

**Timeout**
- Set on every outbound call (HTTP, gRPC, DB, cache, queue)
- No call should use the default (often infinite) timeout
- Rule: `connect_timeout < read_timeout < operation_deadline`

**Retry with exponential backoff + jitter**
- Only retry idempotent operations (GET, HEAD, PUT, DELETE; safe POSTs with idempotency key)
- Cap at 3 attempts; cap total retry duration to stay under SLA budget
- Jitter formula: `sleep = base * 2^attempt + rand(0, base)` — prevents thundering herd

**Idempotency keys**
- Required for: payments, order creation, any state-mutating call that may be retried
- Client generates UUID; server stores key+result; duplicate key returns cached result
- Key must survive the operation's TTL (e.g., 24h for payments)

**Circuit breaker**
- States: Closed (normal) → Open (stop calling) → Half-Open (probe recovery)
- Open threshold: typically 50% failure rate over 10-second window
- Half-open: allow 1 request through; if success → Close; if fail → reopen with longer backoff
- Libraries: resilience4j (Java/Kotlin), gobreaker/failsafe-go (Go), Polly (.NET), opossum (Node.js)

### Tier 2 — Apply when failure modes are understood

**Bulkhead**
- Isolate thread pools or connection pools per downstream dependency
- One saturated dependency cannot starve threads serving other dependencies
- Implementation: separate `ExecutorService` per client; separate DB connection pool per read/write path

**Dead letter queue (DLQ)**
- Required on every message consumer — see `/event-driven` for implementation
- Messages that fail after max retries park in DLQ for investigation
- Alert on DLQ depth > 0

**Graceful degradation**
- Define what "partial success" means before a dependency fails
- Feature flags can gate degraded paths: if flag enabled, return cached/stub response
- Log degraded responses with the dependency name and duration of degradation

**Timeout + retry + fallback chain**
- Order matters: apply timeout first (prevents hanging), retry second (recovers transient), fallback last (known-safe default)
- Fallback is not always acceptable — stale data can be worse than an error for financial operations

### Decision Guide

```
Is the call idempotent?
  YES → retry up to 3 times with backoff
  NO  → set idempotency key first, then retry is safe

Is this calling an external (non-owned) service?
  YES → circuit breaker required
  NO  → circuit breaker optional but recommended

Can the user tolerate stale or partial data?
  YES → graceful degradation + fallback acceptable
  NO  → fail fast with a clear error; do not serve stale data
```

### Cross-references
- For circuit breaker state as an SLI: see `observability` skill
- For resilience conventions enforcement: see `resilience-conventions` rule

---

## Mode: Scalability

**Goal:** Scale the right layer for the actual bottleneck.

### Tier 1 — Default patterns

**Horizontal scaling**
- Requires stateless services: no in-process session, no local file state
- Session state → Redis; uploaded files → object storage (S3/GCS)
- Load balancer health checks must hit `/readyz`, not `/livez`

**Cache-aside (lazy caching)**
- Check cache → on miss, fetch from source → write to cache → return
- TTL must be shorter than acceptable staleness window
- Key design: `{service}:{entity}:{id}:{version}` — prevents cross-tenant collisions
- Full reference: `performance-optimization` skill → `references/CACHING_STRATEGIES.md`

**Read replicas**
- Route read-heavy queries to replica; writes always go to primary
- Replica lag is real — do not read from replica immediately after write (read-your-own-writes problem)
- Solution: session consistency (pin to primary for N seconds after write) or read from primary for critical paths

**Connection pooling**
- PgBouncer (Postgres transaction-mode), HikariCP (JVM), pgx pool (Go)
- Max pool size = (CPU cores × 2) + effective_spindle_count (rule of thumb for Postgres)
- Never open connections per request in serverless; use external pool (RDS Proxy, PgBouncer)

### Tier 2 — When Tier 1 reaches ceiling

**Database sharding**
- Shard key selection is irreversible without a migration — choose carefully
- Good shard keys: tenant ID, user ID (high cardinality, queries filter by it)
- Bad shard keys: created_at (hotspot), status (low cardinality)
- Avoid cross-shard queries; denormalize or use an aggregation layer

**CQRS (Command Query Responsibility Segregation)**
- Separate write model (normalized, transactionally consistent) from read model (denormalized, optimized for query)
- Does NOT require event sourcing — a simple read replica or materialized view satisfies CQRS
- Use when read and write access patterns are fundamentally different
- Full event sourcing: append-only event log; any read model can be rebuilt by replaying events

**Materialized views**
- Pre-computed query results stored as a table
- Refresh on schedule (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) or trigger-based
- Trade: read speed at the cost of write overhead and potential staleness

### Decision Guide

```
Is the bottleneck on reads?
  → Add read replicas, cache-aside, CDN for public responses

Is the bottleneck on writes?
  → Shard by write-hot key, async background jobs, write-behind cache (carefully)

Is the bottleneck on query complexity?
  → Materialized views, CQRS read model, Elasticsearch for search

Is the data growing unboundedly?
  → Partition by time (Postgres partitioning, Cassandra TTL), archive to cold storage
```

---

## Mode: Data

**Goal:** Choose the right data storage and ownership strategy.

### Database per service
- Each microservice owns its schema; no other service queries it directly
- Cross-service data needs: API call, event-driven sync, or dedicated read model
- Migration risk is contained: schema changes in one service don't break others
- Complicates joins — use this pattern when service autonomy matters more than query simplicity

### Change Data Capture (CDC)
- Stream DB changes via transaction log reader — zero impact on write path
- Tools: Debezium (Postgres/MySQL → Kafka), AWS DMS, Google Datastream
- Use cases: replicate to search index, sync to data warehouse, trigger downstream events
- Guarantees: at-least-once; consumers must be idempotent

### Polyglot persistence
- Use different DB engines per service based on access pattern:

| Access Pattern | Recommended Engine |
|---------------|-------------------|
| OLTP, relational queries | PostgreSQL |
| Full-text search, facets | Elasticsearch / OpenSearch |
| Session, cache, pub/sub, locks | Redis |
| Time-series metrics | TimescaleDB, InfluxDB |
| Document store, flexible schema | MongoDB |
| Graph queries | Neo4j, AWS Neptune |
| Column-oriented analytics | ClickHouse, BigQuery, Redshift |

### Multi-tenancy patterns

| Pattern | Isolation | Cost | Migration Risk |
|---------|-----------|------|---------------|
| Row-level security (RLS) | Low — shared schema | Low | Low |
| Schema per tenant | Medium — shared DB | Medium | Medium |
| Database per tenant | High — full isolation | High | High |

Choose by: regulatory requirements (HIPAA/SOC2 may require DB isolation), tenant count (>1000 tenants → RLS), and customer contractual guarantees.

### Soft delete
- Mark records `deleted_at IS NOT NULL` rather than `DELETE`
- All queries must filter `WHERE deleted_at IS NULL` — enforce with views or query builder default scope
- Enables audit trail and undo; prevents orphaned foreign keys

### Cross-references
- For event sourcing and CDC architecture: see `/event-driven` skill
- For schema design, normalization, indexes: see `database-schema-designer` skill

---

## Mode: Messaging

**Goal:** Choose the right communication pattern before choosing a technology.

### Decision tree: sync vs async

```
Does the caller need the result immediately to proceed?
  YES → synchronous (REST, gRPC)
  NO  → asynchronous (queue, stream, pub/sub)

Can the system tolerate eventual consistency?
  YES → async is preferred; simpler scaling, better fault isolation
  NO  → synchronous with distributed transaction (expensive) or saga with compensation
```

### Queue vs stream

| Criterion | Queue (SQS, RabbitMQ) | Stream (Kafka, Kinesis) |
|-----------|----------------------|------------------------|
| Message replay | No (visibility timeout) | Yes (configurable retention) |
| Multiple consumers | Fan-out via SNS/exchange | Consumer groups — each reads full stream |
| Ordering | No (FIFO queue adds per-group) | Yes, per partition/shard |
| Use case | Job queues, work distribution | Event sourcing, audit log, CDC, analytics |

### Pattern selection

| Pattern | When to Use |
|---------|-------------|
| Pub/sub (SNS+SQS, Pub/Sub) | Fan-out to multiple subscribers; fire-and-forget |
| Point-to-point queue | Single consumer processes each message; work queue |
| Event stream (Kafka) | Replay needed; multiple independent consumer groups; ordering matters |
| Webhooks | Third-party integration; push-based notification |
| Request/response (REST) | Caller needs result; simple CRUD |
| gRPC streaming | High-throughput internal; bidirectional |

### Cross-references
- For broker selection matrix, Kafka internals, outbox pattern: see `/event-driven` skill

---

## Mode: Migration

**Goal:** Safely migrate from legacy systems without big-bang rewrites.

### Strangler fig
1. Route all traffic through a facade (nginx, API gateway, or adapter layer)
2. Implement new behavior behind the facade; facade routes new paths to new service
3. Migrate existing paths one by one; legacy handles only unported routes
4. When all routes are ported, delete the legacy system

Anti-corruption layer: facade translates legacy data models to new domain models — prevents legacy concepts from leaking into the new design.

### Feature flags
- Decouple code deployment from feature activation
- Tools: LaunchDarkly, Unleash, Flipt (open source), custom Redis-backed
- Patterns:
  - **Kill switch:** disable broken feature without deploying
  - **Gradual rollout:** % of users see new behavior; ramp up as confidence grows
  - **A/B test gate:** route by user segment for experimentation
- Flags must have an expiry owner — orphaned flags are technical debt

### Saga pattern (for distributed transactions)
- When a business operation spans multiple services and must be atomic

**Choreography saga:**
- Each service reacts to events and emits its own; no central coordinator
- Compensation events undo prior steps on failure (e.g., `PaymentRefunded` compensates `PaymentCharged`)
- Lower coupling; harder to trace the full saga state

**Orchestration saga:**
- Central coordinator (Temporal, Conductor) tells each service what to do
- Easier to trace and debug; coordinator is a SPOF risk if not built for HA
- Preferred for complex flows with >3 steps

### Cross-references
- For deployment strategies (blue-green, canary, rolling): see `cicd-pipeline` skill

---

## Mode: Review

Invoke the `system-design-reviewer` agent to score the design against the full architecture checklist.

See `references/architecture-review-checklist.md` for the scored checklist used during review.

**Provide one of:**
- A design document or RFC (paste inline or provide file path)
- An ADR (Architecture Decision Record)
- A system description (components, data flows, external dependencies)

The agent will produce a scored report covering: resilience, scalability, data consistency, security, observability, and operational readiness.

---

## Pattern Quick Reference

| Pattern | Tier | Mode |
|---------|------|------|
| Timeout | 1 | resilience |
| Retry + backoff + jitter | 1 | resilience |
| Idempotency keys | 1 | resilience |
| Circuit breaker | 1 | resilience |
| Bulkhead | 2 | resilience |
| Dead letter queue | 2 | resilience |
| Graceful degradation | 2 | resilience |
| Horizontal scaling | 1 | scalability |
| Cache-aside | 1 | scalability |
| Read replicas | 1 | scalability |
| Connection pooling | 1 | scalability |
| Database sharding | 2 | scalability |
| CQRS | 2 | scalability |
| Materialized views | 2 | scalability |
| Database per service | 2 | data |
| CDC | 2 | data |
| Polyglot persistence | 2 | data |
| Multi-tenancy patterns | 2 | data |
| Sync vs async selection | 1 | messaging |
| Queue vs stream | 1 | messaging |
| Pub/sub | 1 | messaging |
| Strangler fig | 2 | migration |
| Feature flags | 2 | migration |
| Saga (choreography/orchestration) | 2 | migration |
| Outbox pattern | 1 | messaging/data |
| Event sourcing | 2 | data |
