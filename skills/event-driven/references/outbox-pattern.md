# Outbox Pattern Reference

Implementation guide for guaranteeing at-least-once event delivery without dual-write risk.

---

## The Dual-Write Problem

When a service writes to a database AND publishes an event, two separate operations occur. Neither is atomic with the other.

**Failure scenarios:**

```
Scenario 1: DB write succeeds, event publish fails
  Result: State is updated, event is lost. Downstream consumers never see the change.

Scenario 2: Event published, DB write fails
  Result: Phantom event exists. Consumers act on a state change that was rolled back.

Scenario 3: Process crashes between write and publish
  Result: Same as scenario 1.
```

No two-phase commit exists between a relational database and a message broker in modern distributed systems.

**The solution:** write the event to the database in the same transaction as the business operation. A separate relay process then publishes events from the database to the broker.

---

## Outbox Table Schema

```sql
CREATE TABLE outbox (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    aggregate_type  TEXT NOT NULL,    -- Domain entity (e.g., 'Order', 'Payment')
    aggregate_id    TEXT NOT NULL,    -- Entity identifier
    event_type      TEXT NOT NULL,    -- Event name (e.g., 'OrderCreated', 'PaymentCharged')
    payload         JSONB NOT NULL,   -- Event payload
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,      -- NULL = unpublished; set by relay on publish
    metadata        JSONB             -- Optional: trace_id, correlation_id, schema_version
);

-- Index for relay polling
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;
```

---

## Writing to the Outbox

The outbox INSERT must be in the same database transaction as the business operation.

```go
// Go example
func (s *OrderService) CreateOrder(ctx context.Context, req CreateOrderRequest) (*Order, error) {
    return s.db.WithTx(ctx, func(tx *sqlx.Tx) error {
        // Business operation
        order, err := insertOrder(ctx, tx, req)
        if err != nil {
            return err
        }

        // Outbox INSERT — same transaction
        payload, _ := json.Marshal(OrderCreatedEvent{
            OrderID:    order.ID,
            UserID:     order.UserID,
            Total:      order.Total,
            OccurredAt: time.Now().UTC(),
        })

        _, err = tx.ExecContext(ctx, `
            INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload, metadata)
            VALUES ($1, $2, $3, $4, $5)`,
            "Order", order.ID.String(), "OrderCreated", payload,
            json.RawMessage(`{"schema_version": "1", "trace_id": "`+traceID(ctx)+`"}`),
        )
        return err
    })
}
```

---

## Option A: Polling Relay

A background goroutine/thread polls the outbox table for unpublished rows and publishes them.

### Implementation

```go
func (r *OutboxRelay) Run(ctx context.Context) {
    ticker := time.NewTicker(100 * time.Millisecond)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if err := r.publishBatch(ctx); err != nil {
                log.Error("outbox relay batch failed", "error", err)
            }
        }
    }
}

func (r *OutboxRelay) publishBatch(ctx context.Context) error {
    // Fetch batch of unpublished events
    rows, err := r.db.QueryContext(ctx, `
        SELECT id, aggregate_type, aggregate_id, event_type, payload, metadata
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`, batchSize)
    if err != nil {
        return err
    }
    defer rows.Close()

    for rows.Next() {
        var event OutboxEvent
        if err := rows.Scan(&event.ID, &event.AggregateType, &event.AggregateID,
            &event.EventType, &event.Payload, &event.Metadata); err != nil {
            return err
        }

        topic := topicFor(event.AggregateType)
        if err := r.broker.Publish(ctx, topic, event.AggregateID, event.Payload); err != nil {
            return err  // retry on next tick
        }

        // Mark published after successful broker delivery
        if _, err := r.db.ExecContext(ctx,
            `UPDATE outbox SET published_at = NOW() WHERE id = $1`, event.ID); err != nil {
            // Broker received it but mark failed → duplicate on next poll → consumer must be idempotent
            return err
        }
    }
    return nil
}
```

### Key design decisions

**`FOR UPDATE SKIP LOCKED`:** prevents multiple relay instances from processing the same row. Multiple relay instances can run in parallel without coordination.

**Publish-then-mark vs mark-then-publish:**
- Publish first, then mark published: if mark fails, message is re-published → duplicate → consumer must be idempotent (preferred)
- Mark first, then publish: if publish fails, message is lost → data loss (never do this)

**Polling interval:** 100ms is a reasonable default. For higher throughput, reduce to 10ms. For batch systems, increase to 1s or more.

**Batch size:** 100-1000 rows per batch. Too small = high DB overhead; too large = long transaction holds.

**Cleanup:** archive or delete published rows after a retention window:
```sql
DELETE FROM outbox WHERE published_at < NOW() - INTERVAL '7 days';
```

---

## Option B: Debezium CDC Relay

