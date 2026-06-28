# Terragrunt Dependency Management

## `dependency` Block

Declares a reference to another unit's outputs. Reads that unit's remote state directly — no need for `terraform_remote_state` data sources.

```hcl
# infrastructure/prod/us-east-1/api/terragrunt.hcl

include "root" {
  path = find_in_parent_folders()
}

dependency "vpc" {
  config_path = "../networking"

  # Placeholders for plan-time (before networking is applied)
  mock_outputs = {
    vpc_id             = "vpc-00000000000000000"
    private_subnet_ids = ["subnet-00000000", "subnet-11111111"]
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

dependency "database" {
  config_path = "../database"

  mock_outputs = {
    endpoint = "db.example.com"
    port     = 5432
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

inputs = {
  vpc_id             = dependency.vpc.outputs.vpc_id
  private_subnet_ids = dependency.vpc.outputs.private_subnet_ids
  db_endpoint        = dependency.database.outputs.endpoint
  db_port            = dependency.database.outputs.port
}
```

## `dependencies` Block

Declare execution order without consuming outputs. Use when one unit must apply before another but doesn't need its outputs.

```hcl
# This unit applies after IAM roles are created, but doesn't need their outputs
dependencies {
  paths = ["../iam-roles", "../security-groups"]
}
```

## Mock Outputs

`mock_outputs` are critical for `run --all plan` on new stacks where dependent units haven't been applied yet. Without mocks, the plan fails because Terragrunt can't read remote state from units that don't have state yet.

```hcl
dependency "vpc" {
  config_path = "../networking"

  # Returned when the dependency has no state (new stack) or on plan
  mock_outputs = {
    vpc_id             = "vpc-mock-for-plan"
    private_subnet_ids = ["subnet-mock-0", "subnet-mock-1"]
    availability_zones = ["us-east-1a", "us-east-1b"]
  }

  # Commands that use mock outputs instead of reading real state
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]

  # Optional: also allow mocks when remote state exists but you want to plan without applying
  mock_outputs_merge_strategy_with_state = "shallow_merge"
}
```

## DAG-Based `run --all`

Terragrunt builds a Directed Acyclic Graph from `dependency` and `dependencies` blocks.

**Apply order (leaf-first):**
```
networking → database → api → frontend
                      ↘ worker
```

**Destroy order (reverse — dependents first):**
```
frontend, worker → api → database → networking
```

Visualize the DAG:

```bash
# Show dependency graph
terragrunt graph-dependencies

# Output in Graphviz DOT format (pipe to dot for rendering)
terragrunt graph-dependencies | dot -Tpng -o deps.png
```

## Cycle Detection

Terragrunt errors on circular dependencies. If you need bidirectional data, there is a module boundary problem.

```
# Error: terragrunt encountered a cycle
# module A depends on B, B depends on A

# Fix: extract the shared resource into a third module C
# A depends on C, B depends on C — no cycle
```

## Partial Dependencies (Large Stacks)

When you want to apply only part of a stack, without losing dependency ordering:

```bash
# Apply only the api unit and its dependencies
terragrunt run --all apply --terragrunt-include-dir "prod/us-east-1/api"

# Apply everything in the prod account
terragrunt run --all apply --terragrunt-working-dir prod/

# Exclude a specific directory
terragrunt run --all plan --terragrunt-exclude-dir "prod/us-east-1/experimental"
```

## Reading Outputs from an Applied Dependency

```bash
# Get outputs from a specific unit
terragrunt output --terragrunt-working-dir prod/us-east-1/networking

# Use in a script
VPC_ID=$(terragrunt output -raw vpc_id --terragrunt-working-dir prod/us-east-1/networking)
```

## Cross-Account Dependencies

```hcl
dependency "shared_networking" {
  config_path = "../../../../shared-account/networking"

  mock_outputs = {
    transit_gateway_id = "tgw-mock"
  }
  mock_outputs_allowed_terraform_commands = ["plan"]
}
```

The dependency reads remote state from a different account's S3 bucket. The executing role must have `s3:GetObject` on the shared account's state bucket. Set up a cross-account S3 bucket policy to allow this.

## Dependency Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Missing `mock_outputs` | `run --all plan` fails on new stacks | Always add `mock_outputs` and `mock_outputs_allowed_terraform_commands` |
| Circular dependencies | Terragrunt error; impossible to apply | Refactor: extract shared resource into a new unit |
| Deep dependency chains | Slow DAG resolution; brittle | Flatten where possible; limit depth to 3-4 levels |
| Referencing all outputs | Tight coupling between units | Expose only what callers need in outputs |
