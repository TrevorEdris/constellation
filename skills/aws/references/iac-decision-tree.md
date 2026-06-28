# IaC Decision Tree — AWS

Choose the right IaC tool before writing any infrastructure code.

---

## Decision Tree

```
Does this project span multiple cloud providers, or reuse an existing Terraform estate?
  YES → Terraform
  NO  → Is this primarily serverless (Lambda + API Gateway + SQS/SNS/EventBridge)?
          YES → Is the project small/simple (< 5 Lambda functions, single team)?
                  YES → SAM
                  NO  → CDK
          NO  → Does your team prefer writing code over YAML?
                  YES → CDK (TypeScript or Python — largest community and construct library)
                  NO  → CloudFormation (or SAM for simpler stacks)
```

Note: CDKTF (CDK for Terraform) was deprecated by HashiCorp in December 2025. Do not use in new projects.

---

## Tool Comparison

| Feature | CDK | SAM | CloudFormation | Terraform |
|---------|-----|-----|---------------|-----------|
| Language | TypeScript, Python, Java, Go, .NET | YAML/JSON | YAML/JSON | HCL |
| Abstraction | High (L2/L3 constructs) | Medium (serverless shortcuts) | Low (raw resources) | Medium |
| Local testing | `cdk synth` | `sam local invoke` | No | `terraform plan` |
| Multi-cloud | AWS only | AWS only | AWS only | Yes |
| State management | CloudFormation stacks | CloudFormation stacks | S3 backend optional | Remote state required |
| Drift detection | Via CloudFormation | Via CloudFormation | Native | `terraform plan` |
| Ecosystem | Construct Hub (1000+ L3) | SAM templates | CloudFormation registry | Registry (2000+ providers) |
| Learning curve | Medium | Low | Medium | Medium |

---

## CDK

Best for teams that prefer code and need reusable, composable infrastructure.

```bash
# Bootstrap (one-time per account/region)
cdk bootstrap aws://ACCOUNT_ID/REGION

# Initialize a new app
cdk init app --language typescript

# Preview changes
cdk diff

# Deploy
cdk deploy

# Deploy without CloudFormation (Lambda/ECS hotswap — dev only)
cdk deploy --hotswap

# Destroy
cdk destroy
```

### CDK Construct Levels

- **L1 (Cfn*)**: 1:1 CloudFormation resource mapping — verbose but total control
- **L2**: Curated with sensible defaults and convenience methods — use by default
- **L3 (Patterns)**: Opinionated multi-resource patterns (e.g., `ApplicationLoadBalancedFargateService`)

### CDK Project Structure

```
my-cdk-app/
├── bin/my-app.ts          # Entry point — instantiate Stacks
├── lib/
│   ├── my-app-stack.ts   # Primary Stack definition
│   └── constructs/       # Reusable custom constructs
├── test/                 # jest snapshot + assertion tests
├── cdk.json              # CDK app config + context values
└── cdk.out/              # Synthesized CloudFormation (gitignore)
```

---

## SAM

Best for Lambda-first projects where local testing and simplicity matter.

```bash
# Initialize from template
sam init

# Build (compiles, packages dependencies)
sam build

# Local invoke (requires Docker)
sam local invoke MyFunction --event events/api.json
sam local start-api

# Deploy interactively (first deploy)
sam deploy --guided

# Subsequent deploys
sam deploy

# Sync code changes without full CloudFormation deploy (dev only)
sam sync --watch
```

### SAM Template Shorthand

```yaml
# SAM template is an extension of CloudFormation
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: python3.12
    MemorySize: 256
    Timeout: 30
    Tracing: Active
    Environment:
      Variables:
        LOG_LEVEL: INFO

Resources:
  MyApi:
    Type: AWS::Serverless::HttpApi

  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref MyApi
            Path: /items/{id}
            Method: GET
```

---

## Terraform for AWS

Best when the team has existing Terraform investment or workloads span multiple clouds.

```hcl
# provider.tf
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "my-tf-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}
```

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
terraform destroy
```

**AWS-specific Terraform considerations:**
- Use remote state (S3 + DynamoDB lock) — never commit `.tfstate` files
- Use `aws_caller_identity` data source to avoid hardcoding account IDs
- IAM policy documents: use `aws_iam_policy_document` data source (not inline JSON)
- Module registry: `hashicorp/vpc`, `hashicorp/eks`, `hashicorp/rds` for common patterns

---

## CloudFormation

Use when the team is already deep in CloudFormation, for minimal tooling overhead, or for managing existing CF stacks.

```bash
aws cloudformation deploy \
  --template-file template.yaml \
  --stack-name my-stack \
  --parameter-overrides Env=prod \
  --capabilities CAPABILITY_IAM

aws cloudformation describe-stack-events --stack-name my-stack
```

**Useful features:**
- Change sets: preview before applying (`aws cloudformation create-change-set`)
- Stack policies: prevent accidental deletion/replacement of critical resources
- Drift detection: `aws cloudformation detect-stack-drift --stack-name my-stack`
- StackSets: deploy to multiple accounts/regions from one template

---

## When to Migrate Between Tools

| Situation | Action |
|-----------|--------|
| CDK team adopts Terraform | Use `cdk synth` output as a migration reference; rewrite incrementally |
| CloudFormation → CDK | `cdk migrate --from-path template.yaml` (experimental; review output carefully) |
| SAM → CDK | SAM constructs available in `@aws-cdk/aws-sam`; or rewrite using CDK Lambda constructs |
| Multi-team CDK | Extract shared constructs to a private Construct Hub or npm package |