Debezium reads the Postgres WAL (Write-Ahead Log) and emits outbox table INSERT events directly to Kafka. No polling loop; no additional DB queries.

### Architecture

```
Application → DB transaction (orders + outbox rows) → Postgres WAL
                                                            ↓
                                        Debezium reads WAL via logical replication
                                                            ↓
                                    Debezium Outbox Event Router (transforms + routes)
                                                            ↓
                                    Kafka topic (per aggregate_type or event_type)
```

### Postgres prerequisites

```sql
-- postgresql.conf: must be 'logical' (requires restart)
wal_level = logical

-- Create replication slot for Debezium
SELECT pg_create_logical_replication_slot('debezium_slot', 'pgoutput');

-- Create publication
CREATE PUBLICATION debezium_pub FOR TABLE outbox;

-- Debezium user permissions
GRANT REPLICATION SLAVE ON *.* TO debezium_user;
GRANT SELECT ON outbox TO debezium_user;
```

### Debezium connector config with Outbox Event Router

```json
{
  "name": "outbox-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "postgres",
    "database.port": "5432",
    "database.user": "debezium",
    "database.dbname": "myapp",
    "topic.prefix": "myapp",
    "table.include.list": "public.outbox",
    "plugin.name": "pgoutput",
    "publication.name": "debezium_pub",
    "slot.name": "debezium_slot",

    "transforms": "outbox",
    "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
    "transforms.outbox.table.field.event.id": "id",
    "transforms.outbox.table.field.event.key": "aggregate_id",
    "transforms.outbox.table.field.event.payload": "payload",
    "transforms.outbox.table.field.event.type": "event_type",
    "transforms.outbox.route.by.field": "aggregate_type",
    "transforms.outbox.route.topic.replacement": "outbox.${routedByValue}"
  }
}
```

This routes each outbox row to a topic named `outbox.{aggregate_type}`:
- `Order` rows → `outbox.Order` topic
- `Payment` rows → `outbox.Payment` topic

### Debezium advantages over polling relay

- Zero additional DB queries — WAL is written regardless; reading it adds no write overhead
- Sub-second delivery — Debezium emits events within milliseconds of the WAL being written
- Exactly-once event publication from DB — Debezium deduplicates via LSN (log sequence number)
- No application code needed beyond the outbox INSERT

### Debezium operational concerns

- WAL slot accumulation: if Debezium falls behind, Postgres holds WAL segments — monitor replication slot lag
  ```sql
  SELECT slot_name, pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
  FROM pg_replication_slots;
  ```
  Alert if lag_bytes > 500MB; set `max_slot_wal_keep_size` in Postgres 13+ to prevent unbounded growth
- Schema changes: adding/removing columns from the outbox table requires connector restart or reconfiguration
- Connector restart: Debezium resumes from the last committed offset on restart; at-least-once guarantee

---

## Comparing the Two Approaches

| | Polling Relay | Debezium CDC |
|--|--------------|-------------|
| Implementation complexity | Low (application code) | Medium (Kafka Connect setup) |
| Delivery latency | 100ms–1s (polling interval) | Sub-second |
| Additional DB load | Yes (polling queries) | Minimal (WAL read) |
| Infrastructure requirements | Application + DB | Kafka + Kafka Connect + Debezium |
| At-least-once guarantee | Yes | Yes |
| Operational complexity | Low | Medium |
| **Choose when** | Small team; simple stack; < 10K events/day | Large scale; low latency needed; Kafka already running |

---

## Inbox Pattern (Consumer-Side Deduplication)

The outbox guarantees at-least-once delivery. Consumers must handle duplicates. The inbox pattern provides idempotent consumption at the database level.

```sql
CREATE TABLE inbox (
    event_id    UUID PRIMARY KEY,
    topic       TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);
```

```go
func (c *Consumer) Handle(ctx context.Context, event Event) error {
    return c.db.WithTx(ctx, func(tx *sqlx.Tx) error {
        // Check if already processed
        var exists bool
        err := tx.QueryRowContext(ctx,
            `SELECT EXISTS(SELECT 1 FROM inbox WHERE event_id = $1)`, event.ID).Scan(&exists)
        if err != nil {
            return err
        }
        if exists {
            return nil  // already processed; skip
        }

        // Process the event
        if err := c.service.HandleOrderCreated(ctx, tx, event); err != nil {
            return err
        }

        // Record in inbox — same transaction
        _, err = tx.ExecContext(ctx,
            `INSERT INTO inbox (event_id, topic, expires_at) VALUES ($1, $2, $3)`,
            event.ID, event.Topic, time.Now().Add(7*24*time.Hour))
        return err
    })
}
```

Clean up expired inbox entries periodically:
```sql
DELETE FROM inbox WHERE expires_at < NOW();
```
