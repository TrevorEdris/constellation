# Data Patterns Reference

Guidance on data ownership, replication, and persistence strategy decisions in distributed systems.

---

## Database per Service

### Benefits

- Schema changes in one service don't break others
- Each service can choose the best storage engine for its access pattern (polyglot persistence)
- Independent scaling: database of the order service can be sized independently of the user service
- Independent evolution: services can be deployed and migrated on their own schedule

### Costs and mitigations

| Cost | Mitigation |
|------|-----------|
| Cross-service joins are impossible | API composition at the application layer; or maintain a denormalized read model |
| Referential integrity across services is not enforced by DB | Enforce via application logic + saga compensation on failure |
| Reporting queries that span multiple services are complex | Dedicated read store aggregated from multiple services via CDC or events |
| More infrastructure to operate | Managed cloud databases; Kubernetes operators |

### When NOT to use

- Small monolith where the complexity overhead outweighs the benefits
- Team size < 5: the coordination overhead of distributed data exceeds the gain
- Regulatory requirements mandate a single audit database

### API composition for cross-service reads

When Service A needs data from Service B's schema:
1. Service A calls Service B's API to fetch the needed data
2. Service A composes the response in the application layer
3. No direct DB access across service boundaries

For performance-critical paths: maintain a local denormalized read model updated via events.

---

## Change Data Capture (CDC)

### How it works

CDC reads the database transaction log (WAL for Postgres, binlog for MySQL) rather than polling tables. This provides:
- Near-zero impact on the write path (log is written anyway)
- Ordered, complete stream of all changes
- Sub-second latency from write to event publication

### Debezium setup (Postgres → Kafka)

**Requirements:**
- `wal_level = logical` in `postgresql.conf`
- Replication slot created for Debezium
- Debezium connector deployed in Kafka Connect

**Postgres configuration:**
```sql
-- Check current wal_level (requires restart to change)
SHOW wal_level;  -- must be 'logical'

-- Create publication for tables to capture
CREATE PUBLICATION debezium_pub FOR TABLE orders, payments, users;
```

**Connector config:**
```json
{
  "name": "postgres-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.dbname": "orders",
    "topic.prefix": "myapp",
    "table.include.list": "public.orders,public.payments",
    "plugin.name": "pgoutput",
    "publication.name": "debezium_pub",
    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter"
  }
}
```

### Use cases

| Use Case | Description |
|----------|-------------|
| Search index sync | Sync Postgres rows to Elasticsearch on every write |
| Data warehouse ingestion | Stream OLTP changes to BigQuery/Redshift for analytics |
| Outbox relay | Debezium reads outbox table rows → publishes events to Kafka |
| Cache invalidation | Invalidate Redis entries when source DB row changes |
| Cross-service sync | Replicate data into a read model owned by another service |
| Audit log | Capture all row changes with before/after values |

### Operational concerns

- Replication slots accumulate WAL if the consumer falls behind — monitor slot lag
- WAL accumulation can exhaust disk space — set `max_slot_wal_keep_size` in Postgres 13+
- Schema changes to captured tables require connector reconfiguration
- Debezium provides at-least-once delivery — consumers must be idempotent

---

## Polyglot Persistence

### Technology selection matrix

| Data Type | Access Pattern | Recommended Engine |
|-----------|---------------|-------------------|
| Relational / OLTP | ACID transactions, joins, referential integrity | PostgreSQL, MySQL |
| Full-text search | Relevance ranking, facets, autocomplete | Elasticsearch, OpenSearch, Typesense |
| Session / cache | Key-value, sub-millisecond, volatile | Redis |
| Time-series | Time-range queries, downsampling, retention | TimescaleDB (Postgres ext.), InfluxDB, Victoria Metrics |
| Document | Flexible schema, nested structures, sparse attributes | MongoDB, Firestore, DynamoDB |
| Graph | Relationship traversal, pathfinding | Neo4j, AWS Neptune, Memgraph |
| Wide-column | High write throughput, time-ordered partitioning, large scale | Apache Cassandra, ScyllaDB |
| Analytics / OLAP | Column-oriented, aggregation, huge datasets | ClickHouse, BigQuery, Redshift, DuckDB |
| Object / blob | Large files, media, backups | AWS S3, GCS, Azure Blob |

### Decision guide

```
Does the data have strict relational integrity requirements?
  YES → PostgreSQL

Do you need full-text search with relevance ranking?
  YES → Elasticsearch / OpenSearch (alongside primary DB)

Is the data access pattern primarily time-series?
  YES → TimescaleDB if already on Postgres; InfluxDB for dedicated time-series

Is the read:write ratio very high and data is key-value shaped?
  YES → Redis (cache) or DynamoDB (durable)

Do you need to traverse relationships between entities (e.g., social graph, fraud detection)?
  YES → Graph DB

Is the primary use case analytical (aggregations over large datasets)?
  YES → ClickHouse, BigQuery, or Redshift
```

### Anti-patterns

