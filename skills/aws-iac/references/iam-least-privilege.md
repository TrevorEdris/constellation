# IAM Least Privilege Reference

## Principles

1. **Minimum required actions** — Enumerate specific actions; never allow `*`
2. **Resource-scoped** — Restrict to specific ARNs; avoid `Resource: "*"` unless the action truly requires it (e.g., `iam:ListRoles`)
3. **Condition keys** — Add `aws:RequestedRegion`, `aws:SourceAccount`, or `aws:SourceArn` to scope further
4. **IAM Access Analyzer** — Use to validate policies against actual usage before lock-down

## IAM Role for CloudFormation Execution

```yaml
Resources:
  CfnExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub "${AWS::StackName}-cfn-execution-role"
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: cloudformation.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: CfnPermissions
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              # Scope to the specific resources this stack manages
              - Effect: Allow
                Action:
                  - s3:CreateBucket
                  - s3:DeleteBucket
                  - s3:PutBucketPolicy
                  - s3:PutBucketVersioning
                  - s3:PutBucketEncryption
                Resource: !Sub "arn:aws:s3:::${AWS::StackName}-*"
```

## Lambda Execution Role Patterns

```yaml
OrdersFunctionRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Effect: Allow
          Principal:
            Service: lambda.amazonaws.com
          Action: sts:AssumeRole
    ManagedPolicyArns:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      # Add VPC access if Lambda is in a VPC:
      # - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
    Policies:
      - PolicyName: DynamoDBAccess
        PolicyDocument:
          Version: "2012-10-17"
          Statement:
            - Effect: Allow
              Action:
                - dynamodb:GetItem
                - dynamodb:PutItem
                - dynamodb:UpdateItem
                - dynamodb:DeleteItem
                - dynamodb:Query
              Resource:
                - !GetAtt OrdersTable.Arn
                - !Sub "${OrdersTable.Arn}/index/*"  # For GSI queries
```

## CDK L2 Grant Methods

CDK L2 constructs provide `grant*` methods that generate least-privilege policies automatically:

```typescript
const bucket = new s3.Bucket(this, 'AppData');
const table = new dynamodb.Table(this, 'Orders', { ... });
const fn = new lambda.Function(this, 'Handler', { ... });

// Grant specific access — generates minimum policy
bucket.grantRead(fn);                    // s3:GetObject, s3:ListBucket
bucket.grantReadWrite(fn);              // + s3:PutObject, s3:DeleteObject
bucket.grantPut(fn);                    // s3:PutObject only
table.grantReadData(fn);                // dynamodb:GetItem, Query, Scan
table.grantReadWriteData(fn);           // + PutItem, UpdateItem, DeleteItem

// Cross-account grants
bucket.grantRead(new iam.AccountPrincipal('123456789012'));
```

## OIDC for CI/CD (No Long-Lived Credentials)

Federate GitHub Actions with AWS via OIDC — no IAM access keys needed:

```yaml
Resources:
  GitHubOIDCProvider:
    Type: AWS::IAM::OIDCProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList:
        - sts.amazonaws.com
      ThumbprintList:
        - 6938fd4d98bab03faadb97b34396831e3780aea1

  GitHubActionsRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Federated: !Ref GitHubOIDCProvider
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringLike:
                token.actions.githubusercontent.com:sub: "repo:my-org/my-repo:*"
              StringEquals:
                token.actions.githubusercontent.com:aud: sts.amazonaws.com
```

In GitHub Actions:
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
      aws-region: us-east-1
```

## Resource-Based Policies

Some resources use resource-based policies in addition to IAM roles:

```yaml
# S3 Bucket Policy — enforce TLS and restrict to specific role
BucketPolicy:
  Type: AWS::S3::BucketPolicy
  Properties:
    Bucket: !Ref MyBucket
    PolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Sid: DenyNonTLS
          Effect: Deny
          Principal: "*"
          Action: s3:*
          Resource:
            - !GetAtt MyBucket.Arn
            - !Sub "${MyBucket.Arn}/*"
          Condition:
            Bool:
              aws:SecureTransport: false
```

## Actions That Require `Resource: "*"`

Some IAM actions cannot be scoped to a specific resource (AWS limitation):

```yaml
# These legitimately require Resource: "*"
Statement:
  - Effect: Allow
    Action:
      - ec2:DescribeVpcs
      - ec2:DescribeSubnets
      - ec2:DescribeSecurityGroups
      - iam:ListRoles
      - iam:GetAccountSummary
      - cloudformation:ListStacks
    Resource: "*"  # AWS does not support resource-level for these Describe/List actions
```

Always comment `Resource: "*"` with a justification.

## Common Over-Privilege Patterns to Fix

| Over-Privilege | Correct Fix |
|---------------|-------------|
| `s3:*` on `*` | Enumerate `s3:GetObject`, `s3:PutObject` etc. on specific bucket ARN |
| `dynamodb:*` on `*` | Enumerate read/write actions on specific table + GSI ARNs |
| `secretsmanager:*` | Use `secretsmanager:GetSecretValue` on specific secret ARN |
| `logs:*` | Use `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` |
| `kms:*` | Use `kms:GenerateDataKey`, `kms:Decrypt` on specific key ARN |
