# Messaging Selection Reference

Decision guide for choosing between synchronous and asynchronous communication, and between messaging technologies.

---

## Synchronous vs Asynchronous

### When to use synchronous (REST, gRPC)

- Caller needs the result immediately to produce its own response
- Operation is a read (idempotent, no side effects)
- Latency SLA is tight (< 100ms) and queue processing time is unpredictable
- Transaction semantics require immediate confirmation (payment authorization, stock check)

### When to use asynchronous

- Result is not needed immediately (send email, generate report, propagate notification)
- Operation is expensive and can be deferred out of the request path
- Multiple consumers need to process the same event independently
- The producer and consumer should evolve and scale independently
- Temporal decoupling: downstream systems may be temporarily unavailable

### The fundamental tradeoff

Synchronous: simpler reasoning, immediate feedback, tight coupling, cascading failures.
Asynchronous: complex reasoning, eventual consistency, loose coupling, independent failure domains.

Do not choose async to "be modern." Choose async when temporal decoupling solves a real problem.

---

## Queue vs Event Stream

| Criterion | Queue | Event Stream |
|-----------|-------|-------------|
| **Primary use case** | Work distribution, job queue | Event log, analytics, CDC |
| **Message replay** | No (consumed and deleted) | Yes (configurable retention) |
| **Multiple consumer groups** | Fan-out requires separate queues per consumer | Native: each group reads full stream independently |
| **Ordering** | No (FIFO queues add per-message-group ordering) | Yes, per partition/shard |
| **Backpressure** | Queue depth is natural backpressure signal | Consumer lag is the backpressure signal |
| **Reprocessing on bug fix** | Must replay from DLQ or original source | Rewind consumer group offset to any point |
| **Typical latency** | Milliseconds | Milliseconds to sub-second |
| **Operational complexity** | Low | High (Kafka requires ZooKeeper/KRaft, broker management) |
| **Best technology** | SQS, RabbitMQ | Kafka, Kinesis, Redis Streams |

---

## Pattern Catalog

### Pub/Sub (fan-out)

Producer publishes to a topic/exchange. Multiple subscribers receive every message independently.

**When to use:**
- One event must trigger N independent actions (order created → send email AND update inventory AND notify fraud service)
- Subscribers evolve independently (can add/remove without touching publisher)
- Publisher does not know or care who consumes its events

**Technologies:** SNS + SQS (AWS), Google Pub/Sub, Kafka (multiple consumer groups), RabbitMQ fanout exchange

**Critical requirement:** each subscriber must be idempotent — message may be delivered more than once.

### Point-to-point queue

Single producer, single consumer. Each message processed exactly once by one consumer.

**When to use:**
- Work queue / task queue: distribute jobs across worker pool
- Exactly one consumer should handle each message (not fan-out)
- Load leveling: absorb burst traffic and process at sustainable rate

**Technologies:** SQS standard queue, RabbitMQ direct exchange, Redis List (BRPOP)

### Request/reply over messaging

Synchronous semantics over async infrastructure. Producer sends request with `reply-to` queue and `correlation-id`. Consumer sends response to `reply-to` queue.

**When to use:** legacy RPC over messaging middleware; when direct HTTP is not possible (different network zones).

**Not recommended for new designs** — use gRPC or REST for synchronous patterns.

### Competing consumers

Multiple consumer instances read from the same queue to scale processing throughput.

- All consumers in the same logical group compete for messages
- Message delivered to exactly one consumer (at-least-once, not exactly-once)
- Consumer count can scale horizontally up to queue partition count (Kafka) or independently (SQS)

### Event sourcing via stream

Kafka (or Kinesis) topic is the system of record. All state changes are events. Multiple consumer groups build different read models by projecting the same event stream.

**When to use:** audit trail required, multiple read models from same source, replay needed.

---

## Broker Selection Decision Matrix

For full comparison table see `references/broker-comparison.md` in the `event-driven` skill.

### Quick selection guide

```
Are you on AWS?
  → Start with SQS (queue) or SNS+SQS (fan-out)
  → Add Kinesis if you need replay or ordered streaming

Are you on GCP?
  → Use Google Cloud Pub/Sub

Are you on Azure?
  → Use Azure Service Bus

Cloud-agnostic or self-hosted?
  → Kafka if you need: replay, event sourcing, high throughput, multiple consumer groups
  → RabbitMQ if you need: low latency, flexible routing, RPC patterns, simpler ops than Kafka
  → NATS if you need: sub-millisecond latency, IoT/edge, cloud-native, minimal ops
  → Redis Streams if you need: lightweight streaming within existing Redis infrastructure

Already running Kafka?
  → Use Kafka for new async communication needs; avoid adding a second broker
```

---

## SQS Patterns (AWS)

### Standard vs FIFO

| Queue Type | Ordering | Throughput | Deduplication |
|------------|----------|------------|---------------|
| Standard | Best-effort (no ordering guarantee) | Unlimited TPS | No (may deliver duplicates) |
| FIFO | Per-message-group FIFO | 300 TPS (3000 with batching) | Yes (5-minute deduplication window) |

Use FIFO only when ordering or deduplication is required — it has lower throughput and higher cost.

### Visibility timeout

After a consumer receives a message, it becomes invisible to other consumers for `VisibilityTimeout` seconds. If the consumer does not delete the message within that window, it becomes visible again for redelivery.

Set `VisibilityTimeout` > max processing time + buffer. Too short → duplicate processing.

### SQS + SNS fan-out pattern

```
SNS Topic
  ├── SQS Queue (email-service-subscription)
  ├── SQS Queue (inventory-service-subscription)
  └── SQS Queue (fraud-service-subscription)
```

Each SQS queue has its own consumer group, retry policy, and DLQ. SNS delivers the message to all three queues simultaneously.

### DLQ configuration

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123:orders-dlq",
  "maxReceiveCount": 3
}
```

`maxReceiveCount`: number of times a message can be received before being moved to DLQ.

---

## RabbitMQ Patterns

### Exchange types

| Exchange | Routing | Use Case |
|----------|---------|----------|
| Direct | Exact routing key match | Point-to-point; specific service |
| Topic | Wildcard routing key match | Event routing by type (`orders.*`, `*.created`) |
| Fanout | Broadcast to all bound queues | Pub/sub; push to all subscribers |
| Headers | Route by message headers | Complex routing without routing key |

### Work queue (competing consumers)

```
Producer → Direct Exchange → Queue → [Worker 1, Worker 2, Worker 3]
```

Enable `ack_mode = manual` — workers ack only after successful processing. Unacked messages requeue on worker failure.

### Publisher confirms

Enable to guarantee the broker received and persisted the message before the producer considers it sent:
```
channel.confirmSelect()
channel.waitForConfirmsOrDie(5000)  // blocks until broker confirms
```

Without publisher confirms, messages can be lost if the broker crashes before writing to disk.
