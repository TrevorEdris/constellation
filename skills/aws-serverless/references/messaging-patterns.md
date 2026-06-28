# Messaging Patterns — Reference

SQS (standard, FIFO, DLQ), SNS fan-out, and message filtering.

---

## SQS Queue Types

| Feature | Standard | FIFO |
|---------|----------|------|
| Throughput | Nearly unlimited | 300 msg/s (3,000 with batching) |
| Ordering | Best-effort | Strict per message group |
| Delivery | At-least-once | Exactly-once (within deduplication window) |
| Deduplication | None | 5-minute content-based or explicit ID |
| Cost | Lower | ~10% higher |
| **Use when** | High throughput, ordering not critical | Financial transactions, inventory, order processing |

FIFO queue names must end in `.fifo`.

---

## Key SQS Configuration

### Visibility Timeout

The time a message is hidden from other consumers after being received. **Set to 6x the Lambda timeout** to prevent duplicate processing during long executions.

```python
# If Lambda timeout is 30s, set visibility timeout to 180s
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123/my-queue \
  --attributes VisibilityTimeout=180
```

If a function fails before the timeout expires, SQS makes the message visible again for retry. If it succeeds, the Lambda runtime deletes the message.

### Long Polling

```python
# Reduce empty responses and cost
response = client.receive_message(
    QueueUrl=queue_url,
    MaxNumberOfMessages=10,     # Batch up to 10 messages
    WaitTimeSeconds=20,         # Long poll — wait up to 20s for messages
    VisibilityTimeout=180
)
```

Always use `WaitTimeSeconds=20` — short polling sends empty responses and charges per request.

### Dead Letter Queue

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123:my-dlq",
  "maxReceiveCount": "3"
}
```

After `maxReceiveCount` failed deliveries, the message moves to the DLQ. Set `maxReceiveCount` to 3–5 for most use cases.

```yaml
# SAM — Queue with DLQ
MyQueue:
  Type: AWS::SQS::Queue
  Properties:
    VisibilityTimeout: 180
    MessageRetentionPeriod: 86400   # 1 day
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt DLQ.Arn
      maxReceiveCount: 3

DLQ:
  Type: AWS::SQS::Queue
  Properties:
    MessageRetentionPeriod: 1209600  # 14 days — time to investigate failures
```

---

## Lambda SQS Consumer

```yaml
# SAM — Lambda consuming SQS with partial batch failure support
MyConsumer:
  Type: AWS::Serverless::Function
  Properties:
    Handler: handler.handler
    Timeout: 30  # Must be < VisibilityTimeout / 6
    Events:
      SQSTrigger:
        Type: SQS
        Properties:
          Queue: !GetAtt MyQueue.Arn
          BatchSize: 10
          FunctionResponseTypes:
            - ReportBatchItemFailures  # Critical: partial batch success
          FilterCriteria:             # Optional: filter before Lambda invoke
            Filters:
              - Pattern: '{"body": {"eventType": ["ORDER_PLACED"]}}'
```

**ReportBatchItemFailures** is critical: without it, a single message failure retries the entire batch. With it, only failed messages are retried.

```python
def handler(event, context):
    failed_ids = []
    for record in event['Records']:
        try:
            body = json.loads(record['body'])
            process_message(body)
        except Exception as e:
            logger.error(f"Failed to process {record['messageId']}: {e}")
            failed_ids.append({"itemIdentifier": record['messageId']})

    # Return failed message IDs — SQS retries only these
    return {"batchItemFailures": failed_ids}
```

---

## SNS Topics

```bash
# Create topic
aws sns create-topic --name my-topic

# Subscribe SQS queue to topic
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123:my-topic \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:us-east-1:123:my-queue
```

The SQS queue must have a resource policy allowing SNS to send messages:
```json
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "sns.amazonaws.com"},
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:us-east-1:123:my-queue",
    "Condition": {
      "ArnEquals": {"aws:SourceArn": "arn:aws:sns:us-east-1:123:my-topic"}
    }
  }]
}
```

---

## SNS Fan-Out Pattern

```
               ┌─── SQS Queue A → Lambda (email service)
SNS Topic ─────┤
               ├─── SQS Queue B → Lambda (analytics pipeline)
               └─── SQS Queue C → Lambda (audit logger)
```

Use SNS → SQS fan-out rather than SNS → Lambda directly:
- SQS absorbs throughput spikes (Lambda throttling)
- SQS provides durability and retry (SNS retries are limited)
- Multiple consumers can independently scale

### Message Filtering

Subscription filter policies allow each subscriber to receive only relevant messages:

```json
// Analytics queue subscription filter — high-value orders only
{
  "amount": [{"numeric": [">=", 100]}],
  "currency": ["USD", "EUR"],
  "eventType": ["ORDER_PLACED"]
}

// Email queue subscription filter — all order events
{
  "eventType": ["ORDER_PLACED", "ORDER_SHIPPED", "ORDER_CANCELLED"]
}
```

Apply filters in the SNS subscription, not in the consumer Lambda — saves compute cost.

---

## FIFO Queues and Topics

FIFO queues require `MessageGroupId` (ordering) and optionally `MessageDeduplicationId`:

```python
sqs.send_message(
    QueueUrl=fifo_queue_url,
    MessageBody=json.dumps(order),
    MessageGroupId=f"user-{order['userId']}",        # Per-user ordering
    MessageDeduplicationId=f"order-{order['orderId']}"  # 5-min dedup window
)
```

FIFO SNS → FIFO SQS preserves end-to-end ordering:
```bash
# FIFO topic name must end in .fifo
aws sns create-topic --name my-topic.fifo --attributes FifoTopic=true,ContentBasedDeduplication=false
```

---

## SQS Visibility and Retry Strategy

```
Message received → VisibilityTimeout starts (180s)
  ├── Processing succeeds → Lambda runtime deletes message ✓
  ├── Processing fails → Exception propagates → VisibilityTimeout expires → message visible again
  │   └── Retry N times (maxReceiveCount) → move to DLQ
  └── Processing fails partway (partial batch) → ReportBatchItemFailures → only failed messages retry
```

Tune `maxReceiveCount` based on:
- How many legitimate retries are expected (transient failures: 3–5 is enough)
- Whether the failure is idempotent-safe (retrying the same message multiple times is safe)
