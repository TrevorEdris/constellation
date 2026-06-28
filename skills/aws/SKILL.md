---
name: aws
description: "Use when working with AWS -- credentials/SSO setup, SDK usage (Go/Python/TypeScript/Rust), choosing an IaC tool, CLI workflows, S3, VPC, ECS, RDS, DynamoDB, IAM roles, boto3, aws configure."
user-invocable: true
argument-hint: "[setup|sdk|iac|s3|network|mcp]"
tags: [aws]
---

# AWS

General-purpose AWS patterns: credential chain, SDK idioms across four languages, IaC tool selection, CLI workflows, and MCP server setup.

---

## When to Use

- Setting up AWS credentials or SSO for local development
- Choosing between CDK, SAM, CloudFormation, or Terraform
- Writing SDK code in Go, Python, TypeScript, or Rust
- Working with S3, VPC, ECS, RDS, or DynamoDB
- Configuring AWS MCP servers in Claude Code or Cursor
- Getting started with a new AWS project

**For deeper topics:** `/aws-serverless` (Lambda, Step Functions, EventBridge, SQS) | `/aws-iam` (IAM policy design, Secrets Manager, KMS)

---

## Quick Start

```
/aws setup      # Credential chain, SSO login, profile configuration
/aws sdk        # SDK patterns for your language (auto-detected)
/aws iac        # IaC decision tree → recommended tool + starter config
/aws s3         # S3 patterns: presigned URLs, lifecycle, versioning, CORS
/aws network    # VPC, subnets, security groups, VPC endpoints
/aws mcp        # AWS MCP server setup and IAM requirements
```

No argument: detects project language via `go.mod` / `package.json` / `pyproject.toml` / `Cargo.toml` and opens the matching SDK reference.

---

## Context

PROJECT FILES:
```
!`ls go.mod package.json pyproject.toml Cargo.toml 2>/dev/null; ls -la ~/.aws/config 2>/dev/null | head -3; aws configure list 2>/dev/null`
```

---

## Mode: setup

Configure AWS credentials securely for local development.

**Credential chain order (all SDKs follow this):**
1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
2. Shared credentials file (`~/.aws/credentials`)
3. AWS SSO / OIDC token cache (`~/.aws/sso/cache/`)
4. IAM role via IMDS (EC2 instance profile) or ECS task role or Lambda execution role

**SSO Setup (recommended for humans):**
```bash
aws configure sso
# Prompts for: SSO start URL, SSO region, account, role, output format, profile name

aws sso login --profile my-profile
# Opens browser for PKCE auth flow; tokens cached in ~/.aws/sso/cache/

export AWS_PROFILE=my-profile
# Or pass --profile my-profile to every CLI call
```

**Anti-patterns to avoid:**
- Hardcoding `AWS_ACCESS_KEY_ID` in source code or Dockerfiles
- Using long-lived IAM user keys instead of SSO or roles
- Sharing credentials files between CI and local dev
- Running `aws sts get-session-token` in Lambda (Lambda already has session credentials)

Reference: `references/credential-patterns.md`

---

## Mode: sdk

SDK quick reference by language. Auto-detects from project files; override by naming the language.

### Go (aws-sdk-go-v2)

```go
import (
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

cfg, err := config.LoadDefaultConfig(ctx) // Always pass context
if err != nil { return fmt.Errorf("load aws config: %w", err) }
client := s3.NewFromConfig(cfg)
```

Key rules:
- Always pass `context.Context` — enables cancellation and timeouts
- Use `errors.As` with `smithy.APIError` or typed service errors (e.g., `*types.NoSuchKeyException`)
- Use `NewListXxxPaginator` paginators — never hand-roll `NextToken` loops
- Never create a new client per request; create once and reuse
- v1 (`session.NewSession`) is legacy — use v2 in all new code

Reference: `references/aws-sdk-go.md`

### Python (boto3)

