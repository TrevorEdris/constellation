# Event Broker Comparison

Full decision matrix for selecting a message broker or event streaming platform.

---

## Decision Matrix

| Broker | Delivery | Ordering | Replay | Fan-out | Managed Option | Best For |
|--------|----------|----------|--------|---------|---------------|----------|
| **Apache Kafka** | At-least-once (exactly-once with transactions) | Per-partition | Yes, configurable retention | Yes, via consumer groups | Confluent Cloud, MSK | High-throughput pipelines, event sourcing, CDC, audit log |
| **AWS SQS** | At-least-once | No (FIFO queue: per-message-group) | No | No (use SNS fan-out) | Yes (fully managed) | Simple job queues, decoupled services, serverless |
| **AWS SNS + SQS** | At-least-once | No | No | Yes (SNS → N SQS queues) | Yes (fully managed) | Fan-out to multiple consumers in AWS |
| **AWS Kinesis** | At-least-once | Per-shard | Yes, 7-day default (extendable) | Yes, via fan-out consumers | Yes (fully managed) | Streaming analytics, IoT, log aggregation |
| **Google Pub/Sub** | At-least-once | No (ordering keys: per-key) | Limited (subscription snapshot) | Yes, native | Yes (fully managed) | GCP-native fan-out, mobile pushes, flexible consumers |
| **Azure Service Bus** | At-least-once (sessions: per-session) | Per-session | No | Via topics + subscriptions | Yes (fully managed) | .NET ecosystem, enterprise messaging, workflows |
| **RabbitMQ** | At-least-once | Per-queue | No (DLQ only) | Yes, fanout exchange | CloudAMQP, RabbitMQ on Azure | Work queues, RPC patterns, flexible routing, low latency |
| **NATS / JetStream** | At-most-once (core) / At-least-once (JetStream) | Per-stream (JetStream) | JetStream yes | Yes, subjects + wildcards | Synadia Cloud | Ultra-low latency, IoT/edge, cloud-native, microservices |
| **Redis Streams** | At-least-once (consumer groups) | Append-only per stream | Yes (until eviction) | Yes, multiple consumer groups | Redis Cloud, ElastiCache | Lightweight streaming, within-Redis infrastructure, activity feeds |

---

## Kafka

### When Kafka is the right choice

- Event sourcing: immutable append-only log is core to Kafka's model
- Replay needed: rewind any consumer group to re-process events from any point
- Multiple independent consumer groups from one topic: each group reads the full stream independently
- CDC (Change Data Capture): Debezium → Kafka is the standard stack
- High throughput: millions of messages/second per cluster with horizontal scaling
- Audit log: retention-based log with configurable TTL (days to forever)

### When Kafka is the wrong choice

- You only need a simple job queue with no replay: SQS/RabbitMQ is simpler and cheaper to operate
- Team lacks Kafka operational experience: significant ops overhead (broker management, partition rebalancing, schema registry, monitoring)
- Very low message volume (< 1,000/day): Kafka cluster cost is not justified
- Latency requirements < 1ms: Kafka latency is ~5-15ms per message; use NATS/Redis for sub-ms

### Kafka vs Kinesis

| | Kafka | Kinesis |
|--|-------|---------|
| Throughput per partition | ~1MB/s | ~1MB/s per shard |
| Retention | Configurable (days to forever) | 7-24 hours default, up to 365 days (extended retention, additional cost) |
| Consumer model | Pull (consumer group offset) | Pull (shard iterator) or push (enhanced fan-out) |
| Partition management | Manual (set at topic creation; hard to reduce) | Manual (shard split/merge via API) |
| Exactly-once | Yes (with transactions) | No |
| Cloud lock-in | No | AWS only |
| Operational burden | High (self-hosted) / Low (Confluent) | None (fully managed) |
| Cost at scale | Confluent cost predictable; self-hosted = server cost | Shard-hour + data volume pricing; can be expensive at high throughput |

Choose Kinesis if: AWS-native, no cross-cloud requirement, simple ops is priority.
Choose Kafka if: cross-cloud, exactly-once needed, event sourcing, operational experience available.

---

## SQS

### SQS Standard vs FIFO

| | Standard | FIFO |
|--|---------|------|
| Ordering | Best-effort | Strict per message group |
| Throughput | Unlimited | 300 TPS (3,000 with batching) |
| Deduplication | No | Yes (5-minute window) |
| Cost | Lower | Higher |
| Use when | Order doesn't matter; high volume | Order matters; lower volume; dedup needed |

### SQS + SNS fan-out

