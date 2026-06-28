# Consumer Design Reference

Patterns for building reliable, idempotent, and maintainable event consumers.

---

## Idempotency

Every consumer that receives at-least-once delivery must be idempotent. A message may be redelivered due to: consumer restart, rebalance, network error, relay retry, or manual replay.

**An idempotent consumer:** processing the same message twice produces the same outcome as processing it once.

### Natural idempotency (preferred)

The operation itself is inherently idempotent — no extra infrastructure needed.

```sql
-- INSERT with ON CONFLICT: duplicate is silently ignored
INSERT INTO inventory_reservations (order_id, item_id, quantity)
VALUES ($1, $2, $3)
ON CONFLICT (order_id, item_id) DO NOTHING;

-- UPDATE with idempotent predicate: repeated updates produce same state
UPDATE orders SET status = 'shipped' WHERE id = $1 AND status = 'processing';

-- Upsert: insert or update to same result
INSERT INTO user_settings (user_id, theme, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id) DO UPDATE SET theme = EXCLUDED.theme, updated_at = EXCLUDED.updated_at;
```

### Deduplication table (inbox pattern)

When natural idempotency is not possible, record processed event IDs in an inbox table.

```go
func (c *Consumer) Process(ctx context.Context, event Event) error {
    return c.db.WithTx(ctx, func(tx *sqlx.Tx) error {
        // Check for duplicate
        var seen bool
        err := tx.QueryRowContext(ctx,
            `SELECT EXISTS(SELECT 1 FROM inbox WHERE event_id = $1)`, event.ID,
        ).Scan(&seen)
        if err != nil {
            return fmt.Errorf("inbox check: %w", err)
        }
        if seen {
            return nil  // idempotent: skip duplicate
        }

        // Business operation
        if err := c.service.Apply(ctx, tx, event); err != nil {
            return fmt.Errorf("apply event: %w", err)
        }

        // Record in inbox — same transaction as business operation
        _, err = tx.ExecContext(ctx,
            `INSERT INTO inbox (event_id, topic, processed_at, expires_at)
             VALUES ($1, $2, NOW(), NOW() + INTERVAL '7 days')`,
            event.ID, event.Topic)
        return err
    })
}
```

**Inbox table expiry:** set `expires_at` to cover the broker's maximum redelivery window. For Kafka with default 7-day retention, 7 days. Run a cleanup job:
```sql
DELETE FROM inbox WHERE expires_at < NOW();
```

### Idempotency key forwarded to downstream APIs

When the consumer calls another service:
```go
// Pass the event ID as the idempotency key to downstream APIs
resp, err := paymentClient.Charge(ctx, &ChargeRequest{
    Amount:         event.Total,
    IdempotencyKey: event.ID,  // same event_id = same charge
})
```

The downstream API must implement server-side idempotency (see `system-design resilience` mode).

---

## Dead Letter Queue (DLQ)

### What belongs in a DLQ

A message should be sent to the DLQ when:
- It has been retried the maximum number of times and continues to fail
- It cannot be deserialized (malformed or unknown schema version)
- Processing it would violate a business invariant that cannot be resolved by retry

**A DLQ is not a trash bin.** Every message in a DLQ represents a real failure that requires investigation.

### DLQ message envelope

Enrich DLQ messages with failure context:

```go
type DLQMessage struct {
    OriginalMessage    json.RawMessage `json:"original_message"`
    FailureReason      string          `json:"failure_reason"`
    AttemptCount       int             `json:"attempt_count"`
    FirstAttemptAt     time.Time       `json:"first_attempt_at"`
    LastAttemptAt      time.Time       `json:"last_attempt_at"`
    ConsumerGroup      string          `json:"consumer_group"`
    SourceTopic        string          `json:"source_topic"`
    SourcePartition    int32           `json:"source_partition"`
    SourceOffset       int64           `json:"source_offset"`
}
```

### DLQ implementation by broker

**Kafka:**
```go
// Consumer: on max retries exceeded, publish to DLQ topic
func (c *Consumer) handleFailure(ctx context.Context, record *kafka.Message, err error) {
    dlqMsg := DLQMessage{
        OriginalMessage: record.Value,
        FailureReason:   err.Error(),
        AttemptCount:    c.getAttemptCount(record),
        SourceTopic:     *record.TopicPartition.Topic,
        SourcePartition: record.TopicPartition.Partition,
        SourceOffset:    int64(record.TopicPartition.Offset),
    }
    payload, _ := json.Marshal(dlqMsg)
    c.dlqProducer.Produce(&kafka.Message{
        TopicPartition: kafka.TopicPartition{Topic: &c.dlqTopic},
        Key:            record.Key,
        Value:          payload,
    }, nil)
}
```

**SQS:**
Configure the DLQ at the queue level:
```terraform
resource "aws_sqs_queue" "orders_queue" {
  name = "orders"
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "orders_dlq" {
  name = "orders-dlq"
  message_retention_seconds = 1209600  # 14 days
}
```

### DLQ monitoring and remediation

```
Alert: DLQ message count > 0 → page on-call
  Metric: kafka_consumer_group_lag{topic="orders-dlq"} or
          aws_sqs_approximate_number_of_messages_visible{queue="orders-dlq"}

Remediation process:
  1. Inspect DLQ messages → identify root cause
  2. Fix the consumer bug
  3. Deploy the fix
  4. Replay DLQ messages:
     - Kafka: reset consumer group offset on DLQ topic to earliest, consume into fixed topic
     - SQS: use SQS message mover or Lambda to re-enqueue original messages
  5. Verify DLQ is drained and processing succeeds
  6. Confirm DLQ depth returns to 0
```

