# Terragrunt run-all Patterns

## Syntax Note

Terragrunt v0.67+ uses `run --all` as the canonical syntax. The legacy `run-all` subcommand still works but is deprecated. Use `run --all` in new configs and documentation.

```bash
# Modern syntax (v0.67+)
terragrunt run --all plan
terragrunt run --all apply
terragrunt run --all destroy

# Legacy syntax (still works, avoid in new scripts)
terragrunt run-all plan
```

## Core Behavior

`run --all` executes a Terraform command across all units found recursively from the current directory. It builds a DAG from `dependency`/`dependencies` blocks and runs units in the correct order.

```bash
# From root — plan all units in topological order
terragrunt run --all plan

# From a subdirectory — plan only units under that path
terragrunt run --all plan --terragrunt-working-dir prod/us-east-1/

# Apply with auto-approve (CI use only)
terragrunt run --all apply --auto-approve
```

## Parallelism

Terragrunt runs independent units in parallel. Control parallelism with `--parallelism`:

```bash
# Default: unlimited parallel execution of independent units
terragrunt run --all apply

# Limit to 5 parallel units (useful for API rate-limited providers)
terragrunt run --all apply --parallelism 5
```

## CI Plan-on-PR with Persisted Plan Files

```bash
# Plan entire stack — save plan files per unit
terragrunt run --all plan \
  --out plan.bin \
  --terragrunt-out-dir /tmp/terragrunt-plans

# Directory structure after plan:
# /tmp/terragrunt-plans/
# ├── prod/us-east-1/networking/plan.bin
# ├── prod/us-east-1/api/plan.bin
# └── prod/us-east-1/database/plan.bin

# Apply only saved plans (prevents plan/apply drift)
terragrunt run --all apply \
  --terragrunt-out-dir /tmp/terragrunt-plans
```

## Scoping `run --all`

```bash
# Include only specific directories
terragrunt run --all plan \
  --terragrunt-include-dir "prod/us-east-1/api" \
  --terragrunt-include-dir "prod/us-east-1/networking"

# Exclude specific directories
terragrunt run --all plan \
  --terragrunt-exclude-dir "prod/us-east-1/experimental" \
  --terragrunt-exclude-dir "staging/"

# Scope to modified units only (custom scripting required)
CHANGED_DIRS=$(git diff --name-only origin/main | grep "terragrunt.hcl" | xargs -I{} dirname {})
for dir in $CHANGED_DIRS; do
  terragrunt run --all plan --terragrunt-working-dir "$dir"
done
```

## Destroy Order

`run --all destroy` reverses the apply DAG: dependents are destroyed before dependencies.

```
Apply order:  networking → database → api → frontend
Destroy order: frontend → api → database → networking
```

**Never run `run --all destroy` in production without a confirmation gate:**

```bash
# Require explicit opt-in
if [ "${CONFIRM_DESTROY}" != "yes" ]; then
  echo "Set CONFIRM_DESTROY=yes to proceed with destroy"
  exit 1
fi

terragrunt run --all destroy --auto-approve
```

In GitHub Actions, require a `workflow_dispatch` input with a specific value:

```yaml
on:
  workflow_dispatch:
    inputs:
      confirm_destroy:
        description: "Type 'yes-destroy-everything' to confirm"
        required: true

jobs:
  destroy:
    if: github.event.inputs.confirm_destroy == 'yes-destroy-everything'
    steps:
      - run: terragrunt run --all destroy --auto-approve
```

## Ignore Dependency Ordering (Use with Care)

```bash
# Skip dependency resolution — run all units in parallel regardless of dependencies
# Only safe for read operations like output or validate
terragrunt run --all output --terragrunt-ignore-dependency-order
```

## Stacks (Experimental, v0.67+)

Terragrunt v0.67+ introduces first-class Stacks as a declarative grouping mechanism:

```hcl
# stack.hcl — declarative stack definition (experimental)
unit "networking" {
  source = "."
  path   = "networking"
}

unit "api" {
  source = "."
  path   = "api"

  after = ["networking"]
}
```

**Status:** Still maturing. Watch the Gruntwork changelog before adopting in production.

## Error Handling in `run --all`

When a unit fails, `run --all` exits after completing in-progress units. It does NOT roll back already-applied units.

```bash
# Continue applying other units even if some fail
terragrunt run --all apply --terragrunt-ignore-dependency-errors

# Retry failed units (after fixing the underlying issue)
terragrunt run --all apply --terragrunt-working-dir prod/us-east-1/api
```

## GitHub Actions — Full Stack CI

```yaml
name: Terragrunt

on:
  pull_request:
    paths: ["infrastructure/**"]
  push:
    branches: [main]
    paths: ["infrastructure/**"]

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infrastructure

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: gruntwork-io/terragrunt-action@v2
        with:
          tf_version: "1.8.0"
          tg_version: "0.67.0"
          tg_command: "run --all plan --terragrunt-out-dir /tmp/tg-plans"

      - name: Upload Plans
        uses: actions/upload-artifact@v4
        with:
          name: terragrunt-plans
          path: /tmp/tg-plans

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    environment: production
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infrastructure

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: actions/download-artifact@v4
        with:
          name: terragrunt-plans
          path: /tmp/tg-plans

      - uses: gruntwork-io/terragrunt-action@v2
        with:
          tf_version: "1.8.0"
          tg_version: "0.67.0"
          tg_command: "run --all apply --terragrunt-out-dir /tmp/tg-plans"
```