```python
import boto3
from botocore.exceptions import ClientError

client = boto3.client('s3', region_name='us-east-1')

try:
    response = client.get_object(Bucket='my-bucket', Key='my-key')
except ClientError as e:
    code = e.response['Error']['Code']
    if code == 'NoSuchKey':
        raise KeyError(f"Object not found") from e
    raise
```

Key rules:
- Always pass `region_name` explicitly — never rely on default region ambiguity
- Catch `ClientError`, not bare `Exception`
- Use `client.get_paginator('list_objects_v2').paginate(...)` for paginated APIs
- Use `aioboto3` in async contexts — standard boto3 is blocking and will stall event loops
- `boto3.resource` obscures errors — prefer `boto3.client`

Reference: `references/aws-sdk-python.md`

### TypeScript / Node.js (@aws-sdk v3)

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { ServiceException } from "@aws-sdk/smithy-client";

const client = new S3Client({ region: process.env.AWS_REGION });

try {
  const response = await client.send(new GetObjectCommand({ Bucket, Key }));
} catch (err) {
  if (err instanceof ServiceException) {
    console.error(err.name, err.message);
  }
  throw err;
}
```

Key rules:
- Import per-service packages (`@aws-sdk/client-s3`) — tree-shakeable, reduces bundle size
- Check `err.name` for specific error codes; `instanceof ServiceException` is the base class
- Do NOT use the v2 SDK (`aws-sdk`) in new projects — EOL announced for 2025
- Bundling the full v2 SDK into Lambda quadruples cold start time
- Set `maxAttempts` for services with transient failures (DynamoDB, SQS)

Reference: `references/aws-sdk-typescript.md`

### Rust (aws-sdk-rust)

```rust
use aws_config::BehaviorVersion;
use aws_sdk_s3::Client;

let config = aws_config::defaults(BehaviorVersion::latest())
    .load()
    .await;
let client = Client::new(&config);
```

Key rules:
- Always call `BehaviorVersion::latest()` — required since SDK 1.x
- `tokio` is the only supported async runtime
- Match on `SdkError<ServiceError>`; call `.into_service_error()` for typed errors
- Never `block_on` inside async tasks
- SDK reached GA in 2023 but has fewer community examples than Go/Python/JS

Reference: `references/aws-sdk-rust.md`

---

## Mode: iac

### IaC Decision Tree

```
Does this project span multiple cloud providers or use significant non-AWS infra?
  YES → Terraform
  NO  → Is this primarily serverless (Lambda + API Gateway + SQS)?
          YES → SAM (simple/small) or CDK (complex/reusable)
          NO  → Does your team prefer code over YAML?
                  YES → CDK (TypeScript or Python — largest community)
                  NO  → CloudFormation (or CDK synth output for existing CF stacks)
```

Note: CDKTF (CDK for Terraform) was deprecated by HashiCorp in December 2025 — do not use in new projects.

### Tool Quick Reference

| Tool | Best For | CLI |
|------|----------|-----|
| **CDK** (TypeScript/Python) | Complex infra, reusable constructs, code-first teams | `cdk synth`, `cdk diff`, `cdk deploy` |
| **SAM** | Lambda-first projects, local invocation testing | `sam build`, `sam local invoke`, `sam deploy --guided` |
| **CloudFormation** | Existing CF stacks, minimal tooling overhead | `aws cloudformation deploy` |
| **Terraform** | Multi-cloud, existing TF investment, large teams | `terraform init && terraform plan && terraform apply` |

**CDK workflow:**
```bash
cdk bootstrap aws://ACCOUNT/REGION   # One-time per account/region
cdk init app --language typescript
cdk diff                              # Preview changes
cdk deploy --hotswap                  # Dev only — skips CloudFormation for Lambda/ECS
cdk destroy                           # Tear down
```

Reference: `references/iac-decision-tree.md`

---

## Mode: s3

### Core Operations

```python
# Presigned URL (temporary access without credentials)
url = client.generate_presigned_url(
    'get_object',
    Params={'Bucket': bucket, 'Key': key},
    ExpiresIn=3600  # seconds
)

