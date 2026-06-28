# SAM and CDK Starter Templates — Reference

Common patterns for Lambda + API Gateway, SQS consumers, Step Functions, and EventBridge.

---

## SAM: Lambda + HTTP API Gateway

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Parameters:
  Environment:
    Type: String
    Default: dev
    AllowedValues: [dev, staging, prod]

Globals:
  Function:
    Runtime: python3.12
    MemorySize: 256
    Timeout: 30
    Tracing: Active
    Layers:
      - !Ref SharedDepsLayer
    Environment:
      Variables:
        ENVIRONMENT: !Ref Environment
        LOG_LEVEL: !If [IsProd, "INFO", "DEBUG"]
    Tags:
      Environment: !Ref Environment

Conditions:
  IsProd: !Equals [!Ref Environment, "prod"]

Resources:
  Api:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: !Ref Environment
      CorsConfiguration:
        AllowOrigins:
          - "https://myapp.com"
        AllowHeaders:
          - "Content-Type"
          - "Authorization"
        AllowMethods:
          - "GET"
          - "POST"
          - "PUT"
          - "DELETE"

  ItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handlers/items.handler
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref DataBucket
        - AWSSecretsManagerGetSecretValuePolicy:
            SecretArn: !Sub "arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${Environment}/myapp/*"
      Events:
        GetItems:
          Type: HttpApi
          Properties:
            ApiId: !Ref Api
            Path: /items
            Method: GET
        GetItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref Api
            Path: /items/{id}
            Method: GET

  SharedDepsLayer:
    Type: AWS::Serverless::LayerVersion
    Properties:
      LayerName: shared-deps
      ContentUri: layers/shared/
      CompatibleRuntimes:
        - python3.12
    Metadata:
      BuildMethod: python3.12

  DataBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    Properties:
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

Outputs:
  ApiEndpoint:
    Value: !Sub "https://${Api}.execute-api.${AWS::Region}.amazonaws.com/${Environment}"
```

---

## SAM: Lambda + SQS Consumer with DLQ

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  InputQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 180  # 6x Lambda timeout
      MessageRetentionPeriod: 86400
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt DLQ.Arn
        maxReceiveCount: 3

  DLQ:
    Type: AWS::SQS::Queue
    Properties:
      MessageRetentionPeriod: 1209600  # 14 days

  ConsumerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      Runtime: python3.12
      Timeout: 30
      ReservedConcurrentExecutions: 50
      Events:
        SQSTrigger:
          Type: SQS
          Properties:
            Queue: !GetAtt InputQueue.Arn
            BatchSize: 10
            FunctionResponseTypes:
              - ReportBatchItemFailures

  DLQAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "${AWS::StackName}-dlq-messages"
      MetricName: ApproximateNumberOfMessagesVisible
      Namespace: AWS/SQS
      Dimensions:
        - Name: QueueName
          Value: !GetAtt DLQ.QueueName
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      EvaluationPeriods: 1
      Period: 60
      AlarmActions:
        - !Ref AlertTopic
```

---

## CDK: TypeScript Full Serverless Stack

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration } from 'aws-cdk-lib';

export class ServerlessStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Dead letter queue
    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
    });

    // Input queue
    const queue = new sqs.Queue(this, 'InputQueue', {
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // API Lambda
    const apiFn = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/api'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        QUEUE_URL: queue.queueUrl,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant queue send permissions to API function
    queue.grantSendMessages(apiFn);

    // HTTP API
    const api = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['https://myapp.com'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({
      path: '/items',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('ApiIntegration', apiFn),
    });

    // Consumer Lambda
    const consumerFn = new lambda.Function(this, 'ConsumerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/consumer'),
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 50,
      tracing: lambda.Tracing.ACTIVE,
    });

    consumerFn.addEventSource(new SqsEventSource(queue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'QueueUrl', { value: queue.queueUrl });
  }
}
```

---

## SAM: Step Functions Workflow

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  ValidateFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handlers/validate.handler
      Runtime: python3.12

  ProcessFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handlers/process.handler
      Runtime: python3.12

  OrderWorkflow:
    Type: AWS::Serverless::StateMachine
    Properties:
      Type: STANDARD
      Tracing:
        Enabled: true
      Policies:
        - LambdaInvokePolicy:
            FunctionName: !Ref ValidateFunction
        - LambdaInvokePolicy:
            FunctionName: !Ref ProcessFunction
      Definition:
        StartAt: ValidateOrder
        States:
          ValidateOrder:
            Type: Task
            Resource: !GetAtt ValidateFunction.Arn
            Retry:
              - ErrorEquals: ["Lambda.ServiceException", "Lambda.TooManyRequestsException"]
                IntervalSeconds: 2
                MaxAttempts: 3
                BackoffRate: 2
                JitterStrategy: FULL
            Catch:
              - ErrorEquals: ["ValidationError"]
                Next: OrderInvalid
              - ErrorEquals: ["States.ALL"]
                Next: OrderFailed
            Next: ProcessOrder
          ProcessOrder:
            Type: Task
            Resource: !GetAtt ProcessFunction.Arn
            End: true
          OrderInvalid:
            Type: Fail
            Error: VALIDATION_FAILED
            Cause: "Order failed validation"
          OrderFailed:
            Type: Fail
            Error: PROCESSING_FAILED
            Cause: "Order processing failed"
```
