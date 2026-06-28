---
name: aws-serverless
description: "Use when designing AWS serverless -- Lambda, Step Functions, EventBridge, SQS/SNS, SAM/CDK templates, cold starts, async invoke, DLQs, or fan-out."
user-invocable: true
argument-hint: "[lambda|stepfunctions|eventbridge|messaging|templates]"
tags: [aws, architecture]
---

# AWS Serverless

Serverless architecture patterns for Lambda, Step Functions, EventBridge, and SQS/SNS. Covers cold start optimization, event-driven design, SAM/CDK templates, and observability.

---

## When to Use

- Designing or implementing Lambda functions (any runtime)
- Choosing between sync vs async Lambda invocation
- Modeling workflows with Step Functions (standard vs express)
- Setting up EventBridge rules, buses, or pipes
- Designing SQS/SNS fan-out, DLQs, or FIFO queues
- Generating SAM or CDK templates for serverless architectures

**Prerequisites:** `/aws` — credential chain, SDK patterns, IaC tool selection

---

## Quick Start

```
/aws-serverless lambda          # Lambda patterns: handlers, layers, concurrency, DLQ
/aws-serverless stepfunctions   # Step Functions: workflow design, error handling
/aws-serverless eventbridge     # EventBridge: rules, custom buses, pipes
/aws-serverless messaging       # SQS/SNS: fan-out, FIFO, visibility timeout, DLQ
/aws-serverless templates       # SAM/CDK starter templates for common patterns
```

---

## Context

PROJECT FILES:
```
!`ls template.yaml samconfig.toml cdk.json 2>/dev/null; ls -la src/functions/ src/handlers/ lambda/ 2>/dev/null | head -20`
```

---

## Mode: lambda

### Handler Design

Structure Lambda handlers for testability by separating the handler entrypoint from business logic:

```python
# handler.py — entrypoint only; inject dependencies
import json
from service import MyService

_service = MyService()  # initialized once per cold start

def handler(event, context):
    try:
        result = _service.process(event)
        return {"statusCode": 200, "body": json.dumps(result)}
    except ValueError as e:
        return {"statusCode": 400, "body": str(e)}
    except Exception as e:
        # Let Lambda retry on unhandled exceptions for async invocations
        raise
```

### Invocation Modes

| Mode | Trigger | Retry | Use When |
|------|---------|-------|----------|
| **Synchronous** | API Gateway, ALB, SDK `.invoke()` | Caller handles retries | Need immediate response |
| **Asynchronous** | S3 events, SNS, EventBridge | Lambda retries 2x, then DLQ | Fire-and-forget, event processing |
| **Polling (stream)** | SQS, Kinesis, DynamoDB Streams | Managed by ESM; batch retry | Queue/stream consumers |

### Cold Start Optimization

Cold start occurs when Lambda provisions a new execution environment. Minimize it:

- **Minimize package size**: Tree-shake dependencies; use Lambda layers for shared deps
- **Avoid global SDK client recreation**: Initialize clients outside the handler function
- **Use SnapStart** (Java 11+ on Graviton): Snapshots initialized state, cuts cold start ~90%
- **Provisioned Concurrency**: Pre-warm N environments; use for latency-sensitive endpoints
- **Runtime selection** (cold start order, fastest first): Python/Node.js > Go/Rust > Java > .NET

### Concurrency Controls

```yaml
# SAM: reserve capacity and configure scaling
Properties:
  ReservedConcurrentExecutions: 100    # Hard cap — prevents runaway scaling
  # OR
  ProvisionedConcurrencyConfig:
    ProvisionedConcurrentExecutions: 10  # Pre-warmed environments
```

**Throttling behavior:** When reserved concurrency is exceeded, synchronous callers get 429; async invocations go to the retry queue, then the DLQ.

### DLQ and Destinations

```yaml
# SAM: DLQ for async invocations
EventInvokeConfig:
  MaximumRetryAttempts: 2
  DestinationConfig:
    OnFailure:
      Type: SQS
      Destination: !GetAtt MyDLQ.Arn
    OnSuccess:
      Type: EventBridge
```

### Lambda Layers

```bash
# Build layer with dependencies
mkdir -p layer/python
pip install -r requirements.txt -t layer/python/
zip -r layer.zip layer/

aws lambda publish-layer-version \
  --layer-name my-deps \
  --zip-file fileb://layer.zip \
  --compatible-runtimes python3.12
```

Reference: `references/lambda-patterns.md`

---

## Mode: stepfunctions

### Standard vs Express Workflows

| Feature | Standard | Express |
|---------|----------|---------|
| Max duration | 1 year | 5 minutes |
| Execution model | At-least-once | At-least-once (async) / At-most-once (sync) |
| Pricing | Per state transition | Per duration + requests |
| Audit history | Full execution history in console | CloudWatch Logs only |
| Use when | Long-running, human approval, audit trail | High-volume, short-duration, IoT/streaming |

### State Types Quick Reference

```json
{
  "ProcessOrder": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:...",
    "Retry": [{"ErrorEquals": ["Lambda.ServiceException"], "MaxAttempts": 3}],
    "Catch": [{"ErrorEquals": ["States.ALL"], "Next": "HandleError"}],
    "Next": "CheckResult"
  },
  "ParallelValidation": {
    "Type": "Parallel",
    "Branches": [{"StartAt": "ValidateA", ...}, {"StartAt": "ValidateB", ...}],
    "Next": "Merge"
  },
  "FanOut": {
    "Type": "Map",
    "ItemsPath": "$.items",
    "MaxConcurrency": 10,
    "Iterator": {"StartAt": "ProcessItem", ...}
  },
  "WaitForHuman": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Parameters": {"QueueUrl": "...", "MessageBody": {"token.$": "$$.Task.Token"}}
  }
}
```

