# SAM Patterns Reference

## SAM Template Anatomy

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: "Order processing service"

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 512
    Tracing: Active           # X-Ray tracing for all functions
    Environment:
      Variables:
        ORDERS_TABLE: !Ref OrdersTable
        LOG_LEVEL: INFO

Parameters:
  Env:
    Type: String
    AllowedValues: [dev, staging, prod]

Resources:
  OrdersFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: orders/index.handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref OrdersTable
      Events:
        GetOrder:
          Type: Api
          Properties:
            Path: /orders/{id}
            Method: GET
        CreateOrder:
          Type: Api
          Properties:
            Path: /orders
            Method: POST

  OrdersTable:
    Type: AWS::Serverless::SimpleTable
    Properties:
      PrimaryKey:
        Name: orderId
        Type: String
```

## SAM Resource Types

| Resource Type | Purpose | Key Properties |
|--------------|---------|----------------|
| `AWS::Serverless::Function` | Lambda function with event sources | Handler, Runtime, Events, Policies |
| `AWS::Serverless::Api` | API Gateway REST API | StageName, Auth, DefinitionBody |
| `AWS::Serverless::HttpApi` | API Gateway HTTP API (V2) | StageName, Auth, CorsConfiguration |
| `AWS::Serverless::SimpleTable` | DynamoDB table (simple PK) | PrimaryKey, ProvisionedThroughput |
| `AWS::Serverless::Application` | Nested SAR application | Location, Parameters |
| `AWS::Serverless::LayerVersion` | Lambda layer | ContentUri, CompatibleRuntimes |
| `AWS::Serverless::StateMachine` | Step Functions state machine | Definition, Policies, Events |

## Event Source Types

```yaml
Events:
  # API Gateway REST
  RestApi:
    Type: Api
    Properties:
      Path: /resource
      Method: GET

  # API Gateway HTTP API (V2, lower cost)
  HttpApi:
    Type: HttpApi
    Properties:
      Path: /resource
      Method: GET

  # S3 trigger
  S3Upload:
    Type: S3
    Properties:
      Bucket: !Ref UploadBucket
      Events: s3:ObjectCreated:*

  # SQS queue
  Queue:
    Type: SQS
    Properties:
      Queue: !GetAtt OrderQueue.Arn
      BatchSize: 10
      FunctionResponseTypes:
        - ReportBatchItemFailures

  # DynamoDB Streams
  DdbStream:
    Type: DynamoDB
    Properties:
      Stream: !GetAtt OrdersTable.StreamArn
      StartingPosition: LATEST
      BisectBatchOnFunctionError: true

  # EventBridge
  EventBus:
    Type: EventBridgeRule
    Properties:
      Pattern:
        source: [com.myapp.orders]
        detail-type: [OrderCreated]

  # Scheduled (cron)
  DailyReport:
    Type: Schedule
    Properties:
      Schedule: cron(0 8 * * ? *)
```

## SAM Policy Templates

SAM policy templates generate least-privilege IAM automatically:

```yaml
Policies:
  - DynamoDBReadPolicy:
      TableName: !Ref MyTable
  - DynamoDBCrudPolicy:
      TableName: !Ref MyTable
  - S3ReadPolicy:
      BucketName: !Ref MyBucket
  - S3CrudPolicy:
      BucketName: !Ref MyBucket
  - SQSSendMessagePolicy:
      QueueName: !GetAtt MyQueue.QueueName
  - SSMParameterReadPolicy:
      ParameterName: /my-app/*
  - SecretsManagerReadWrite:
      SecretArn: !Ref MySecret
  - AWSSecretsManagerGetSecretValuePolicy:
      SecretArn: !Ref MySecret
```

## Local Testing

```bash
# Build for local testing and deployment
sam build

# Invoke function locally
sam local invoke OrdersFunction --event events/get-order.json

# Start local API Gateway
sam local start-api --port 3000

# Start local Lambda endpoint (for SDK testing)
sam local start-lambda

# Run accelerated deploy (hot reload without full redeploy)
sam sync --stack-name my-stack --watch

# Generate a test event
sam local generate-event s3 put > events/s3-put.json
sam local generate-event apigateway aws-proxy > events/api-event.json
```

## Deployment Workflow

```bash
# Validate template
sam validate --template template.yaml

# Build
sam build

# First-time guided deploy (creates samconfig.toml)
sam deploy --guided

# Subsequent deploys
sam deploy

# Deploy to specific environment
sam deploy \
  --parameter-overrides Env=prod \
  --stack-name my-app-prod \
  --s3-bucket my-deploy-bucket \
  --capabilities CAPABILITY_IAM
```

## samconfig.toml

```toml
version = 0.1

[default.deploy.parameters]
stack_name = "my-app"
resolve_s3 = true
capabilities = "CAPABILITY_IAM"
confirm_changeset = true     # Always review changes

[default.build.parameters]
cached = true
parallel = true

[prod.deploy.parameters]
stack_name = "my-app-prod"
parameter_overrides = "Env=prod"
confirm_changeset = true
```

Do not commit `samconfig.toml` with account IDs or deployment bucket names — use environment variables or `--parameter-overrides` in CI.

## Anti-Patterns

| Anti-Pattern | Risk | Fix |
|-------------|------|-----|
| Default 3s timeout | Cold starts exceed timeout | Set `Timeout` in Globals |
| Default 128MB memory | Performance bottleneck | Profile and set `MemorySize` explicitly |
| Inline IAM policies with `*` | Over-privileged | Use SAM policy templates |
| Hardcoded secrets in Env vars | Exposure in logs/console | Use Secrets Manager + `secretsmanager:` dynamic reference |
| Missing SQS `ReportBatchItemFailures` | Failed messages reprocess entire batch | Add `FunctionResponseTypes: [ReportBatchItemFailures]` |
| No `sam validate` before deploy | Syntax errors found at deploy time | Add to pre-deploy hook |
