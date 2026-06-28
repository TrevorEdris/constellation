# Terraform Resource Patterns

## `for_each` vs `count`

**Default to `for_each`.** Use `count` only for truly homogeneous, ordered lists where removal from the end is safe.

### Why `for_each` Is Safer

```hcl
# count — index-based addressing
resource "aws_iam_user" "team" {
  count = length(var.users)
  name  = var.users[count.index]
}
# If "alice" is removed from the middle of the list,
# Terraform destroys and recreates every resource after it.

# for_each — key-based addressing
resource "aws_iam_user" "team" {
  for_each = toset(var.users)
  name     = each.key
}
# Removing "alice" destroys only aws_iam_user.team["alice"].
```

### `for_each` with `map(object)`

```hcl
variable "buckets" {
  type = map(object({
    versioning = bool
    lifecycle  = optional(bool, true)
  }))
}

resource "aws_s3_bucket" "data" {
  for_each = var.buckets
  bucket   = each.key
}

resource "aws_s3_bucket_versioning" "data" {
  for_each = var.buckets
  bucket   = aws_s3_bucket.data[each.key].id

  versioning_configuration {
    status = each.value.versioning ? "Enabled" : "Disabled"
  }
}
```

## Dynamic Blocks

Use for optional repeated nested blocks. Avoid deep nesting — extract to a variable instead.

```hcl
variable "ingress_rules" {
  type = list(object({
    port        = number
    cidr_blocks = list(string)
    description = string
  }))
  default = []
}

resource "aws_security_group" "app" {
  name   = "app-sg"
  vpc_id = var.vpc_id

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = ingress.value.cidr_blocks
      description = ingress.value.description
    }
  }
}
```

## `lifecycle` Rules

```hcl
resource "aws_db_instance" "primary" {
  # ... resource config ...

  lifecycle {
    # Prevent accidental deletion of production databases
    prevent_destroy = true

    # Ignore tag changes set by external CMDB
    ignore_changes = [tags["LastModifiedBy"], tags["CostCenter"]]

    # Avoid downtime when changing instance class
    create_before_destroy = true
  }
}
```

| Rule | When to Use |
|------|-------------|
| `prevent_destroy = true` | Stateful resources: RDS, S3, ElastiCache, Elasticsearch |
| `create_before_destroy = true` | Resources that cause downtime when replaced: instances, certificates, ELBs |
| `ignore_changes` | Attributes managed externally (tags by CMDB, instance count by autoscaling) |

## `moved` Blocks for Safe Refactoring

When renaming or restructuring resources in state, use `moved` blocks instead of `terraform state mv`. They are declarative, reviewable, and version-controlled.

```hcl
# Scenario: renaming a resource
moved {
  from = aws_s3_bucket.data_lake
  to   = aws_s3_bucket.analytics_store
}

# Scenario: migrating from count to for_each
moved {
  from = aws_iam_user.team[0]
  to   = aws_iam_user.team["alice"]
}

moved {
  from = aws_iam_user.team[1]
  to   = aws_iam_user.team["bob"]
}

# Scenario: extracting resource into a module
moved {
  from = aws_instance.web
  to   = module.web_server.aws_instance.this
}
```

After the refactoring is applied to all states, `moved` blocks can be removed from the code. Keep them for at least one release cycle so callers have time to apply.

## Data Sources

```hcl
# Reference existing infrastructure not managed by this state
data "aws_vpc" "existing" {
  tags = {
    Name = "production-vpc"
  }
}

resource "aws_subnet" "app" {
  vpc_id     = data.aws_vpc.existing.id
  cidr_block = "10.0.10.0/24"
}

# Data sources with depends_on run during plan
data "aws_ssm_parameter" "db_password" {
  name = "/myapp/prod/db-password"

  depends_on = [aws_ssm_parameter.db_password]
}
```

## Avoiding `-target` in Production

`-target` is a break-glass escape hatch. It leaves state partially applied and inconsistent.

```bash
# Acceptable — emergency fix of a single broken resource
terraform apply -target=aws_lambda_function.processor

# Not acceptable — routine workflow
# Never use -target for normal deployments or to avoid planning the full graph
```

If you use `-target` in an emergency, document why in a comment or runbook and schedule a full `terraform apply` to reconcile state.

## Expressions and Locals

Use `locals` to name complex expressions. Avoid deeply nested expressions inline.

```hcl
locals {
  # Build tag map once, reuse across resources
  common_tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    Module      = "networking"
  })

  # Derive values from input
  private_subnet_cidrs = [
    for i, az in var.availability_zones :
    cidrsubnet(var.vpc_cidr, 8, i)
  ]
}
```

## Conditional Resources

```hcl
# Create resource only when condition is true
resource "aws_cloudwatch_log_group" "app" {
  count             = var.enable_logging ? 1 : 0
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 14
}

# Conditional reference
locals {
  log_group_arn = var.enable_logging ? aws_cloudwatch_log_group.app[0].arn : null
}
```

Prefer `for_each = var.enable_x ? toset(["enabled"]) : toset([])` over `count = var.enable_x ? 1 : 0` when the resource is referenced by key in other resources — avoids index-shift issues.
