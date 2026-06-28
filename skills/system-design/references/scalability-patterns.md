# Scalability Patterns Reference

Detailed guidance on scaling distributed systems — choosing the right layer and pattern for the actual bottleneck.

---

## Horizontal Scaling

### Prerequisites

A service can scale horizontally only if it is stateless:

| Concern | Stateless Solution |
|---------|-------------------|
| HTTP sessions | Redis or JWT (server verifies signature) |
| Uploaded files | Object storage (S3, GCS, Azure Blob) |
| In-process cache | Externalize to Redis (consistency across instances) |
| Scheduled jobs | Distributed lock or single-leader election |
| WebSocket connections | Sticky sessions at load balancer OR pub/sub fan-out for state sync |

### Load balancer health checks

- `/livez` — process is alive (simple 200 return; no dependency checks)
- `/readyz` — ready for traffic (checks required dependencies: DB, cache, etc.)
- Load balancer must use `/readyz` to avoid sending traffic to an instance mid-startup or mid-graceful-shutdown
- Grace period on startup: `initialDelaySeconds` in Kubernetes readiness probe prevents traffic before dependencies are ready

### Auto-scaling rules

Prefer scaling on business metrics over infrastructure metrics:

| Metric | Why |
|--------|-----|
| Request queue depth | Reflects actual user impact |
| Response time p99 | SLA-aligned |
| CPU > 70% sustained | Infrastructure fallback if business metric unavailable |

Avoid scaling on average CPU — average hides hotspots and introduces lag.

---

## Caching Strategies

Full reference in `performance-optimization` skill → `references/CACHING_STRATEGIES.md`.

### Cache selection guide

| Cache Layer | Technology | When to Use |
|------------|------------|-------------|
| In-process (per instance) | Caffeine (JVM), go-cache, functools.lru_cache (Python) | Ultra-hot, read-only lookup tables; config data; no cross-instance consistency needed |
| Distributed shared | Redis | Session data, computed results, locks, rate limiting counters; shared across instances |
| HTTP response | Varnish, nginx proxy_cache | Public API responses; static-ish content behind an API gateway |
| CDN edge | CloudFront, Fastly, Cloudflare | Public HTTP responses; geographic distribution; static assets |

### Cache-aside implementation checklist

- [ ] TTL is set — no infinite TTL
- [ ] TTL reflects acceptable staleness window, not an arbitrary number
- [ ] Cache key includes all dimensions that differentiate the result (`tenant_id`, `user_id`, `locale`, etc.)
- [ ] Cache miss path has a stampede guard (probabilistic early expiry or distributed lock on miss)
- [ ] Cache invalidation has an owner — who calls `DEL key` when source data changes?
- [ ] Circuit breaker wraps cache reads — cache unavailability must not cause full service outage

### Redis Cluster considerations

- Cluster mode distributes keys across 16,384 hash slots across N primary nodes
- Multi-key commands (`MGET`, `MSET`, pipeline) only work within a single hash slot
- Use hash tags `{entity_id}` to co-locate related keys: `{user:123}:session`, `{user:123}:preferences`
- Cluster requires client-side awareness (Cluster-aware client libraries required)
- Memory limits: always set `maxmemory` and `maxmemory-policy` (eviction policy) — `allkeys-lru` is the safe default

---

## Read Replicas

### When to use

- Read traffic is 80%+ of total (analytics dashboards, reporting, search)
- Write traffic to primary is within acceptable limits; reads are the bottleneck
- Query latency on primary is degrading due to read load

### Read-your-own-writes problem

After a write, a subsequent read from a replica may not see the write yet (replica lag).

Solutions:
1. **Session consistency:** route reads to primary for N seconds after a write (per user, per session)
2. **Read from primary for critical paths:** immediately after write, read from primary
3. **Monotonic reads:** route all reads for a session to the same replica (still lagged, but consistent within session)
4. **Accept eventual consistency:** inform the user ("your change may take a moment to appear")

### Replica lag monitoring

```
Postgres: SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds;
```

Alert if lag > acceptable staleness window (typically 30s–5min depending on use case).

---

## Database Sharding

### When to consider

- Single database instance is at CPU, I/O, or storage capacity ceiling
- Read replicas added but write throughput is the bottleneck
- Table sizes exceed ~500GB and query performance is degrading despite indexing

### Shard key selection — the most important decision

