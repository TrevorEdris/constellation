# CDK Constructs Reference

## Construct Levels

| Level | Pattern | Description | Example |
|-------|---------|-------------|---------|
| L1 | `Cfn*` | 1:1 CloudFormation resource mapping | `new s3.CfnBucket(this, 'Bucket', { ... })` |
| L2 | Named classes | Opinionated defaults, integrated security | `new s3.Bucket(this, 'Bucket', { ... })` |
| L3 | Pattern classes | Multi-resource compositions | `new ecsPatterns.ApplicationLoadBalancedFargateService(...)` |

**Decision rule:** Start at L3 if a pattern exists, fall back to L2, use L1 only when L2 lacks the required property.

## Project Layout (TypeScript)

```
my-cdk-app/
├── bin/
│   └── my-app.ts          # App entry point; instantiates stacks/stages
├── lib/
│   ├── my-stack.ts        # Stack definition(s)
│   └── constructs/        # Custom L2/L3 constructs
│       └── vpc-with-endpoints.ts
├── test/
│   └── my-stack.test.ts   # Assertions tests
├── cdk.json               # App command, context, feature flags
├── tsconfig.json
└── package.json
```

## Stack and Stage Pattern

```typescript
// bin/my-app.ts
import { App } from 'aws-cdk-lib';
import { MyStack } from '../lib/my-stack';
import { MyProdStage } from '../lib/my-stage';

const app = new App();

// Dev: direct stack (no pipeline needed)
new MyStack(app, 'MyStack-Dev', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});

// Prod: stage (enables CDK Pipelines)
const prod = new MyProdStage(app, 'Prod', {
  env: { account: '123456789012', region: 'us-east-1' },
});
```

```typescript
// lib/my-stage.ts
import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MyStack } from './my-stack';

export class MyProdStage extends Stage {
  constructor(scope: Construct, id: string, props: StageProps) {
    super(scope, id, props);
    new MyStack(this, 'App', props);
  }
}
```

## CDK Pipelines (Self-Mutating)

```typescript
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';

const pipeline = new CodePipeline(this, 'Pipeline', {
  pipelineName: 'MyAppPipeline',
  synth: new ShellStep('Synth', {
    input: CodePipelineSource.gitHub('owner/repo', 'main'),
    commands: ['npm ci', 'npm run build', 'npx cdk synth'],
  }),
});

pipeline.addStage(new MyProdStage(this, 'Prod'), {
  pre: [new ManualApprovalStep('PromoteToProd')],
  post: [new ShellStep('IntegTest', {
    commands: ['npm run test:integration'],
  })],
});
```

## Security with cdk-nag

```typescript
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

// Apply checks to entire app
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Suppress with documented rationale
NagSuppressions.addResourceSuppressions(myBucket, [{
  id: 'AwsSolutions-S1',
  reason: 'Access logs unnecessary for short-lived build artifact bucket',
}]);
```

**Rule packs available:** `AwsSolutionsChecks`, `HIPAASecurityChecks`, `NIST80053R5Checks`, `PCIDSS321Checks`

## Assertions Testing

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MyStack } from '../lib/my-stack';

describe('MyStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new MyStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  test('S3 bucket has versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  test('Lambda runtime is nodejs20.x', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
    });
  });

  test('No public S3 buckets', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('Exactly 2 Lambda functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });
});
```

## Common L2 Constructs and Their Security Defaults

**S3 Bucket:**
```typescript
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';

new Bucket(this, 'AppData', {
  encryption: BucketEncryption.S3_MANAGED,   // Default in L2
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,  // Default
  versioned: true,                            // Must set explicitly
  removalPolicy: RemovalPolicy.RETAIN,        // For production
  autoDeleteObjects: false,                   // Never true in prod
});
```

**Lambda Function:**
```typescript
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';

new Function(this, 'Handler', {
  runtime: Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: Code.fromAsset('lambda'),
  timeout: Duration.seconds(30),
  memorySize: 512,
  environment: {
    TABLE_NAME: table.tableName,  // Pass via env; never hardcode
  },
  tracing: Tracing.ACTIVE,        // X-Ray tracing
});
```

**RDS Database:**
```typescript
import { DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion } from 'aws-cdk-lib/aws-rds';

new DatabaseInstance(this, 'Database', {
  engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
  vpc,
  vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
  multiAz: true,                    // Required for production
  storageEncrypted: true,           // Default in L2
  deletionProtection: true,         // Required for production
  removalPolicy: RemovalPolicy.RETAIN,
  credentials: Credentials.fromGeneratedSecret('admin'),
});
```

## Projen for Scaffolding

```bash
# Scaffold a CDK TypeScript app with managed project files
npx projen new awscdk-app-ts

# Regenerate managed boilerplate after editing .projenrc.ts
npx projen
```

Projen manages `package.json`, tsconfig, `.github/workflows`, and lint config as code. Prevents configuration drift across teams.

## Workflow Commands

```bash
cdk synth          # Synthesize — always run before diff/deploy
cdk diff           # Preview changes against deployed stack
cdk deploy         # Deploy (add --require-approval broadening for production safety)
cdk deploy --all   # Deploy all stacks in the app
cdk destroy        # Teardown (prompts for confirmation)
cdk ls             # List all stacks in the app
cdk context        # View/manage context values
```