# Multipart upload for files >100MB
mpu = client.create_multipart_upload(Bucket=bucket, Key=key)
# ... upload parts ...
client.complete_multipart_upload(...)
```

### Key Decisions

| Decision | Recommendation |
|----------|---------------|
| Bucket naming | Globally unique; use account ID or project prefix; no dots (TLS wildcard issues) |
| Versioning | Enable on all non-temporary buckets; protects against accidental deletes |
| Encryption | SSE-S3 default; SSE-KMS for compliance or key management requirements |
| Public access | Block all public access at account level; use presigned URLs for sharing |
| Lifecycle | Set expiration on logs/temp buckets; intelligent-tiering for archival |

Reference: `references/s3-patterns.md`

---

## Mode: network

### VPC Fundamentals

| Component | Default | Recommendation |
|-----------|---------|----------------|
| CIDR | 172.31.0.0/16 (default VPC) | /16 for new VPCs; /24 subnets per AZ |
| Subnets | 3 AZs, public only | Add private subnets for compute; isolated for DBs |
| NAT Gateway | None | One per AZ (HA) or one shared (cost-optimized dev) |
| Security Groups | Allow all outbound | Principle of least privilege on both directions |
| VPC Endpoints | None | Add for S3, DynamoDB, Secrets Manager to avoid NAT cost |

**Security group design principles:**
- Reference security groups by ID, not CIDR, for intra-VPC rules
- Never use `0.0.0.0/0` for inbound except on internet-facing load balancers
- Create separate SGs per tier: ALB, app, database
- RDS/Aurora: only allow inbound from the app-tier SG, not a CIDR

Reference: `references/vpc-networking.md`

---

## Mode: mcp

### Official awslabs MCP Servers

All official servers use the ambient credential chain (no credential embedding). Transport: stdio only (SSE removed May 2025).

| Server | Install | Best For |
|--------|---------|----------|
| AWS Documentation | `uvx awslabs.aws-documentation-mcp-server` | Full-text AWS docs search |
| AWS IaC | `uvx awslabs.aws-iac-mcp-server` | CDK/CloudFormation validation, deployment troubleshooting |
| AWS Serverless | `uvx awslabs.aws-serverless-mcp-server` | SAM CLI, Lambda/API GW/Step Functions guidance |
| Amazon ECS | `uvx awslabs.ecs-mcp-server` | ECS deployments, ECR push, ALB provisioning |
| CloudWatch | `uvx awslabs.cloudwatch-mcp-server` | Log Insights, alarms, root cause analysis |
| AWS Cost Explorer | `uvx awslabs.cost-explorer-mcp-server` | Cost/usage queries ($0.01/request — budget carefully) |

Full setup configs: `assets/mcp-config-examples/`

**Security checklist:**
- Grant only the IAM actions documented by each server
- `ccapi-mcp-server` has wide blast radius — scope with `aws:RequestedRegion` condition
- Cost Explorer MCP costs $0.01/invocation — restrict to non-prod or monitor with Cost Anomaly Detection
- Community CLI-passthrough servers (RafalWilinski, alexei-led) have shell-equivalent access — evaluate carefully

Reference: `references/mcp-setup.md`

---

## Cross-References

| Topic | Skill |
|-------|-------|
| Lambda, Step Functions, EventBridge, SQS/SNS | `/aws-serverless` |
| IAM policy design, Secrets Manager, KMS | `/aws-iam` |
| CloudWatch, X-Ray, OTel instrumentation | `observability` skill |
| CodePipeline, CodeBuild, GitHub Actions OIDC for AWS | `cicd-pipeline` skill |
| Go error handling patterns (`errors.As`, wrapping) | `go-patterns` skill |
| DynamoDB/RDS schema design | `database-schema-designer` skill |
