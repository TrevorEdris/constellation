---
name: event-driven
description: "Use when designing event-driven systems -- choosing a broker (Kafka, SQS, Pub/Sub, RabbitMQ, NATS), producer/consumer patterns, the outbox pattern, delivery semantics, event schema versioning, or consumer groups."
context: fork
agent: system-design-reviewer
allowed-tools: Read, Grep, Glob
model: sonnet
argument-hint: "[broker-selection|kafka|outbox|schema|consumer-design]"
tags: [architecture]
---

# Event-Driven Architecture

Design and implement event-driven systems.

## When to Use

- Selecting a message broker for a new async communication requirement
- Designing Kafka topics, partitions, and consumer groups
- Implementing the outbox pattern to guarantee at-least-once delivery
- Versioning event schemas without breaking consumers
- Designing idempotent consumers that safely handle redelivery
- Understanding exactly-once vs at-least-once semantics and their tradeoffs

## Quick Reference: Modes

| Mode | Trigger | Covers |
|------|---------|--------|
| Broker selection | `/event-driven broker-selection` | Decision matrix: Kafka vs SQS vs Pub/Sub vs RabbitMQ vs NATS |
| Kafka deep-dive | `/event-driven kafka` | Partitions, consumer groups, offsets, ordering, transactions |
| Outbox pattern | `/event-driven outbox` | Postgres + relay, Debezium CDC relay, dual-write elimination |
| Schema versioning | `/event-driven schema` | Avro/Protobuf/JSON Schema, compatibility modes, schema registry |
| Consumer design | `/event-driven consumer-design` | Idempotency, DLQ, poison messages, at-least-once safety |

---

## Delivery Semantics

Understanding delivery guarantees is prerequisite to everything else.

| Guarantee | Meaning | Default In |
|-----------|---------|-----------|
| At-most-once | Message may be lost; never redelivered | NATS core, fire-and-forget |
| At-least-once | Message delivered one or more times; consumer must be idempotent | Kafka, SQS, RabbitMQ, Pub/Sub |
| Exactly-once | Delivered exactly once end-to-end | Kafka with transactions + idempotent producer; rare in practice |

**Default choice: at-least-once.** Design every consumer to be idempotent. Exactly-once has significant overhead and still requires idempotent consumers for correctness in most real systems.

---

## Broker Selection

Full decision matrix: see `references/broker-comparison.md`

### Summary decision tree

```
Need replay / event sourcing / CDC?
  YES → Kafka or Kinesis

Need simple job queue with no replay?
  YES → SQS (AWS) or RabbitMQ

Need fan-out to N subscribers?
  YES → SNS+SQS (AWS), Pub/Sub (GCP), Kafka with multiple consumer groups

Need ultra-low latency (<1ms)?
  YES → NATS core or Redis Streams

Need managed service with minimal ops?
  AWS  → SQS / SNS / Kinesis
  GCP  → Pub/Sub
  Azure → Service Bus
  Cloud-agnostic → Confluent (managed Kafka)

Already running Kafka?
  → Prefer Kafka for new topics; avoid adding another broker
```

---

## Kafka Deep-Dive

Full reference: see `references/kafka-patterns.md`

### Core concepts

**Topic:** named log of records. Immutable. Append-only. Configurable retention (time or size).

**Partition:** unit of parallelism and ordering. All records in a partition are ordered. Records across partitions are unordered. Partition count is hard to reduce — choose with expected peak throughput in mind (rule of thumb: 10-30 partitions per topic for most use cases).

**Partition key:** determines which partition a record lands in (hash of key mod partition count). Records with the same key always go to the same partition → ordering guarantee per entity.

**Consumer group:** a set of consumers that cooperate to consume a topic. Each partition is assigned to exactly one consumer in the group. Scale consumers by adding instances — up to `partition_count` instances can consume in parallel.

**Offset:** position of a record in a partition. Consumers commit offsets to track progress. Uncommitted offset → message redelivered on restart.

### Producer patterns

```
Idempotent producer (recommended for all):
  enable.idempotence = true
  acks = all
  → Exactly-once within a session; prevents duplicate records on retry

Transactional producer (for exactly-once across topics/consumer offsets):
  transactional.id = unique-per-producer-instance
  Use: consume-transform-produce pipelines (Kafka Streams)
  Cost: 10-20% throughput reduction; latency increase
```

### Consumer patterns

```
Commit strategy:
  Auto-commit (enable.auto.commit = true): simple; risk of message loss on crash
  Manual commit after processing: at-least-once; preferred for business-critical consumers
  Manual commit before processing: at-most-once; only for idempotent side effects OK to miss

Rebalance behavior:
  Cooperative sticky (default in recent clients): partitions incrementally transferred; no full stop
  Eager (legacy): all partitions revoked; all reassigned; causes processing pause
```

### Ordering guarantees

- Order guaranteed: within a single partition
- Order NOT guaranteed: across partitions
- To maintain per-entity order: use entity ID as partition key (e.g., `order_id`, `user_id`)
- To maintain global order: use a single partition (limits throughput to ~100MB/s per partition)

---

## Outbox Pattern

Full reference: see `references/outbox-pattern.md`

### The dual-write problem

Writing to a database AND publishing an event in two separate operations is unsafe:
- Write succeeds, publish fails → event lost
- Publish succeeds, write fails → phantom event
- No two-phase commit between DB and broker in modern systems

