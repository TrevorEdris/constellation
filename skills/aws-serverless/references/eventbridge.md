# EventBridge — Reference

Rules, custom buses, pipes, schema registry, and event-driven architecture patterns.

---

## Bus Types

| Bus | Source | Use When |
|-----|--------|---------|
| **Default bus** | AWS service events | Reacting to AWS service state changes (EC2, S3, RDS, etc.) |
| **Custom bus** | Your application | Event-driven communication between your own services |
| **Partner bus** | SaaS integrations | Receiving events from Stripe, Zendesk, Auth0, etc. |

Always create a **custom bus** for application events — the default bus mixes service and application events and is harder to govern.

---

## Event Structure

Every EventBridge event follows this envelope:

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "source": "com.myapp.orders",
  "account": "123456789012",
  "time": "2026-02-20T12:00:00Z",
  "region": "us-east-1",
  "detail-type": "OrderPlaced",
  "detail": {
    "orderId": "order-123",
    "userId": "user-456",
    "amount": 149.99,
    "currency": "USD",
    "items": ["item-1", "item-2"]
  }
}
```

**Naming conventions:**
- `source`: reverse-domain notation `com.myapp.service`
- `detail-type`: human-readable event name in PascalCase: `OrderPlaced`, `PaymentFailed`

---

## Event Pattern Matching

Patterns match on any combination of event fields. Only specified fields are evaluated — omitted fields match anything.

```json
{
  "source": ["com.myapp.orders"],
  "detail-type": ["OrderPlaced"],
  "detail": {
    "amount": [{"numeric": [">", 100]}],
    "currency": ["USD", "EUR"],
    "items": [{"exists": true}]
  }
}
```

### Matching Operators

| Operator | Example | Matches |
|----------|---------|---------|
| Exact | `["USD"]` | Field equals "USD" |
| Prefix | `[{"prefix": "order-"}]` | Starts with "order-" |
| Suffix | `[{"suffix": "-prod"}]` | Ends with "-prod" |
| Anything-but | `[{"anything-but": "CANCELLED"}]` | Not "CANCELLED" |
| Numeric range | `[{"numeric": [">=", 100, "<", 1000]}]` | 100–999 |
| Exists | `[{"exists": true}]` | Field is present |
| Null | `[null]` | Field is null or missing |
| IP prefix | `[{"cidr": "10.0.0.0/8"}]` | IP in CIDR |

---

## Publishing Events

```python
# Python
import boto3
import json

events = boto3.client('events')

events.put_events(
    Entries=[{
        'Source': 'com.myapp.orders',
        'DetailType': 'OrderPlaced',
        'Detail': json.dumps({
            'orderId': 'order-123',
            'amount': 149.99
        }),
        'EventBusName': 'my-app-events',  # Custom bus name or ARN
    }]
)
```

```typescript
// TypeScript
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({ region: "us-east-1" });

await client.send(new PutEventsCommand({
  Entries: [{
    Source: "com.myapp.orders",
    DetailType: "OrderPlaced",
    Detail: JSON.stringify({ orderId: "order-123", amount: 149.99 }),
    EventBusName: "my-app-events",
  }]
}));
```

`put_events` accepts up to 10 entries per call. Responses include per-entry success/failure — always check `FailedEntryCount`.

---

## Rules

```bash
# Create a rule targeting a Lambda function
aws events put-rule \
  --name "process-orders" \
  --event-bus-name "my-app-events" \
  --event-pattern '{"source":["com.myapp.orders"],"detail-type":["OrderPlaced"]}' \
  --state ENABLED

aws events put-targets \
  --rule "process-orders" \
  --event-bus-name "my-app-events" \
  --targets "Id=ProcessOrderLambda,Arn=arn:aws:lambda:us-east-1:123:function:ProcessOrder"
```

Lambda must have a resource policy allowing EventBridge to invoke it:
```bash
aws lambda add-permission \
  --function-name ProcessOrder \
  --statement-id "AllowEventBridge" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "arn:aws:events:us-east-1:123:rule/my-app-events/process-orders"
```

---

## EventBridge Pipes

Pipes connect source → [optional filter] → [optional enrichment] → target without Lambda glue code.

```
Source Options:  SQS, DynamoDB Streams, Kinesis, Kafka, MQ
Filter:          JSON pattern (same syntax as EventBridge rules)
Enrichment:      Lambda, Step Functions, API Gateway, API Destination
Target Options:  Lambda, Step Functions, EventBridge bus, SQS, SNS, Kinesis, Firehose, ECS, Batch
```

```typescript
// CDK — SQS to Step Functions via Pipe
import { Pipe, Filter } from '@aws-cdk/aws-pipes-alpha';
import * as sources from '@aws-cdk/aws-pipes-sources-alpha';
import * as targets from '@aws-cdk/aws-pipes-targets-alpha';

new Pipe(this, 'OrderPipe', {
  source: new sources.SqsSource(orderQueue),
  filter: new Filter([
    FilterPattern.fromObject({ body: { amount: [{ "numeric": [">", 100] }] } })
  ]),
  target: new targets.SfnStateMachine(orderWorkflow),
});
```

---

## Schema Registry

```bash
# Enable auto-discovery on a bus (discovers schemas from events automatically)
aws schemas create-discoverer \
  --source-arn arn:aws:events:us-east-1:123:event-bus/my-app-events

# List discovered schemas
aws schemas list-schemas --registry-name discovered-schemas

# Download code bindings (TypeScript, Python, Java, Go)
aws schemas get-code-binding-source \
  --registry-name discovered-schemas \
  --schema-name "com.myapp.orders@OrderPlaced" \
  --language "TypeScript4"
```

Schema Registry is free for discovered schemas; charges apply for code binding downloads ($0.01 per schema).

---

## Cross-Account Event Routing

```json
// Resource policy on the target account's event bus
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::SOURCE_ACCOUNT:root"},
    "Action": "events:PutEvents",
    "Resource": "arn:aws:events:us-east-1:TARGET_ACCOUNT:event-bus/shared-events"
  }]
}
```

Source account rule target:
```
Target ARN: arn:aws:events:us-east-1:TARGET_ACCOUNT:event-bus/shared-events
Role: IAM role with events:PutEvents permission on the target bus
```