Properties of a good shard key:
- **High cardinality:** many distinct values → even distribution
- **Query alignment:** most queries filter by this key (avoids scatter-gather)
- **Immutable:** shard key changes require migrating the row to a different shard — extremely expensive

| Use Case | Good Shard Key | Bad Shard Key |
|----------|---------------|---------------|
| Multi-tenant SaaS | `tenant_id` | `created_at` (time hotspot) |
| Social platform | `user_id` | `post_type` (low cardinality) |
| E-commerce | `order_id` (hash) | `status` (low cardinality) |
| IoT | `device_id` | `timestamp` (time hotspot) |

### Cross-shard queries

Cross-shard queries (queries that must scan multiple shards) are expensive:
- Avoid or minimize in hot paths
- Acceptable for async reporting/analytics
- Solution: maintain a fan-out index on a dedicated aggregation database

### Sharding libraries/middleware

| Tool | Language | Notes |
|------|----------|-------|
| Vitess | Any (MySQL) | YouTube's sharding layer; complex ops |
| Citus | Postgres | Extension to Postgres; transparent sharding |
| PlanetScale | MySQL | Managed Vitess |
| Custom | Any | Route by hash at application layer; simplest ops |

---

## CQRS

### Core principle

Separate the write model (commands, normalized, transactionally consistent) from the read model (queries, denormalized, optimized for access pattern).

CQRS does NOT require:
- Event sourcing (though they pair well)
- Separate databases (a read replica or materialized view satisfies CQRS)
- Eventual consistency (synchronous CQRS with a view updated in the same transaction is valid)

### When to use

- Read and write access patterns are fundamentally incompatible
  - Write: highly normalized, validated, consistent
  - Read: aggregated, joined, flattened for display
- Read-heavy system where write-optimized schema cannot satisfy query performance
- Building a reporting/analytics layer separate from OLTP

### Implementation levels (simplest to most complex)

1. **Read replica:** physical separation of read/write; same schema; eventual consistency via replication lag
2. **Materialized view:** pre-computed read model updated on write or on schedule; same database
3. **Separate read store:** write to primary DB; async update to Elasticsearch/Redis/denormalized table
4. **Event-sourced CQRS:** events are the source of truth; read models built by projecting events

### Eventual consistency with CQRS

When the read model is updated asynchronously, the system is eventually consistent. Make this explicit to users:
- "Your change has been saved" (write confirmed)
- "Updated content will appear shortly" (read model may lag)

---

## Materialized Views

### Postgres implementation

```sql
-- Create
CREATE MATERIALIZED VIEW order_summary AS
  SELECT user_id, COUNT(*) as order_count, SUM(total) as lifetime_value
  FROM orders
  WHERE status = 'completed'
  GROUP BY user_id;

CREATE UNIQUE INDEX ON order_summary (user_id);

-- Refresh (CONCURRENTLY allows reads during refresh)
REFRESH MATERIALIZED VIEW CONCURRENTLY order_summary;
```

### Refresh strategies

| Strategy | Lag | Write Overhead | Complexity |
|----------|-----|---------------|------------|
| Scheduled (cron every N min) | Configurable | None | Low |
| Trigger-based (on INSERT/UPDATE/DELETE) | Near-zero | High (per-row) | Medium |
| Debezium + stream processor | Sub-second | External infra | High |

### When NOT to use

- Source data changes every second and low lag is required → use a live query or event-driven read model
- Refresh duration exceeds acceptable downtime (even CONCURRENTLY can be slow on large tables)
- Storage cost is prohibitive (materialized view duplicates data)

---

## Fan-Out Patterns

### Fan-out on write (push model)

Pre-compute delivered content per consumer at write time.

- Twitter timeline: when a user tweets, write the tweet ID to each follower's timeline table
- Read is O(1): read from pre-built timeline
- Write is O(followers): expensive for celebrities with millions of followers
- Solution: hybrid — fan-out on write for normal users; celebrity tweets fetched at read time

### Fan-out on read (pull model)

Aggregate content from all sources at read time.

- Simple to implement; no pre-computation
- Read is O(sources): expensive for users following many accounts
- Works well at low-to-medium scale

### Decision

```
Read:write ratio high, write load manageable → fan-out on write
Write:read ratio high, or celebrity/high-follower users exist → fan-out on read or hybrid
```
