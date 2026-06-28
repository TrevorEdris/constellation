---
description: HCL formatting, naming, and structure conventions for Terraform and Terragrunt
  configurations.
paths:
- '**/**/*.tf'
- '**/**/*.tfvars'
- '**/**/*.tftest.hcl'
- '**/**/terragrunt.hcl'
- '**/**/.tflint.hcl'
---

## Terraform/HCL Conventions

### File Layout (Every Root Module)

Every root module must contain:
- `main.tf` — primary resources
- `variables.tf` — all variable declarations
- `outputs.tf` — all output declarations
- `versions.tf` — `terraform {}` block with `required_version` and `required_providers`
- `README.md` — inputs/outputs table (generate with `terraform-docs`)

Split `main.tf` at ~150 lines into `<concern>.tf` files (e.g., `iam.tf`, `networking.tf`, `storage.tf`).

Child modules: no `backend {}` block, no provider config without `configuration_aliases`.

### Naming Conventions

- Resources: `snake_case` matching the resource type suffix — `aws_s3_bucket.app_data` not `aws_s3_bucket.appData`
- Variables: `snake_case`, descriptive — `vpc_cidr_block` not `cidr`
- Outputs: `snake_case`, prefixed with resource type when ambiguous — `vpc_id`, `subnet_ids`
- Locals: `snake_case`; use liberally to name complex expressions and avoid repetition

### Variable Rules

- Always include `type` and `description`; add `default` only when a sensible safe default exists
- Never `type = any` — use `string`, `number`, `bool`, `list(string)`, `map(object({...}))`, etc.
- Use `validation` blocks for constrained inputs (environment names, CIDR formats, instance families)
- Mark `sensitive = true` for variables holding credentials, tokens, or keys
- Never pass secrets as variable values — they land in state and plan files

### Resource Rules

- Prefer `for_each` with a `map` or `set(string)` over `count` for all non-trivially homogeneous resources
- Use `lifecycle { prevent_destroy = true }` on stateful resources (RDS, S3 buckets, etc.)
- Use `lifecycle { create_before_destroy = true }` for zero-downtime resource replacements
- Use `moved` blocks for state refactoring — never bare `terraform state mv` without a code change
- Document `depends_on` with a comment: `# explicit because X is a side-effect dependency`
- Avoid `depends_on` when an implicit reference achieves the same ordering

### State Rules

- Remote backend required for all shared environments — S3+DynamoDB (AWS), GCS (GCP), Azure Blob
- Separate backend per environment — `dev/`, `staging/`, `prod/` with distinct state files
- Never use `terraform workspace` for prod/staging/dev — shared backend config risks cross-env apply
- Commit `.terraform.lock.hcl` to version control — it pins provider versions across machines
- Enable state encryption: S3 `encrypt = true` + SSE-KMS; GCS CMEK; Azure customer-managed keys

### Formatting

- Always run `terraform fmt` before commit (`pre-commit` hook recommended)
- HCL uses 2-space indentation — no tabs
- Run `terraform validate` locally before pushing — it catches type errors without provider calls

### Anti-Patterns

- No hardcoded account IDs, ARNs, region strings, or CIDRs — always variables or data sources
- No secrets as variable values — use `data "aws_secretsmanager_secret_version"` or Vault provider
- No `terraform { backend {} }` in child modules — only in root modules
- No `depends_on` without a comment explaining why the implicit dependency is insufficient
- No `-target` in normal workflows — it leaves state inconsistent and is a break-glass tool only
- No `sensitive = true` as a security control — state is plaintext JSON regardless

### Deep Reference

For comprehensive patterns, code examples, and workflow guidance: `/terraform` and `/terragrunt` skills.