The standard AWS fan-out pattern:
```
Publisher → SNS Topic → SQS Queue 1 (email-service)
                      → SQS Queue 2 (inventory-service)
                      → SQS Queue 3 (analytics-service)
```

Each SQS queue has independent: retry policy, DLQ, consumer group scaling, visibility timeout.

### SQS operational notes

- `VisibilityTimeout`: must be > max consumer processing time; too short → duplicate processing
- `MessageRetentionPeriod`: up to 14 days; default 4 days
- `ReceiveMessageWaitTimeSeconds = 20` for long polling (reduces API calls and cost vs short polling)
- SQS does not support push — consumers must poll. For near-real-time Lambda triggers, use SQS event source mapping.

---

## Google Pub/Sub

### Key characteristics

- Serverless: no capacity planning; scales automatically
- At-least-once delivery; ordering guaranteed only with ordering keys
- Message retention: up to 31 days per subscription
- Push subscriptions: Pub/Sub pushes to a webhook endpoint (no consumer polling needed)
- Exactly-once processing: available in regions supporting it via subscription-level exactly-once delivery

### When to use

- GCP-native stack; no multi-cloud requirement
- Need push-based delivery to HTTP endpoints (push subscriptions)
- Need to fan out to mobile devices (Firebase Cloud Messaging backed by Pub/Sub)
- Event ingestion at variable scale with no capacity management

### Pub/Sub vs Kafka on GCP

Pub/Sub: fully managed, no ops, no partition management, push delivery available, limited replay.
Confluent/Kafka on GCP: full Kafka semantics, event sourcing, unlimited replay, consumer group control — at the cost of Confluent pricing.

---

## RabbitMQ

### Exchange types

| Type | Routing Logic | Use Case |
|------|--------------|---------|
| Direct | Exact routing key | Point-to-point; specific consumer |
| Topic | Wildcard pattern (`orders.*`, `*.created`) | Event routing by type/category |
| Fanout | All bound queues receive every message | Broadcast; pub/sub |
| Headers | Message headers | Complex attribute-based routing |

### When RabbitMQ wins

- Flexible routing: topic and headers exchanges enable complex routing logic not possible in SQS
- RPC over messaging: request-reply pattern with `reply-to` queue
- Low latency: sub-millisecond delivery (vs Kafka's 5-15ms)
- Protocol diversity: AMQP, STOMP, MQTT (IoT) out of box

### When RabbitMQ loses

- Replay needed: RabbitMQ does not retain messages after consumption (DLQ only)
- Multiple consumer groups: no native consumer group semantics; requires separate queues per logical consumer
- Very high throughput (> 50k msg/s sustained): Kafka scales better

---

## NATS

### NATS Core vs NATS JetStream

| | NATS Core | NATS JetStream |
|--|-----------|---------------|
| Delivery | At-most-once | At-least-once |
| Persistence | No | Yes (configurable) |
| Replay | No | Yes |
| Consumer groups | Queue subscribers | Durable consumers |
| Latency | Sub-millisecond | Slightly higher (persistence overhead) |

### When NATS wins

- Ultra-low latency: NATS core is < 1ms; fastest of all options listed
- Cloud-native microservices: NATS is designed for Kubernetes; sidecar mode available
- IoT / edge: MQTT bridge available; lightweight protocol
- Simple ops: single binary; no ZooKeeper/KRaft; minimal configuration

### When NATS loses

- High durability requirement with long retention: Kafka is more battle-tested for multi-week retention
- Ecosystem maturity for event sourcing: Kafka + Debezium + Schema Registry is more mature

---

## Redis Streams

### When Redis Streams is the right choice

- Already running Redis for caching; adding Kafka/SQS for low-volume streaming is not justified
- Activity feeds, audit logs, lightweight event sourcing within a single application domain
- Simple consumer group semantics without broker infrastructure overhead

### Limitations

- Persistence tied to Redis persistence configuration (AOF/RDB) — risk of data loss without careful configuration
- Retention is memory-bounded; old entries must be trimmed (`MAXLEN` option)
- Not designed for multi-datacenter replication or exactly-once semantics
- No schema registry; no connector ecosystem comparable to Kafka Connect

### Consumer groups in Redis Streams

```
XADD orders * event OrderCreated order_id 123
XGROUP CREATE orders inventory-consumer $ MKSTREAM
XREADGROUP GROUP inventory-consumer worker1 COUNT 10 STREAMS orders >
XACK orders inventory-consumer <message-id>
```

Unacked messages (pending entries) are visible via `XPENDING` — the Redis equivalent of a visibility timeout.
