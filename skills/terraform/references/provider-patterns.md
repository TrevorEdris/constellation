# Terraform Provider Patterns

## `required_providers` Block

Always declare `source` and `version` in `versions.tf`. Never rely on implicit resolution.

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.28"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}
```

## Version Constraint Operators

| Operator | Meaning | Example | Allows |
|----------|---------|---------|--------|
| `~> X.Y` | Pessimistic constraint | `~> 5.0` | `5.x`, not `6.0` |
| `~> X.Y.Z` | Patch-only | `~> 5.0.3` | `5.0.x`, not `5.1.0` |
| `>= X.Y` | Minimum | `>= 5.0` | Any version ≥ 5.0 |
| `= X.Y.Z` | Exact pin | `= 5.48.0` | Only 5.48.0 |

**Prefer `~> X.Y`** (minor pinning) for stability. Exact pins are acceptable when a bug in a specific version must be excluded.

## Provider Configuration

### Root Module Provider Block

```hcl
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "terraform"
      Team        = var.team
    }
  }
}
```

### Child Module Constraints

Child modules must NOT configure providers directly. They declare `configuration_aliases` to accept provider instances from the root:

```hcl
# In child module versions.tf
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws.primary, aws.replica]
    }
  }
}
```

## Multi-Region with Provider Aliases

```hcl
# Root module — define aliased providers
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "eu_west"
  region = "eu-west-1"
}

# Pass alias to module
module "eu_resources" {
  source = "./modules/app"

  providers = {
    aws = aws.eu_west
  }
}
```

## Multi-Account Pattern

Use `assume_role` with cross-account IAM roles — one provider block per account:

```hcl
provider "aws" {
  alias  = "production"
  region = "us-east-1"

  assume_role {
    role_arn     = "arn:aws:iam::PROD_ACCOUNT_ID:role/terraform-deployer"
    session_name = "terraform-apply"
  }
}

provider "aws" {
  alias  = "staging"
  region = "us-east-1"

  assume_role {
    role_arn     = "arn:aws:iam::STAGING_ACCOUNT_ID:role/terraform-deployer"
    session_name = "terraform-apply"
  }
}
```

## OIDC for CI Credentials

Never store long-lived AWS access keys in CI secrets. Use GitHub Actions OIDC:

```hcl
# Terraform side — trust the OIDC provider
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions_deployer" {
  name = "github-actions-terraform-deployer"

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
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:myorg/myrepo:*"
        }
      }
    }]
  })
}
```

```yaml
# GitHub Actions workflow side
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/github-actions-terraform-deployer
    aws-region: us-east-1
```

## Provider Caching (CI Performance)

Cache the provider plugin directory across CI runs:

```yaml
# GitHub Actions
- name: Cache Terraform providers
  uses: actions/cache@v4
  with:
    path: ~/.terraform.d/plugin-cache
    key: ${{ runner.os }}-terraform-${{ hashFiles('**/.terraform.lock.hcl') }}
```

```hcl
# ~/.terraformrc
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"
```
