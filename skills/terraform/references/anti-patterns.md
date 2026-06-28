# Terraform Anti-Patterns

## The Terralith (Monolithic State)

**Problem:** One root module manages every service, team, and environment. A single error blocks all other changes. Plans are slow. Blast radius is company-wide.

**Signs:**
- `terraform.tfstate` with 300+ resources
- `main.tf` with 2000+ lines
- Every team runs `terraform apply` in the same directory
- `terraform plan` takes 10+ minutes

**Fix:** Split by service boundary or team ownership with separate state files.

```
# Before: one monolith
infra/
└── main.tf  # 3000 lines

# After: split by service
infra/
├── networking/     # VPC, subnets, routing
├── platform/       # EKS, RDS, ElastiCache
├── api-service/    # App-specific resources
└── data-pipeline/  # Analytics resources
```

## Hardcoded Values

**Problem:** Account IDs, ARNs, CIDRs, and region strings hardcoded in `.tf` files break reuse across environments and accounts.

```hcl
# Wrong
resource "aws_iam_role_policy_attachment" "app" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::123456789012:policy/MyPolicy"  # hardcoded account
}

resource "aws_security_group_rule" "allow_office" {
  cidr_blocks = ["203.0.113.0/24"]  # hardcoded CIDR
}

# Correct
data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy_attachment" "app" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/MyPolicy"
}

variable "office_cidr" {
  type        = string
  description = "CIDR block for office IP range."
}
```

## Local State (No Backend)

**Problem:** State on a developer's machine is unshared, unencrypted, and lost on disk wipe. Concurrent applies corrupt state with no lock mechanism.

```hcl
# Wrong — no backend block
terraform {}

# Correct — remote backend from day one
terraform {
  backend "s3" {
    bucket         = "myorg-tf-state"
    key            = "api/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "tf-state-lock"
  }
}
```

## Unversioned Modules

**Problem:** Modules pinned to a branch receive breaking changes without any gate. All callers are affected simultaneously.

```hcl
# Wrong — unversioned
module "vpc" {
  source = "git::https://github.com/org/terraform-aws-vpc.git?ref=main"
}

# Wrong — semver constraint too loose
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = ">= 5.0"
}

# Correct — exact tag
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.3"
}
```

## `count` for Heterogeneous Resources

**Problem:** When an element is removed from the middle of a `count`-based list, Terraform destroys and recreates every resource at an index >= the removed element.

```hcl
# Wrong — count with a list
resource "aws_iam_user" "team" {
  count = length(var.users)
  name  = var.users[count.index]
}
# Removing "alice" (index 0) shifts bob -> index 0, carol -> index 1
# Terraform destroys bob and carol, then recreates them

# Correct — for_each with a set
resource "aws_iam_user" "team" {
  for_each = toset(var.users)
  name     = each.key
}
# Removing "alice" only affects aws_iam_user.team["alice"]
```

## `depends_on` Overuse

**Problem:** Explicit `depends_on` serializes what could be parallel. It often reflects a missing implicit reference. Heavy `depends_on` usage is a code smell.

```hcl
# Wrong — depends_on where implicit reference exists
resource "aws_instance" "app" {
  subnet_id = var.subnet_id
  depends_on = [aws_subnet.app]  # unnecessary — use the reference
}

# Correct — use attribute reference (creates implicit dependency)
resource "aws_instance" "app" {
  subnet_id = aws_subnet.app.id  # implicit dependency on aws_subnet.app
}

# Acceptable — true side-effect dependency (document it)
resource "aws_iam_role_policy_attachment" "app" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.app.arn

  depends_on = [aws_iam_policy.app]
  # explicit because policy propagation sometimes lags attachment
}
```

## Secrets as Input Variables

**Problem:** Secrets passed as variable values land in state files and plan files in plaintext.

```hcl
# Wrong — secret as variable
variable "db_password" {
  default = "SuperSecret123!"  # Plaintext in state
}

# Also wrong — passing via -var flag (appears in shell history and plan)
# terraform apply -var="db_password=SuperSecret123!"

# Correct — retrieve at apply time via data source
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "/myapp/prod/db-password"
}
```

## `terraform workspace` for Environments

**Problem:** Workspaces share a single backend configuration. It's easy to accidentally apply prod changes when a workspace is misconfigured or the wrong one is selected.

```bash
# Dangerous — easy to forget which workspace is active
terraform workspace select prod
terraform apply  # Could be staging data + prod state

# Correct — separate directories with separate backends
cd environments/prod
terraform apply  # Unambiguous
```

Workspaces are appropriate for: ephemeral PR environments, feature branches, short-lived test stacks.

## `-target` as a Workflow Tool

**Problem:** `-target` leaves state partially applied. Applying with `-target` repeatedly leads to state drift that is difficult to detect and correct.

```bash
# Wrong — using -target routinely
terraform apply -target=aws_lambda_function.processor

# Correct — apply the full plan
terraform apply

# -target is acceptable ONLY as a break-glass tool in an emergency.
# If used, schedule a full apply immediately after to reconcile state.
```

## `sensitive = true` as Encryption

**Problem:** `sensitive = true` suppresses console output only. State JSON still contains the plaintext value.

```hcl
# Misconception — this does NOT encrypt state
variable "db_password" {
  type      = string
  sensitive = true
}

# State still contains:
# "password": "SuperSecret123!"

# Correct — use secrets manager as source of truth
data "aws_secretsmanager_secret_version" "db" {
  secret_id = "/myapp/prod/db-password"
}
```

## `type = any`

**Problem:** `type = any` disables type checking, allowing invalid values to reach resources and generate confusing errors at apply time.

```hcl
# Wrong
variable "config" {
  type = any
}

# Correct — explicit object type
variable "config" {
  type = object({
    instance_type = string
    min_size      = number
    max_size      = number
    tags          = optional(map(string), {})
  })
}
```
