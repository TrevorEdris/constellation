---
description: 'Enforces event-driven architecture conventions: schema contracts, idempotency
  patterns, consumer group naming, DLQ configuration, and outbox pattern requirements.'
paths:
- '**/**/*consumer*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*producer*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*subscriber*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/*publisher*.{go'
- '**/ts'
- '**/py'
- '**/java}'
- '**/**/kafka*.{yaml'
- '**/properties'
- '**/json}'
- '**/**/rabbitmq*.{yaml'
- '**/json}'
- '**/**/pubsub*.{yaml'
- '**/json}'
- '**/**/*queue*.{tf'
- '**/yaml}'
- '**/**/*outbox*.{go'
- '**/ts'
- '**/py'
- '**/java'
- '**/sql}'
---

## Event-Driven Architecture Conventions

### Every Consumer Must Have a DLQ

- [CRITICAL] A consumer with no DLQ configured — a single unprocessable message can block the queue indefinitely or trigger infinite retries
- Kafka: configure a separate DLQ topic; publish failed messages after max retry attempts
- SQS: set `RedrivePolicy.maxReceiveCount` on every queue; point to a dedicated DLQ queue
- RabbitMQ: configure dead-letter-exchange and dead-letter-routing-key on every queue

```terraform
# SQS: required DLQ configuration
resource "aws_sqs_queue" "my_queue" {
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.my_dlq.arn
    maxReceiveCount     = 3
  })
}
```

### Consumer Handlers Must Be Idempotent

- [CRITICAL] A consumer that produces side effects more than once when called multiple times with the same message — at-least-once delivery makes redelivery guaranteed
- Use: `INSERT ... ON CONFLICT DO NOTHING`, upserts, inbox pattern, or idempotency key forwarding to downstream APIs
- Verify: processing the same event_id twice must produce the same observable outcome

```go
// Required: check for duplicate before processing
var seen bool
db.QueryRow(`SELECT EXISTS(SELECT 1 FROM inbox WHERE event_id = $1)`, event.ID).Scan(&seen)
if seen {
    return nil  // idempotent: skip
}
```

### Event Schemas Must Include Version Field

- [HIGH] Events without a version field cannot be safely evolved — adding a field later breaks all historical replay
- Minimum required envelope fields: `id`, `source`, `type`, `time`, `schema_version`
- Use CloudEvents spec or equivalent explicit envelope — do not rely on implicit versioning

```json
{
  "id": "01HX5RNKJ3...",
  "source": "/services/order-service",
  "type": "com.example.orders.OrderCreated",
  "time": "2024-01-15T10:30:00Z",
  "schema_version": "1",
  "data": {}
}
```

### Consumer Group Names Must Follow Convention

- [MEDIUM] Generic consumer group names (`consumer-1`, `worker`, `app`) make lag monitoring and incident diagnosis impossible
- Required format: `{service-name}-{source-topic}-consumer`
- Examples: `inventory-service-orders-consumer`, `analytics-service-payments-consumer`

```go
// Required: descriptive consumer group name
config.Group = "inventory-service-orders-consumer"  // not "consumer-group-1"
```

### No Business Logic in Message Handlers

- [HIGH] Business logic directly in a message handler function cannot be unit tested without broker infrastructure and mixes infrastructure concerns with domain logic
- Handler function responsibility: deserialize → validate envelope → delegate to service layer → commit offset/ack
- Service layer handles: business rules, DB writes, downstream calls

```go
// Required: thin handler
func (c *Consumer) handle(msg *kafka.Message) error {
    var event OrderCreated
    if err := json.Unmarshal(msg.Value, &event); err != nil {
        return err
    }
    return c.orderService.HandleOrderCreated(context.Background(), event)
    //       ^^^^ business logic lives in the service, not here
}
```

### DLQ Messages Must Include Failure Context

- [MEDIUM] DLQ messages without metadata make it impossible to diagnose why the message failed
- Required in DLQ message: original payload, failure reason, attempt count, source topic/partition/offset, timestamps

```go
type DLQMessage struct {
    OriginalMessage json.RawMessage `json:"original_message"`
    FailureReason   string          `json:"failure_reason"`
    AttemptCount    int             `json:"attempt_count"`
    SourceTopic     string          `json:"source_topic"`
    SourcePartition int32           `json:"source_partition"`
    SourceOffset    int64           `json:"source_offset"`
}
```

### Outbox Pattern Required for DB + Event Dual-Write

- [CRITICAL] Writing to a database AND publishing an event in two separate operations creates a dual-write hazard — if the publish fails after the DB write, the event is permanently lost
- Required: INSERT event into outbox table in the same database transaction as the business operation
- Relay publishes outbox rows to the broker (polling relay or Debezium CDC)

```go
// Required: outbox INSERT in same transaction as business record
return db.WithTx(ctx, func(tx *sqlx.Tx) error {
    _, err := insertOrder(ctx, tx, req)
    if err != nil { return err }

    _, err = tx.ExecContext(ctx,
        `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, $3, $4)`,
        "Order", order.ID, "OrderCreated", payload)
    return err
})
```

### DLQ Depth Must Be Monitored and Alerted

- [HIGH] A DLQ with no alert is a silent data graveyard — messages accumulate without investigation
- Alert threshold: any message in DLQ > 0 (or > threshold for high-volume systems)
- Metric: `kafka_consumer_group_lag{topic="*-dlq"}` or AWS CloudWatch `ApproximateNumberOfMessages` on DLQ queues

### Schema Breaking Changes Are Prohibited on Live Topics

- [CRITICAL] Removing a required field, renaming a field, or changing a field type on an active topic breaks all existing consumers immediately
- Safe changes only: add optional fields with defaults, add new event types
- Breaking change process: new topic + parallel publishing + consumer migration window