### Solution: transactional outbox

```sql
-- Same transaction as the business operation
BEGIN;
  INSERT INTO orders (id, user_id, total, status) VALUES ($1, $2, $3, 'pending');
  INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at)
    VALUES (gen_random_uuid(), 'Order', $1, 'OrderCreated', $4, NOW());
COMMIT;
```

A relay process then reads unpublished outbox rows and publishes them to the broker:

**Option A — Polling relay:**
- Background job polls `SELECT ... WHERE published_at IS NULL ORDER BY created_at`
- Marks published: `UPDATE outbox SET published_at = NOW() WHERE id = $1`
- Simple to implement; adds polling latency (typically 100ms-1s)
- Risk: relay crash between publish and mark → duplicate published; consumer must be idempotent

**Option B — Debezium CDC relay:**
- Debezium reads Postgres transaction log (WAL); emits outbox row inserts as Kafka events
- Zero polling latency; no additional DB load; sub-second delivery
- Requires: Debezium + Kafka Connect running; Postgres `wal_level = logical`
- Debezium outbox routing: route to topic based on `aggregate_type` field — built-in transformer

### Inbox pattern (idempotent consumption)

For consumers that must process each event exactly once:
```sql
-- Before processing, check inbox
SELECT EXISTS(SELECT 1 FROM inbox WHERE event_id = $1);
-- If not exists, process and insert in same transaction
BEGIN;
  -- business logic
  INSERT INTO inbox (event_id, processed_at) VALUES ($1, NOW());
COMMIT;
```

---

## Event Schema Versioning

Full reference: see `references/event-schema-versioning.md`

### Schema format comparison

| Format | Compatibility Enforcement | Schema Registry | Binary | Human-Readable |
|--------|--------------------------|-----------------|--------|----------------|
| Avro | Strong (registry required) | Yes (Confluent SR) | Yes | No |
| Protobuf | Strong (field numbers) | Optional | Yes | No |
| JSON Schema | Weak (advisory) | Optional | No | Yes |
| CloudEvents | Metadata standard; payload format separate | N/A | Per payload | Per payload |

**Recommendation:**
- High-throughput pipelines with Kafka: Avro + Confluent Schema Registry
- Cross-language / microservice: Protobuf
- Low-volume / simple: JSON Schema or CloudEvents envelope + JSON payload

### Compatibility modes

| Mode | Rule | Safe Change |
|------|------|-------------|
| Backward | New schema can read data written with old schema | Add optional field with default |
| Forward | Old schema can read data written with new schema | Remove optional field |
| Full | Both backward and forward | Only add/remove optional fields with defaults |

**Never make breaking changes:** removing required fields, renaming fields, changing field types.

### Minimum required event envelope

```json
{
  "specversion": "1.0",
  "id": "01HX5RNKJ3...",
  "source": "/services/order-service",
  "type": "com.example.orders.OrderCreated",
  "time": "2024-01-15T10:30:00Z",
  "datacontenttype": "application/json",
  "dataschemaversion": "2",
  "data": { }
}
```

Required fields: `id` (deduplicate), `source` (trace origin), `type` (consumer routing), `time` (temporal ordering).

---

## Consumer Design

Full reference: see `references/consumer-design.md`

### Idempotency patterns

A consumer is idempotent when processing the same message twice produces the same outcome.

**Approach 1 — Natural idempotency (best):**
- The operation itself is inherently idempotent: `INSERT ... ON CONFLICT DO NOTHING`, `UPDATE ... SET status = 'active' WHERE id = $1`
- No extra infrastructure needed

**Approach 2 — Deduplication table (inbox pattern):**
- Store processed event IDs in an inbox table
- Check before processing; reject already-seen IDs
- TTL the table based on broker redelivery window

**Approach 3 — Idempotency key forwarded to downstream:**
- Consumer passes `event_id` as idempotency key to downstream APIs
- Downstream stores key → result mapping

### Dead letter queue (DLQ) design

Every consumer must have a DLQ. Without it, a poison message blocks the queue/partition indefinitely.

```
Consumer retry policy:
  Attempt 1 → process
  Attempt 2 → process (after 1s delay)
  Attempt 3 → process (after 5s delay)
  Attempt N (max) → move to DLQ + emit metric + alert

DLQ content: original message + error details + attempt count + timestamps
DLQ monitoring: alert if DLQ depth > 0 (or > threshold for noisy systems)
DLQ remediation: fix the consumer, then replay from DLQ
```

### No business logic in message handler

```
Handler (entry point)
  → deserialize + validate envelope
  → extract domain event
  → call service.HandleOrderCreated(ctx, event)  ← business logic lives here
  → commit offset / ack message
```

Handler functions should be thin. Business logic in the handler makes unit testing impossible without broker infrastructure.

### Consumer group naming convention

```
{service-name}-{topic-name}-consumer

Examples:
  inventory-service-orders-consumer
  analytics-service-payments-consumer
  notification-service-user-events-consumer
```

Consistent naming enables: per-consumer group monitoring, lag alerting, and audit trails.

### Partition assignment and lag

- Monitor consumer lag (messages behind) per consumer group per partition
- Alert threshold: lag > X * average_processing_time_per_message (e.g., 1000 messages for a 10ms consumer → alert at 10s of lag)
- Kafka lag: `kafka-consumer-groups.sh --describe` or Prometheus JMX exporter metric `kafka_consumer_group_lag`
