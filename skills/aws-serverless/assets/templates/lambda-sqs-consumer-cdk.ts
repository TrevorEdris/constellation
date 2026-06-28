import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration } from 'aws-cdk-lib';

export interface LambdaSqsConsumerProps {
  environment: string;
  lambdaTimeoutSeconds?: number;
  batchSize?: number;
  reservedConcurrency?: number;
}

export class LambdaSqsConsumerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaSqsConsumerProps & cdk.StackProps) {
    super(scope, id, props);

    const {
      environment,
      lambdaTimeoutSeconds = 30,
      batchSize = 10,
      reservedConcurrency = 50,
    } = props;

    // Dead letter queue
    const dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `${id}-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Input queue
    // visibilityTimeout must be >= 6x Lambda timeout
    const inputQueue = new sqs.Queue(this, 'InputQueue', {
      queueName: `${id}-input`,
      visibilityTimeout: Duration.seconds(lambdaTimeoutSeconds * 6),
      retentionPeriod: Duration.days(1),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Consumer Lambda
    const consumerFn = new lambda.Function(this, 'Consumer', {
      functionName: `${id}-consumer-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,   // Change to PYTHON_3_12, GO_1_X, etc.
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/consumer'),
      timeout: Duration.seconds(lambdaTimeoutSeconds),
      memorySize: 256,
      reservedConcurrentExecutions: reservedConcurrency,
      tracing: lambda.Tracing.ACTIVE,        // X-Ray tracing
      environment: {
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'INFO' : 'DEBUG',
      },
    });

    // SQS event source with partial batch failure support
    consumerFn.addEventSource(new SqsEventSource(inputQueue, {
      batchSize,
      reportBatchItemFailures: true,       // Critical: only retry failed messages
      maxBatchingWindow: Duration.seconds(5), // Accumulate messages for up to 5s
    }));

    // Alarm when messages land in DLQ
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `${id}-dlq-non-empty`,
      alarmDescription: 'Messages in DLQ indicate consumer failures requiring investigation',
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm on Lambda error rate > 5%
    new cloudwatch.Alarm(this, 'ErrorRateAlarm', {
      alarmName: `${id}-error-rate`,
      alarmDescription: 'Lambda error rate exceeded 5%',
      metric: new cloudwatch.MathExpression({
        expression: 'errors / invocations * 100',
        usingMetrics: {
          errors: consumerFn.metricErrors({ period: Duration.minutes(5) }),
          invocations: consumerFn.metricInvocations({ period: Duration.minutes(5) }),
        },
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Outputs
    new cdk.CfnOutput(this, 'QueueUrl', {
      value: inputQueue.queueUrl,
      description: 'SQS input queue URL',
    });
    new cdk.CfnOutput(this, 'DLQUrl', {
      value: dlq.queueUrl,
      description: 'Dead letter queue URL',
    });
    new cdk.CfnOutput(this, 'FunctionName', {
      value: consumerFn.functionName,
      description: 'Consumer Lambda function name',
    });
  }
}
