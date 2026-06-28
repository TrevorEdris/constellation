# Terraform Security

## The Core Problem: Secrets in State

Terraform state is JSON. **Every resource attribute — including passwords, connection strings, and private keys — is stored in plaintext.** `sensitive = true` suppresses console output but does NOT encrypt state.

```bash
# Anyone with read access to state can extract secrets
cat terraform.tfstate | jq '.resources[].instances[].attributes.password'
```

**The correct pattern:** Never pass secrets as input variables. Reference them via data sources at apply time.

## Secrets Manager Integration

### AWS Secrets Manager

```hcl
# Retrieve secret at apply time — never stored as a variable value
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "/myapp/prod/db-password"
}

resource "aws_db_instance" "primary" {
  password = data.aws_secretsmanager_secret_version.db_password.secret_string
  # ...
}
```

### AWS SSM Parameter Store

```hcl
data "aws_ssm_parameter" "db_password" {
  name            = "/myapp/prod/db-password"
  with_decryption = true
}

resource "aws_db_instance" "primary" {
  password = data.aws_ssm_parameter.db_password.value
}
```

### HashiCorp Vault

```hcl
provider "vault" {
  address = "https://vault.example.com"
  # Auth via OIDC, AWS, or token
}

data "vault_generic_secret" "db" {
  path = "secret/myapp/prod/database"
}

resource "aws_db_instance" "primary" {
  password = data.vault_generic_secret.db.data["password"]
}
```

## Ephemeral Values (Terraform 1.10+)

Marks values that should never persist to state (e.g., short-lived tokens, session credentials):

```hcl
variable "bootstrap_token" {
  type      = string
  ephemeral = true
  # Value is used during apply but never written to state
}

ephemeral "aws_secretsmanager_secret_version" "deploy_key" {
  secret_id = "/deploy/ssh-key"
}
```

## Backend Encryption

| Cloud | Minimum | Production Recommended |
|-------|---------|----------------------|
| AWS S3 | `encrypt = true` (SSE-S3) | `kms_key_id` (SSE-KMS with CMEK) + access logging |
| GCS | Default GCS encryption | Customer-managed encryption keys (CMEK) |
| Azure Blob | Storage account encryption | Customer-managed keys via Key Vault |

Enable access logging on the state bucket. Apply SCPs or Organization Policies to prevent public access.

```hcl
# S3 backend with KMS
terraform {
  backend "s3" {
    bucket         = "myorg-tf-state-prod"
    key            = "api/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/abcd1234-..."
    dynamodb_table = "tf-state-lock"
  }
}
```

## Least-Privilege CI/CD Role

The CI/CD role should only have permissions needed to manage the specific resources in its Terraform workspace. Use IAM Access Analyzer to audit excess permissions.

```hcl
# Separate CI role per environment
resource "aws_iam_role" "terraform_ci_prod" {
  name = "terraform-ci-prod"

  # Trust only GitHub Actions OIDC for the main branch
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:sub" = "repo:myorg/myrepo:ref:refs/heads/main"
        }
      }
    }]
  })
}
```

## Scanning in CI

Run Checkov or tfsec/Trivy during the plan stage. Fail PRs on HIGH/CRITICAL findings.

```yaml
# GitHub Actions — Checkov
- name: Run Checkov
  uses: bridgecrewio/checkov-action@master
  with:
    directory: .
    framework: terraform
    halt_on_broken_checks: true
    check: CKV_HIGH,CKV_CRITICAL  # Only fail on high/critical

# OR — Trivy (unified scanner if already using for container images)
- name: Run Trivy
  uses: aquasecurity/trivy-action@master
  with:
    scan-type: config
    scan-ref: .
    exit-code: 1
    severity: HIGH,CRITICAL
```

## Variable Security Rules

```hcl
# Mark sensitive variables
variable "database_password" {
  type        = string
  description = "Password for the primary database instance."
  sensitive   = true
  # DO NOT provide a default — force explicit provision
}

# Mark sensitive outputs
output "connection_string" {
  value       = "postgresql://app:${var.database_password}@${aws_db_instance.primary.endpoint}/mydb"
  sensitive   = true
  description = "Full database connection string. Marked sensitive — will not appear in plan output."
}
```

## What `sensitive = true` Does NOT Do

- Does NOT encrypt state — value is plaintext in `terraform.tfstate`
- Does NOT prevent the value from being passed to providers
- Does NOT prevent the value from appearing in debug logs if `TF_LOG=DEBUG`

It only suppresses the value from appearing in `terraform plan` and `terraform apply` console output.

## Checkov Exemptions

When a check must be suppressed, document the exception inline:

```hcl
resource "aws_s3_bucket" "public_assets" {
  bucket = "myapp-public-assets"

  #checkov:skip=CKV_AWS_20:Public read access is intentional for CDN origin
  #checkov:skip=CKV_AWS_57:Public website hosting intentionally enabled
}
```

Always explain why the exception is safe. Alert on exceptions in PR reviews.

## IAM Policy Principles

```hcl
# Scope policies to specific resources, not wildcards
data "aws_iam_policy_document" "app_s3" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["arn:aws:s3:::myapp-data-${var.environment}/*"]
    # Not: ["arn:aws:s3:::*"]
  }
}

# Avoid AdministratorAccess and PowerUserAccess in application roles
# Avoid * on actions unless justified and documented
```
