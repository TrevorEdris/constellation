# Lambda Patterns — Reference

Deep-dive on Lambda handler design, layers, concurrency, DLQ, destinations, and runtime-specific notes.

---

## Handler Design

### Dependency Injection Pattern

Separate the Lambda entrypoint from business logic. Initialize clients outside the handler (once per execution environment):

```python
# Python — dependency injection for testability
import boto3
from myapp.service import OrderService

# Initialized once per cold start; reused across warm invocations
_s3_client = boto3.client('s3', region_name='us-east-1')
_service = OrderService(s3_client=_s3_client)

def handler(event, context):
    order_id = event['pathParameters']['orderId']
    order = _service.get_order(order_id)
    return {
        "statusCode": 200,
        "body": order.to_json(),
        "headers": {"Content-Type": "application/json"}
    }
```

```go
// Go — handler initialized with dependencies
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

type Handler struct {
    s3 *s3.Client
}

func (h *Handler) Handle(ctx context.Context, event map[string]interface{}) (interface{}, error) {
    // Business logic here
    return nil, nil
}

func main() {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    h := &Handler{s3: s3.NewFromConfig(cfg)}
    lambda.Start(h.Handle)
}
```

---

## Event Schemas

Common event sources and their payload structures:

### API Gateway HTTP API (v2)

```json
{
  "version": "2.0",
  "routeKey": "GET /items/{id}",
  "rawPath": "/items/123",
  "pathParameters": {"id": "123"},
  "queryStringParameters": {"filter": "active"},
  "headers": {"authorization": "Bearer ..."},
  "requestContext": {
    "http": {"method": "GET", "path": "/items/123"},
    "requestId": "abc-123"
  },
  "body": null,
  "isBase64Encoded": false
}
```

### SQS

```json
{
  "Records": [{
    "messageId": "...",
    "receiptHandle": "...",
    "body": "{\"orderId\": \"123\"}",
    "attributes": {
      "ApproximateReceiveCount": "1",
      "SentTimestamp": "1638000000000"
    },
    "eventSource": "aws:sqs",
    "eventSourceARN": "arn:aws:sqs:us-east-1:123:my-queue"
  }]
}
```

For batch processing with `ReportBatchItemFailures`:
```python
def handler(event, context):
    failed_ids = []
    for record in event['Records']:
        try:
            process(json.loads(record['body']))
        except Exception as e:
            logger.error(f"Failed to process {record['messageId']}: {e}")
            failed_ids.append({"itemIdentifier": record['messageId']})
    return {"batchItemFailures": failed_ids}
```

### S3 Event

```json
{
  "Records": [{
    "s3": {
      "bucket": {"name": "my-bucket"},
      "object": {"key": "uploads/file.jpg", "size": 1024}
    },
    "eventName": "ObjectCreated:Put"
  }]
}
```

---

## Lambda Layers

Use layers for:
- Shared dependencies across multiple functions (reduces deployment package size)
- Runtime extensions (Datadog APM, Lambda Powertools)
- Large binaries (chromedriver, ffmpeg)

```bash
# Build and publish a Python dependency layer
mkdir -p layer/python
pip install -r requirements.txt -t layer/python/ --platform manylinux2014_x86_64 --only-binary=:all:
cd layer && zip -r ../my-deps-layer.zip python/
cd ..

aws lambda publish-layer-version \
  --layer-name my-deps \
  --description "Shared dependencies v1.2.3" \
  --zip-file fileb://my-deps-layer.zip \
  --compatible-runtimes python3.12 \
  --compatible-architectures x86_64 arm64
```

Limit: 5 layers per function; 250MB total unzipped size (layers + function code).

---

## Concurrency

| Setting | Effect |
|---------|--------|
| No setting | Shares account concurrency pool (default 1,000 per region) |
| `ReservedConcurrentExecutions: N` | Hard limit; excess requests throttled with 429 |
| `ProvisionedConcurrentExecutions: N` | N environments pre-warmed; charged at provisioned rate even when idle |
| `ReservedConcurrentExecutions: 0` | Disable function entirely (maintenance mode) |

**Choosing reserved concurrency:** Reserve for critical functions that must not be throttled by noisy neighbors. Leave headroom in the account pool.

---

## Environment Variables

```yaml
# SAM
Globals:
  Function:
    Environment:
      Variables:
        LOG_LEVEL: INFO
        ENVIRONMENT: !Ref Environment

# Sensitive values — reference from Secrets Manager (not plaintext)
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Environment:
        Variables:
          DB_PASSWORD: '{{resolve:secretsmanager:prod/myapp/db:SecretString:password}}'
```

For bulk secret injection, prefer fetching from Secrets Manager at cold start (see `/aws-iam` → `references/secrets-patterns.md`).

---

## DLQ Configuration

```yaml
# SAM — async invocation DLQ
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    DeadLetterQueue:
      Type: SQS
      TargetArn: !GetAtt DLQ.Arn
    EventInvokeConfig:
      MaximumRetryAttempts: 2
      MaximumEventAgeInSeconds: 21600  # 6 hours

DLQ:
  Type: AWS::SQS::Queue
  Properties:
    MessageRetentionPeriod: 1209600  # 14 days
```

Always alarm on DLQ depth > 0:
```yaml
DLQAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    MetricName: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Dimensions:
      - Name: QueueName
        Value: !GetAtt DLQ.QueueName
    Threshold: 0
    ComparisonOperator: GreaterThanThreshold
    EvaluationPeriods: 1
    Period: 60
```

---

## Lambda Powertools

Use AWS Lambda Powertools for structured logging, tracing, and metrics without boilerplate:

```python
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.metrics import MetricUnit

logger = Logger()
tracer = Tracer()
metrics = Metrics(namespace="MyApp")

@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event, context):
    metrics.add_metric(name="OrdersProcessed", unit=MetricUnit.Count, value=1)
    logger.info("Processing order", extra={"order_id": event["orderId"]})
    return {"statusCode": 200}
```

Available for Python, TypeScript, Java, and .NET.

---

## Runtime Cold Start Benchmarks (approximate, arm64 Graviton)

| Runtime | Typical cold start | Optimization |
|---------|------------------:|-------------|
| Python 3.12 | 200–500ms | Reduce package size; use layers |
| Node.js 20 | 150–400ms | Tree-shake; avoid heavy frameworks |
| Go 1.x | 50–150ms | Minimal dependencies; static binary |
| Rust | 30–100ms | Minimal crate tree; link-time optimization |
| Java 21 (SnapStart) | 100–200ms | Enable SnapStart; CRaC checkpoints |
| Java 21 (no SnapStart) | 1–3s | Enable SnapStart; or switch runtime |
| .NET 8 | 300–800ms | Native AOT compilation; Lambda NativeAOT |