### Error Handling Patterns

- **Retry**: Use for transient failures (Lambda throttles, SDK timeouts). Set `IntervalSeconds`, `MaxAttempts`, `BackoffRate`.
- **Catch**: Use for business logic failures. Transition to a handler state per error type.
- **`States.ALL`**: Catch-all — always add as last entry in `Catch` array.
- **Heartbeat**: For long-running tasks, set `HeartbeatSeconds` shorter than the task's expected duration.

Reference: `references/step-functions.md`

---

## Mode: eventbridge

### Default Bus vs Custom Bus

- **Default bus**: AWS service events (EC2 state change, S3 ObjectCreated, etc.)
- **Custom bus**: Application events between your own services — preferred for decoupling
- **Partner bus**: SaaS integrations (Stripe, Zendesk, Auth0)

### Rule Pattern Matching

```json
{
  "source": ["com.myapp.orders"],
  "detail-type": ["OrderPlaced"],
  "detail": {
    "amount": [{"numeric": [">", 100]}],
    "region": ["us-east-1", "eu-west-1"]
  }
}
```

### EventBridge Pipes

Pipes connect a source (SQS, DynamoDB Streams, Kinesis) to a target (Lambda, Step Functions, EventBridge bus) with optional filtering and enrichment — without writing glue code:

```
SQS Queue → [Filter] → [Enrichment Lambda] → Step Functions
```

Use pipes when you need lightweight fan-in/fan-out without a full Lambda consumer.

### Schema Registry

Enable schema discovery on custom buses — EventBridge automatically infers schemas from events and generates code bindings:

```bash
aws schemas put-resource-policy --registry-name discovered-schemas
# Auto-generated TypeScript/Python/Java/Go bindings available in console
```

Reference: `references/eventbridge.md`

---

## Mode: messaging

### SQS Patterns

| Pattern | Configuration |
|---------|--------------|
| Standard queue | At-least-once delivery; best-effort ordering |
| FIFO queue | Exactly-once processing; strict ordering per message group |
| DLQ | `maxReceiveCount` = 3–5; alarm on `ApproximateNumberOfMessagesVisible > 0` |
| Visibility timeout | Set to 6x the Lambda timeout to prevent duplicate processing |
| Long polling | `WaitTimeSeconds=20` on `ReceiveMessage`; reduces empty polls and cost |

**Lambda SQS consumer (ESM configuration):**
```yaml
Events:
  SQSTrigger:
    Type: SQS
    Properties:
      Queue: !GetAtt MyQueue.Arn
      BatchSize: 10
      FunctionResponseTypes:
        - ReportBatchItemFailures  # Partial batch success — critical for retry correctness
```

Always enable `ReportBatchItemFailures` — without it, any failure retries the entire batch.

### SNS Fan-Out

```
         ┌─── SQS Queue A (email processing)
SNS Topic ┤
         └─── SQS Queue B (analytics pipeline)
```

Use SNS → SQS fan-out (not SNS → Lambda directly) for resilience — SQS buffers if the consumer is slow or throttled.

**Message filtering:**
```json
{
  "event_type": ["order_placed", "order_cancelled"],
  "amount": [{"numeric": [">=", 50]}]
}
```

Apply subscription filter policies to route events without adding conditional logic to consumers.

Reference: `references/messaging-patterns.md`

---

## Mode: templates

### Lambda + API Gateway (SAM)

Reference: `assets/templates/lambda-api-gateway-sam.yaml`

```yaml
# Minimal starter — customize runtime, memory, timeout
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: python3.12
    MemorySize: 256
    Timeout: 30
    Environment:
      Variables:
        LOG_LEVEL: INFO

Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      Events:
        Api:
          Type: HttpApi  # Use HttpApi (v2) over RestApi (v1) for new projects
          Properties:
            Path: /{proxy+}
            Method: ANY
```

### Lambda + SQS Consumer (CDK — TypeScript)

Reference: `assets/templates/lambda-sqs-consumer-cdk.ts`

```typescript
const queue = new sqs.Queue(this, 'InputQueue', {
  visibilityTimeout: Duration.seconds(180), // 6x Lambda timeout (30s)
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'DLQ'),
    maxReceiveCount: 3,
  },
});

const fn = new lambda.Function(this, 'Consumer', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('src'),
  timeout: Duration.seconds(30),
});

fn.addEventSource(new SqsEventSource(queue, {
  batchSize: 10,
  reportBatchItemFailures: true,
}));
```

Reference: `references/sam-cdk-templates.md`

---

## Observability for Serverless

- **Structured logging**: Always log as JSON with `request_id`, `function_name`, `cold_start` fields
- **AWS Lambda Powertools**: Decorator-based logger/tracer/metrics for Python, TypeScript, Java, .NET
- **X-Ray tracing**: Enable `Tracing: Active` in SAM; add `@tracer.capture_method` to internal calls
- **CloudWatch metrics**: `Errors`, `Throttles`, `Duration` (P50/P99), `ConcurrentExecutions`
- **Alarms**: Error rate >1%, P99 latency >threshold, DLQ depth >0

For full observability setup: `observability` skill

---

## Cross-References

| Topic | Skill |
|-------|-------|
| Credential chain, SDK setup | `/aws` |
| IAM execution roles for Lambda | `/aws-iam` |
| CloudWatch, X-Ray, OTel | `observability` skill |
| CodePipeline/CodeBuild CI for Lambda | `cicd-pipeline` skill |
