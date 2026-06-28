import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface MyStackProps extends StackProps {
  /**
   * Deployment environment: dev | staging | prod
   */
  readonly env_name: string;
}

/**
 * MyStack — TODO: describe purpose of this stack
 *
 * Resources:
 * - S3 bucket for application data
 * - IAM role for application access
 */
export class MyStack extends Stack {
  /** ARN of the application S3 bucket */
  public readonly bucketArn: string;

  constructor(scope: Construct, id: string, props: MyStackProps) {
    super(scope, id, props);

    const isProd = props.env_name === 'prod';

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------
    const appBucket = new s3.Bucket(this, 'AppData', {
      // Never auto-generate the name in prod — use explicit naming for drift detection
      bucketName: `${this.stackName.toLowerCase()}-${props.env_name}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,  // Only auto-delete in non-prod
      lifecycleRules: [
        {
          id: 'DeleteNoncurrentVersions',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
    });

    this.bucketArn = appBucket.bucketArn;

    // -------------------------------------------------------------------------
    // IAM
    // -------------------------------------------------------------------------
    const appRole = new iam.Role(this, 'AppRole', {
      roleName: `${this.stackName}-${props.env_name}-app`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Use grant methods — they generate minimum required policies
    appBucket.grantReadWrite(appRole);

    // -------------------------------------------------------------------------
    // SSM Parameters (loose cross-stack coupling)
    // Prefer SSM over CfnOutput exports to avoid deployment ordering constraints
    // -------------------------------------------------------------------------
    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: `/${this.stackName}/${props.env_name}/bucket-name`,
      stringValue: appBucket.bucketName,
      description: 'Application data bucket name',
    });

    new ssm.StringParameter(this, 'AppRoleArnParam', {
      parameterName: `/${this.stackName}/${props.env_name}/app-role-arn`,
      stringValue: appRole.roleArn,
      description: 'Application IAM role ARN',
    });

    // -------------------------------------------------------------------------
    // Outputs (for CDK stack references within the same app)
    // -------------------------------------------------------------------------
    new CfnOutput(this, 'BucketName', {
      value: appBucket.bucketName,
      description: 'Application data S3 bucket name',
    });

    new CfnOutput(this, 'BucketArn', {
      value: appBucket.bucketArn,
      description: 'Application data S3 bucket ARN',
    });

    new CfnOutput(this, 'AppRoleArn', {
      value: appRole.roleArn,
      description: 'Application IAM role ARN',
    });
  }
}