- **Polyglot creep:** adding new databases without evaluating whether the existing engine can satisfy the access pattern (Postgres can handle many workloads)
- **Cargo cult:** choosing MongoDB because it's "flexible" without a schema problem that justifies the operational overhead
- **Elasticsearch as primary store:** Elasticsearch is eventually consistent and lacks transactions; it is a read store, not a write store

---

## Multi-Tenancy Patterns

### Row-level security (RLS)

Single database, single schema, all tenants share tables. `tenant_id` column on every table. Row-level security enforced at the DB or application layer.

```sql
-- Postgres RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Set per-request
SET LOCAL app.tenant_id = '123e4567-e89b-12d3-a456-426614174000';
```

**When to use:** low per-tenant data volume; >100 tenants; operational simplicity is priority; no contractual data isolation requirement.

**Risks:**
- Missing `tenant_id` on a query leaks cross-tenant data — must be enforced at every query
- A slow tenant query affects other tenants (noisy neighbor)
- Schema changes affect all tenants simultaneously

### Schema per tenant

Single database, separate schema per tenant. Tables named `tenant_123.orders`, `tenant_456.orders`.

**When to use:** medium number of tenants (10–1000); some isolation needed; independent schema migration per tenant.

**Risks:**
- Schema migrations must be applied per-tenant (tooling required: Flyway with multi-schema support, Liquibase, custom scripts)
- Connection overhead: connection pooling must be schema-aware
- 1000 schemas with 50 tables = 50,000 tables — Postgres can handle this but monitoring becomes complex

### Database per tenant

Separate database instance per tenant. Full isolation at the infrastructure level.

**When to use:** enterprise/regulated SaaS (HIPAA, SOC2 Type II); contractual data isolation; per-tenant backup/restore required; tenants need custom schema extensions.

**Costs:**
- High infrastructure cost
- N databases to monitor, upgrade, and maintain
- Connection pooling must be across databases (PgBouncer per-tenant or connection pooler per tenant group)

### Hybrid approaches

Common in practice:
- Small/free tenants: RLS (shared schema)
- Enterprise tenants: dedicated database or schema

Route based on tenant tier at the application layer. Tenant provisioning creates appropriate resources.

---

## Event Sourcing

### What it is

Instead of storing the current state of an entity, store the ordered sequence of events that produced that state.

```
Event log (append-only):
  OrderCreated   {order_id: 1, user_id: 42, total: 99.99}
  PaymentCharged {order_id: 1, amount: 99.99, idempotency_key: "abc"}
  OrderShipped   {order_id: 1, tracking: "1Z999AA1"}
  OrderDelivered {order_id: 1, delivered_at: "2024-01-16T14:00:00Z"}

Current state = reduce(events, initialState, applyEvent)
```

### Benefits

- Complete audit log for free — every state change is recorded
- Time travel: replay events to any point in time
- Rebuild read models: new projections can be built by replaying the full event log
- Debugging: "how did the order end up in this state?" is fully answerable

### Costs

- Query current state requires replaying events (mitigated by snapshots)
- Schema evolution of events is non-trivial (cannot mutate past events)
- Higher read latency if not using materialized read models
- Concept is unfamiliar to developers accustomed to CRUD

### When to use

- Audit trail is a requirement (financial, healthcare, compliance)
- Multiple different read models need to be built from the same data
- Undo/replay functionality is required
- Domain events are first-class business concepts

### When NOT to use

- Simple CRUD application with no audit or replay requirements
- Team lacks experience with the pattern — high risk of over-engineering
- Event schema is highly volatile — event evolution becomes painful

### Snapshots

For entities with long event histories, snapshot the state at a point in time:
```
Snapshot at event 1000: {status: "shipped", total: 99.99, ...}
Replay: load snapshot + events 1001 onwards
```

Snapshotting strategy: after N events, or on an entity reaching a terminal state.

---

## Soft Delete

### Implementation

```sql
-- Schema
ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMPTZ;

-- Soft delete
UPDATE orders SET deleted_at = NOW() WHERE id = $1;

-- Filter all queries (enforce via view or ORM default scope)
SELECT * FROM orders WHERE deleted_at IS NULL;
```

### Enforcement options

**Postgres view (recommended):**
```sql
CREATE VIEW active_orders AS
  SELECT * FROM orders WHERE deleted_at IS NULL;
-- All application queries use active_orders, not orders directly
```

**ORM default scope:**
- Rails: `default_scope { where(deleted_at: nil) }`
- GORM: soft delete built-in with `gorm:"softDelete"`
- SQLAlchemy: filter_by in mixin

### Risks

- Index bloat: soft-deleted rows remain in indexes
  - Partial index: `CREATE INDEX ON orders (user_id) WHERE deleted_at IS NULL`
- Storage growth: soft-deleted rows accumulate
  - Hard delete after retention period: `DELETE FROM orders WHERE deleted_at < NOW() - INTERVAL '90 days'`
- Unique constraint violation: deleted row with same unique key blocks recreation
  - Solution: include `deleted_at` in unique constraint, or set a tombstone UUID on delete
