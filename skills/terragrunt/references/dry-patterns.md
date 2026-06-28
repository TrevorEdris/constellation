# Terragrunt DRY Patterns

## Root `terragrunt.hcl` Inheritance

The root config is the single source of truth. All child units inherit via `find_in_parent_folders()`. One backend definition eliminates the most common source of copy-paste.

```hcl
# infrastructure/terragrunt.hcl  (root)
locals {
  account_id  = get_aws_account_id()
  aws_region  = get_env("AWS_REGION", "us-east-1")
  environment = element(split("/", path_relative_to_include()), 0)
  service     = element(split("/", path_relative_to_include()), 2)
}

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "myorg-tfstate-${local.account_id}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = local.aws_region
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.aws_region}"

  default_tags {
    tags = {
      Environment = "${local.environment}"
      ManagedBy   = "terragrunt"
      Service     = "${local.service}"
    }
  }
}
EOF
}

# Inputs available to all child units
inputs = {
  environment = local.environment
  account_id  = local.account_id
  aws_region  = local.aws_region
}
```

```hcl
# infrastructure/prod/us-east-1/api/terragrunt.hcl  (child unit)
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "git::https://github.com/myorg/terraform-modules.git//api-service?ref=v2.1.0"
}

inputs = {
  instance_count = 3
  instance_type  = "t3.large"
}
```

The child unit contributes zero backend config and zero provider config — the root handles both.

## Multiple `include` Blocks (v0.32+)

Use multiple includes to compose shared configs:

```hcl
# infrastructure/prod/us-east-1/api/terragrunt.hcl
include "root" {
  path = find_in_parent_folders("terragrunt.hcl")
}

include "networking" {
  path   = find_in_parent_folders("_shared/networking.hcl")
  expose = true  # Makes networking.locals available in this file
}

locals {
  # Consume exposed locals from the networking include
  vpc_id = include.networking.locals.vpc_id
}
```

## `generate` Blocks

Generate any Terraform file dynamically — eliminates per-module copy-paste:

```hcl
# Generate a versions.tf with consistent required_version
generate "versions" {
  path      = "versions.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
EOF
}
```

`if_exists` options:
- `overwrite_terragrunt` — Terragrunt manages the file; safe to overwrite
- `overwrite` — Always overwrite (even if manually edited)
- `skip` — Don't overwrite if file already exists
- `error` — Fail if file exists (useful to catch mistakes)

## `locals` for Shared Values

Use `locals` in root config to derive environment, region, and account from the directory path:

```hcl
locals {
  # Parse path: "prod/us-east-1/networking" -> ["prod", "us-east-1", "networking"]
  path_parts  = split("/", path_relative_to_include())
  environment = local.path_parts[0]
  region      = local.path_parts[1]
  service     = local.path_parts[2]

  # Account ID from environment lookup
  account_ids = {
    prod    = "111111111111"
    staging = "222222222222"
    dev     = "333333333333"
  }
  account_id = local.account_ids[local.environment]

  # Load environment-specific config from a YAML/JSON file
  env_config = yamldecode(file(find_in_parent_folders("env_config.yaml")))
}
```

## Shared `_shared/` Includes

```
infrastructure/
├── _shared/
│   ├── networking.hcl    # VPC IDs, subnet IDs per region
│   └── tagging.hcl       # Common tags (cost center, team)
├── terragrunt.hcl        # Root: backend + provider
└── prod/
    └── us-east-1/
        └── api/
            └── terragrunt.hcl
```

```hcl
# _shared/networking.hcl
locals {
  vpc_ids = {
    "us-east-1" = "vpc-0abc123"
    "eu-west-1" = "vpc-0def456"
  }
  vpc_id = local.vpc_ids[get_env("AWS_REGION", "us-east-1")]
}
```

## `read_terragrunt_config` for Cross-Hierarchy Values

```hcl
# Read a sibling or ancestor config's locals
locals {
  platform_config = read_terragrunt_config(find_in_parent_folders("platform.hcl"))
  cluster_name    = local.platform_config.locals.eks_cluster_name
}
```

## Useful Terragrunt Built-in Functions

| Function | Returns |
|----------|---------|
| `find_in_parent_folders("file.hcl")` | Absolute path to the nearest ancestor containing `file.hcl` |
| `path_relative_to_include()` | Relative path from root to current unit |
| `path_relative_from_include()` | Relative path from current unit to root |
| `get_parent_terragrunt_dir()` | Directory containing the parent config |
| `get_terragrunt_dir()` | Directory of the current `terragrunt.hcl` |
| `get_aws_account_id()` | Current AWS account ID (calls STS) |
| `get_env("VAR", "default")` | Environment variable with optional default |
| `run_cmd("cmd", "arg")` | Execute shell command and return output |