---

## Poison Message Handling

A poison message is one that repeatedly causes consumer failures. Without handling, it blocks the queue indefinitely (for ordered queues) or triggers infinite retries (for SQS).

### Handling strategies

**Strategy 1: Retry with bounded attempts → DLQ**
Most common. After N retries, move to DLQ. Unblocks processing of subsequent messages.

**Strategy 2: Skip with logging (at-most-once semantics for known-bad messages)**
For non-critical events where processing loss is acceptable:
```go
func (c *Consumer) handle(ctx context.Context, record *kafka.Message) error {
    event, err := c.deserialize(record.Value)
    if err != nil {
        // Deserialization failure is permanent; skip and log
        log.Error("failed to deserialize event; skipping",
            "error", err, "offset", record.TopicPartition.Offset)
        metrics.IncCounter("consumer.skipped_messages")
        return nil  // ack/commit to move past this record
    }
    return c.processEvent(ctx, event)
}
```

**Strategy 3: Pause and alert (for critical ordered streams)**
For ordered streams where a stuck offset cannot be skipped:
```go
// Pause the partition; alert on-call; do not advance offset until resolved
consumer.Pause(kafka.TopicPartitions{{Topic: record.TopicPartition.Topic, Partition: record.TopicPartition.Partition}})
alertOnCall("Poison message blocking partition; manual intervention required")
```

---

## Consumer Architecture: Handler Separation

### Anti-pattern: business logic in message handler

```go
// BAD: business logic directly in handler
func (c *Consumer) processMessage(msg *kafka.Message) error {
    var event OrderCreated
    json.Unmarshal(msg.Value, &event)

    // Direct DB access in handler
    _, err := c.db.Exec(`UPDATE inventory SET reserved = reserved + $1 WHERE item_id = $2`,
        event.Quantity, event.ItemID)
    if err != nil {
        return err
    }

    // Direct external call in handler
    c.emailClient.SendConfirmation(event.UserEmail)
    return nil
}
```

Problems: handler function cannot be unit tested without broker infrastructure; business logic is buried in infrastructure layer.

### Pattern: thin handler, rich service

```go
// GOOD: handler is thin infrastructure glue
func (c *Consumer) processMessage(msg *kafka.Message) error {
    // 1. Deserialize
    var event OrderCreated
    if err := json.Unmarshal(msg.Value, &event); err != nil {
        return fmt.Errorf("deserialize: %w", err)
    }

    // 2. Validate envelope
    if event.ID == "" || event.OrderID == "" {
        return fmt.Errorf("invalid event: missing required fields")
    }

    // 3. Delegate to service layer (all business logic lives here)
    return c.inventoryService.HandleOrderCreated(context.Background(), event)
}

// Service layer: testable without broker
func (s *InventoryService) HandleOrderCreated(ctx context.Context, event OrderCreated) error {
    return s.db.WithTx(ctx, func(tx *sqlx.Tx) error {
        if err := s.repo.ReserveInventory(ctx, tx, event.OrderID, event.ItemID, event.Quantity); err != nil {
            return err
        }
        return s.notifier.NotifyReservation(ctx, event.UserID, event.OrderID)
    })
}
```

Unit test the service layer with mocked dependencies. Integration test the handler with an actual broker (or TestContainers).

---

## Consumer Group Naming Convention

```
{service-name}-{source-topic}-consumer

Examples:
  inventory-service-orders-consumer
  notification-service-payments-consumer
  analytics-service-user-events-consumer
  fraud-service-transactions-consumer
```

**Why this matters:**
- Consumer group names appear in Kafka tooling, dashboards, and lag alerts
- Consistent naming makes it immediately clear which service is behind which group
- Avoid generic names like `consumer-1` or `worker` — these are ambiguous in multi-service monitoring

---

## Backpressure in Consumers

When a consumer processes slowly (expensive DB operations, external calls), it accumulates lag. Options:

### Scale out consumers

Add more consumer instances. Effective up to `partition_count` instances. Beyond that, adding instances does nothing.

### Limit concurrency

Process messages one-at-a-time (simpler, but limits throughput) or with bounded concurrency:

```go
sem := make(chan struct{}, maxConcurrentMessages)

for record := range messages {
    sem <- struct{}{}
    go func(r Message) {
        defer func() { <-sem }()
        handler.Process(r)
    }(record)
}
```

Caution: concurrent processing with Kafka requires careful offset management — do not commit an offset until all prior messages in the partition are processed.

### Circuit breaker on downstream dependencies

If the consumer calls a slow external service, protect it with a circuit breaker. Avoid letting a slow downstream cascade into infinite consumer lag.

---

## Observability

### Key consumer metrics

```
consumer_messages_processed_total{topic, consumer_group, outcome=success|failure|dlq}
consumer_processing_duration_seconds{topic, consumer_group, quantile=0.5|0.95|0.99}
consumer_lag_messages{topic, partition, consumer_group}  -- from Kafka; alert if growing
consumer_dlq_messages_total{topic, consumer_group}       -- alert if > 0
consumer_retry_attempts_total{topic, consumer_group}     -- spike indicates upstream issues
```

### Structured log fields on every consumer event

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "message": "processed event",
  "service": "inventory-service",
  "consumer_group": "inventory-service-orders-consumer",
  "topic": "orders",
  "partition": 2,
  "offset": 98745,
  "event_id": "01HX5RNKJ3...",
  "event_type": "OrderCreated",
  "processing_ms": 12,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```
