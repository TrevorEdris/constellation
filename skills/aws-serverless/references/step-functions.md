# Step Functions — Reference

State machine design, error handling, and common patterns for Standard and Express workflows.

---

## Standard vs Express

| Feature | Standard | Express (Async) | Express (Sync) |
|---------|----------|-----------------|----------------|
| Max duration | 1 year | 5 minutes | 5 minutes |
| Execution model | Exactly-once | At-least-once | At-most-once |
| Pricing | $0.025/1K state transitions | $1/M requests + $0.00001667/GB-second | Same |
| Execution history | Stored (console queryable) | CloudWatch Logs only | CloudWatch Logs |
| Wait for completion | Yes (polling) | No (fire-and-forget) | Yes (inline) |
| **Use when** | Long-running, human approvals, audit trail, guaranteed execution | High-volume event processing, IoT, streaming | Synchronous orchestration, API backends |

---

## State Types

### Task — Call an external resource

```json
{
  "MyTask": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:us-east-1:123:function:MyFunction",
    "Parameters": {
      "orderId.$": "$.orderId",
      "userId.$": "$.userId"
    },
    "ResultPath": "$.taskResult",
    "TimeoutSeconds": 300,
    "HeartbeatSeconds": 60,
    "Retry": [{
      "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }],
    "Catch": [{
      "ErrorEquals": ["OrderNotFound"],
      "Next": "HandleMissingOrder",
      "ResultPath": "$.error"
    }, {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleGenericError",
      "ResultPath": "$.error"
    }],
    "Next": "ProcessResult"
  }
}
```

### Parallel — Execute branches concurrently

```json
{
  "ValidateAll": {
    "Type": "Parallel",
    "Branches": [
      {
        "StartAt": "ValidateInventory",
        "States": {
          "ValidateInventory": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:...:ValidateInventory",
            "End": true
          }
        }
      },
      {
        "StartAt": "ValidatePayment",
        "States": {
          "ValidatePayment": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:...:ValidatePayment",
            "End": true
          }
        }
      }
    ],
    "ResultPath": "$.validationResults",
    "Next": "CreateOrder"
  }
}
```

All branches must succeed. If any fails, the Parallel state fails.

### Map — Process array items

```json
{
  "ProcessItems": {
    "Type": "Map",
    "ItemsPath": "$.items",
    "ItemSelector": {
      "item.$": "$$.Map.Item.Value",
      "index.$": "$$.Map.Item.Index"
    },
    "MaxConcurrency": 10,
    "ToleratedFailurePercentage": 10,
    "Iterator": {
      "StartAt": "ProcessSingleItem",
      "States": {
        "ProcessSingleItem": {
          "Type": "Task",
          "Resource": "arn:aws:lambda:...:ProcessItem",
          "End": true
        }
      }
    },
    "ResultPath": "$.processedItems",
    "Next": "Summarize"
  }
}
```

`MaxConcurrency: 0` = unlimited concurrency. Set a limit for downstream rate limiting.

### Wait — Pause for duration or timestamp

```json
{
  "WaitForShipment": {
    "Type": "Wait",
    "SecondsPath": "$.delaySeconds",
    "Next": "CheckStatus"
  }
}
```

### Choice — Branching based on conditions

```json
{
  "RouteOrder": {
    "Type": "Choice",
    "Choices": [
      {
        "Variable": "$.amount",
        "NumericGreaterThan": 1000,
        "Next": "RequireApproval"
      },
      {
        "Variable": "$.priority",
        "StringEquals": "URGENT",
        "Next": "ExpressProcessing"
      }
    ],
    "Default": "StandardProcessing"
  }
}
```

---

## Wait for Task Token (Human Approval / External System)

```json
{
  "WaitForApproval": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Parameters": {
      "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123/approval-queue",
      "MessageBody": {
        "orderId.$": "$.orderId",
        "approvalToken.$": "$$.Task.Token",
        "callbackUrl": "https://api.myapp.com/approval"
      }
    },
    "HeartbeatSeconds": 86400,
    "Next": "ProcessApproval"
  }
}
```

The approval system calls `SendTaskSuccess` or `SendTaskFailure` with the token when done:

```python
sfn = boto3.client('stepfunctions')
sfn.send_task_success(
    taskToken=token,
    output=json.dumps({"approved": True, "approvedBy": "alice@example.com"})
)
```

---

## JSONPath Reference

| Expression | Meaning |
|-----------|---------|
| `$.field` | Input field |
| `$$.Execution.Id` | Current execution ARN |
| `$$.Task.Token` | Task token (waitForTaskToken only) |
| `$$.Map.Item.Value` | Current Map item value |
| `$$.Map.Item.Index` | Current Map item index |
| `$$.State.Name` | Current state name |

`ResultPath: "$.result"` — where to put the task output (merges into input)
`OutputPath: "$.result"` — what to pass to the next state (filters input)
`Parameters` — reshapes input before passing to the resource

---

## Error Handling

### Retry Configuration

```json
"Retry": [{
  "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
  "IntervalSeconds": 1,
  "MaxAttempts": 3,
  "BackoffRate": 2.0,
  "JitterStrategy": "FULL"
}]
```

`JitterStrategy: "FULL"` (default since 2023) randomizes retry delays — prevents thundering herd.

### Common Error Classes

| Error | Cause |
|-------|-------|
| `States.ALL` | Catch-all — always add as last Catch entry |
| `States.Timeout` | Task exceeded TimeoutSeconds |
| `States.HeartbeatTimeout` | No heartbeat received in HeartbeatSeconds |
| `States.TaskFailed` | Task returned an error (Lambda threw exception) |
| `Lambda.ServiceException` | Lambda service error — retriable |
| `Lambda.TooManyRequestsException` | Lambda concurrency throttle — retriable |

---

## CDK Example

```typescript
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

const processOrder = new tasks.LambdaInvoke(this, 'ProcessOrder', {
  lambdaFunction: processOrderFn,
  outputPath: '$.Payload',
  retryOnServiceExceptions: true,
});

const waitState = new sfn.Wait(this, 'WaitForShipment', {
  time: sfn.WaitTime.secondsPath('$.delaySeconds'),
});

const definition = processOrder.next(waitState);

new sfn.StateMachine(this, 'OrderWorkflow', {
  definition,
  stateMachineType: sfn.StateMachineType.STANDARD,
  timeout: Duration.days(1),
  tracingEnabled: true,
});
```
