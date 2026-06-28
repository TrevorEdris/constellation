# CloudFormation / CDK Anti-Patterns

## Critical Anti-Patterns (Block Before Deploy)

### 1. Missing `DeletionPolicy: Retain` on Stateful Resources

**Risk:** Deleting or updating a stack accidentally destroys databases, file systems, or object stores.

```yaml
# Wrong
Resources:
  Database:
    Type: AWS::RDS::DBInstance
    # No DeletionPolicy — default is Delete

# Correct
  Database:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain  # Also required for replace operations
    Properties:
      DeletionProtection: true   # Belt + suspenders
```

Resources requiring `DeletionPolicy: Retain` in production:
- `AWS::RDS::DBInstance` / `AWS::RDS::DBCluster`
- `AWS::DynamoDB::Table`
- `AWS::S3::Bucket`
- `AWS::ElastiCache::ReplicationGroup`
- `AWS::OpenSearchService::Domain`
- `AWS::EFS::FileSystem`

### 2. `NoEcho: false` on Sensitive Parameters

**Risk:** Passwords and API keys exposed in CloudFormation events, console, and CLI output.

```yaml
# Wrong — NoEcho defaults to false
Parameters:
  Password:
    Type: String

# Correct
  Password:
    Type: String
    NoEcho: true
    Description: "Database password — manage in Secrets Manager"
```

Better: Use Secrets Manager dynamic references instead of parameters for secrets:
```yaml
Properties:
  MasterUserPassword: "{{resolve:secretsmanager:my-db-secret:SecretString:password}}"
```

### 3. Hardcoded Account IDs, Region Names, and AMI IDs

**Risk:** Breaks cross-account deployments; AMI IDs are region-specific and become stale.

```yaml
# Wrong
Properties:
  ImageId: ami-0abcdef1234567890  # Region-specific, becomes stale
  # In a condition:
  Account: "123456789012"         # Breaks cross-account

# Correct — SSM dynamic AMI reference
Properties:
  ImageId: "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}"

# Correct — pseudo-parameters
  BucketName: !Sub "${AWS::AccountId}-${AWS::Region}-my-bucket"
```

### 4. IAM Policies with Wildcard Actions or Resources

**Risk:** Over-privileged roles; blast radius of a compromise is entire service.

```yaml
# Wrong
Policies:
  - PolicyDocument:
      Statement:
        - Effect: Allow
          Action: "*"
          Resource: "*"

# Correct — minimum required actions
  - PolicyDocument:
      Statement:
        - Effect: Allow
          Action:
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
          Resource: !GetAtt OrdersTable.Arn
```

### 5. Circular `Fn::ImportValue` Dependencies

**Risk:** Stack A exports to Stack B, Stack B exports to Stack A — deployment deadlock; neither can be updated without manual intervention.

**Fix:** Replace with SSM Parameter Store:
```yaml
# Producer: write to SSM
  WriteVpcId:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/infra/${Env}/vpc-id"
      Value: !Ref VPC
      Type: String

# Consumer: read from SSM
Properties:
  VpcId: "{{resolve:ssm:/infra/prod/vpc-id}}"
```

---

## CDK-Specific Anti-Patterns

### 6. L1 Constructs When L2 Exists

**Risk:** L1 requires all security properties to be set manually. L2 sets encryption, public access blocks, and secure defaults automatically.

```typescript
// Wrong — L1; misses security defaults
new s3.CfnBucket(this, 'Bucket', {
  bucketName: 'my-bucket',
  // Must manually set: encryption, public access block, versioning...
});

// Correct — L2 with security defaults
new s3.Bucket(this, 'Bucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

### 7. Singleton App Without Stages

**Risk:** Impossible to add CDK Pipelines or multi-environment promotion later without refactoring.

```typescript
// Wrong — no promotion path
const app = new cdk.App();
new MyStack(app, 'MyStack');  // Where does this deploy?

// Correct — stages from day one
const app = new cdk.App();
new MyStack(app, 'MyStack-Dev', { env: devEnv });
const prod = new MyProdStage(app, 'Prod');
```

### 8. `cdk deploy` Without `cdk diff`

**Risk:** Blindly applies changes including destructive replacements.

**Fix:** In CI, run `cdk diff` and gate on output:
```bash
cdk synth
cdk diff 2>&1 | tee diff-output.txt
# Fail if replacements detected
if grep -q "replaced" diff-output.txt; then
  echo "Replacement operations detected — manual review required"
  exit 1
fi
```

### 9. `CfnOutput` for Cross-Stack References in CDK

**Risk:** Creates deployment ordering coupling equivalent to `Fn::ImportValue`.

```typescript
// Wrong — creates coupling
new cdk.CfnOutput(this, 'VpcId', {
  value: vpc.vpcId,
  exportName: 'SharedVpcId',
});

// Correct — use SSM for loose coupling
new ssm.StringParameter(this, 'VpcIdParam', {
  parameterName: '/infra/prod/vpc-id',
  stringValue: vpc.vpcId,
});
```

### 10. Environment-Specific Hardcoding

```typescript
// Wrong
const tableName = isProd ? 'prod-orders' : 'dev-orders';

// Correct — use CDK context
const tableName = this.node.tryGetContext('tableName')
  ?? `${this.stackName}-orders`;

// Or SSM lookup (evaluated at synth time)
const tableName = ssm.StringParameter.valueFromLookup(this, '/app/table-name');
```

---

## Template Size Anti-Patterns

- CloudFormation template body limit: 1MB (via S3 URL); 51KB (inline)
- CDK synthesized templates regularly exceed this for large stacks — split into nested stacks or separate CDK stacks
- Monitor with: `aws cloudformation describe-stacks --query 'Stacks[*].[StackName,EnableTerminationProtection]'`

---

## Change Set Discipline

Always use change sets in production. Never:
```bash
# Wrong for production
aws cloudformation deploy --template-file template.yaml --stack-name prod-stack

# Correct
aws cloudformation create-change-set --stack-name prod-stack \
  --template-body file://template.yaml \
  --change-set-name review-$(date +%s)
aws cloudformation wait change-set-create-complete --change-set-name review-xxx
aws cloudformation describe-change-set --change-set-name review-xxx
# After review:
aws cloudformation execute-change-set --change-set-name review-xxx
```
