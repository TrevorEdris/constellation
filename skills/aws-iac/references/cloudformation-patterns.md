# CloudFormation Patterns Reference

## Template Structure

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: "One-line purpose statement"

Parameters:
  Env:
    Type: String
    AllowedValues: [dev, staging, prod]
    Description: "Deployment environment"
  DatabasePassword:
    Type: String
    NoEcho: true
    Description: "RDS master password"

Conditions:
  IsProd: !Equals [!Ref Env, prod]

Resources:     # Required; all other sections optional
  MyBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      BucketName: !Sub "${AWS::StackName}-${Env}-data"
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256

Outputs:
  BucketArn:
    Value: !GetAtt MyBucket.Arn
    Export:
      Name: !Sub "${AWS::StackName}:BucketArn"
```

## Intrinsic Functions

| Function | Purpose | Example |
|----------|---------|---------|
| `!Sub` | String interpolation | `!Sub "${AWS::StackName}-${Env}-bucket"` |
| `!Ref` | Parameter value or resource logical ID | `!Ref Env` |
| `!GetAtt` | Resource attribute | `!GetAtt MyBucket.Arn` |
| `!If [Cond, T, F]` | Conditional value | `!If [IsProd, enabled, disabled]` |
| `!Select [i, list]` | List element | `!Select [0, !GetAZs ""]` |
| `Fn::ImportValue` | Cross-stack export | `!ImportValue "NetworkStack:VpcId"` |

**Common `!Ref` / `!GetAtt` gotchas:**
- `AWS::S3::Bucket` → `!Ref` returns bucket name; `!GetAtt .Arn` returns ARN
- `AWS::Lambda::Function` → `!Ref` returns function name; `!GetAtt .Arn` returns ARN
- `AWS::DynamoDB::Table` → `!Ref` returns table name; `!GetAtt .Arn` returns ARN

## Nested Stacks vs Stack Sets

**Nested Stacks** (`AWS::CloudFormation::Stack`):
- Same account and region
- Use for reusable module patterns; share templates via S3
- Limit: 500 resources per stack total (nested counted in parent)
- Changes to nested template require updating parent stack

**Stack Sets:**
- Multi-account, multi-region from a single operation
- Use with AWS Organizations for baseline infrastructure
- Requires StackSets delegated admin role

## Change Sets

Always use change sets for production changes:
```bash
# Create change set
aws cloudformation create-change-set \
  --stack-name my-stack \
  --change-set-name review-$(date +%s) \
  --template-body file://template.yaml \
  --parameters ParameterKey=Env,ParameterValue=prod

# Review
aws cloudformation describe-change-set --change-set-name review-xxx

# Execute
aws cloudformation execute-change-set --change-set-name review-xxx
```

## Cross-Stack References: SSM vs Exports

**Prefer SSM Parameter Store** for loose coupling:
```yaml
# Producer: write to SSM
  PutVpcId:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub "/infra/${Env}/vpc-id"
      Type: String
      Value: !Ref VPC

# Consumer: read from SSM at deploy time
  MyResource:
    Properties:
      VpcId: !Sub "{{resolve:ssm:/infra/${Env}/vpc-id}}"
```

`Fn::ImportValue` creates a hard dependency: the producer stack cannot be deleted while any consumer references its exports. SSM avoids this coupling.

## Dynamic References

Avoid hardcoding by using dynamic references:
```yaml
# SSM Parameter (resolved at deploy time)
Value: "{{resolve:ssm:/my-app/config-value}}"

# SSM SecureString (encrypted; use for non-secret config)
Value: "{{resolve:ssm-secure:/my-app/secret}}"

# Secrets Manager
Value: "{{resolve:secretsmanager:my-secret:SecretString:password}}"

# AMI IDs (use instead of hardcoded AMI)
ImageId: "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}"
```

## SAM Extensions

SAM transforms to standard CloudFormation at deploy time:
```yaml
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 512
    Environment:
      Variables:
        TABLE_NAME: !Ref MyTable

Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Policies:
        - DynamoDBReadPolicy:
            TableName: !Ref MyTable
      Events:
        Api:
          Type: Api
          Properties:
            Path: /orders
            Method: GET
```

SAM policy templates (e.g., `DynamoDBReadPolicy`) generate least-privilege IAM automatically.

## Anti-Patterns

| Anti-Pattern | Risk | Fix |
|-------------|------|-----|
| `DeletionPolicy: Delete` on RDS/S3 | Data loss on stack delete | Set `DeletionPolicy: Retain` |
| `NoEcho: false` on passwords | Secret exposure in console | Always `NoEcho: true` |
| Hardcoded account IDs | Breaks cross-account | Use `${AWS::AccountId}` |
| Hardcoded AMI IDs | Stale AMIs, region-specific | Use SSM dynamic reference |
| Circular `Fn::ImportValue` | Deployment deadlock | Use SSM Parameter Store |
| Template > 1MB | Deploy fails | Split into nested stacks |
| `!Join` for simple strings | Verbose | Use `!Sub` instead |
