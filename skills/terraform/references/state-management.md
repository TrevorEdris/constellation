# Terraform State Management

## Remote Backend Always

Local state is dev-only. Use remote backends for all shared environments.

| Cloud | Backend | Lock Mechanism |
|-------|---------|---------------|
| AWS | S3 | DynamoDB table |
| GCP | GCS | Native GCS locking |
| Azure | Azure Blob | Native blob leasing |

### AWS S3 + DynamoDB

```hcl
terraform {
  backend "s3" {
    bucket         = "myorg-terraform-state-prod"
    key            = "services/api/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/my-key-id"
    dynamodb_table = "terraform-state-lock"
  }
}
```

DynamoDB table requirements: partition key `LockID` (String), on-demand or provisioned billing.

### GCP GCS

```hcl
terraform {
  backend "gcs" {
    bucket = "myorg-terraform-state"
    prefix = "services/api"
  }
}
```

GCS uses native object locking — no separate lock table needed.

### Azure Blob

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "myorgtfstate"
    container_name       = "tfstate"
    key                  = "services/api.tfstate"
  }
}
```

## State Per Environment

Use separate state files per environment. **Never share state across environments.**

```
# Separate backends — correct
s3://myorg-tf-state/dev/api/terraform.tfstate
s3://myorg-tf-state/staging/api/terraform.tfstate
s3://myorg-tf-state/prod/api/terraform.tfstate
```

Achieved with:
- **Folder-per-environment:** Separate directories with distinct backend config
- **Backend config files:** `terraform init -backend-config=env/prod.hcl`
- **Terragrunt:** Automatic path-based state keys (see `/terragrunt` skill)

## Workspaces Are Not Environments

| Feature | Workspaces | Folder-per-Env |
|---------|-----------|----------------|
| Backend config | Shared across workspaces | Separate per folder |
| State isolation | Partial (separate state per workspace) | Complete |
| Risk of cross-env apply | High (easy to switch workspace) | Low |
| Recommended for | Ephemeral stacks (PR previews, feature branches) | prod/staging/dev |

```bash
# Workspaces OK for ephemeral stacks
terraform workspace new pr-123
terraform workspace select pr-123

# NOT for production environments
# Use folder-per-environment instead
```

## Backend Encryption

| Cloud | Minimum | Recommended |
|-------|---------|-------------|
| AWS S3 | `encrypt = true` (SSE-S3) | `kms_key_id` (SSE-KMS with CMEK) |
| GCS | Default GCS encryption | Customer-managed keys (CMEK) |
| Azure Blob | Storage account encryption | Customer-managed keys |

Enable access logging on the state bucket. The bucket itself should have public access blocked.

## State Access Least Privilege

The CI/CD role should only:
- Read/write state objects in the bucket
- Get/put/delete DynamoDB lock items

It should NOT have:
- IAM admin rights
- Ability to delete the bucket or DynamoDB table
- Access to state files for other environments

### Minimal AWS IAM for CI State Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::myorg-tf-state/services/api/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::myorg-tf-state",
      "Condition": {"StringLike": {"s3:prefix": ["services/api/*"]}}
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/terraform-state-lock"
    }
  ]
}
```

## `.terraform.lock.hcl`

Always commit the lock file. It pins provider versions, preventing surprise upgrades across machines and CI environments.

```bash
# Update lock file for specific platforms (useful in CI that differs from dev OS)
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64
```

## `terraform_remote_state` for Cross-Stack Sharing

```hcl
data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "myorg-tf-state"
    key    = "networking/terraform.tfstate"
    region = "us-east-1"
  }
}

# Consume a specific output
resource "aws_instance" "app" {
  subnet_id = data.terraform_remote_state.networking.outputs.private_subnet_id
}
```

Best practice: expose only what callers need in outputs. Over-exposing entire state creates tight coupling.

## State File Anti-Patterns

| Anti-Pattern | Risk | Fix |
|-------------|------|-----|
| Local state on dev machine | Lost on disk wipe; unshared; unencrypted | Remote backend from day one |
| Single state for all services | One error blocks all changes; massive blast radius | Separate state per service boundary |
| Workspace per prod environment | Shared backend config; accidental cross-env apply risk | Folder-per-environment |
| Storing secrets as variables | All resource attributes in state are plaintext JSON | Reference via secrets manager data source |
