---
name: terragrunt
description: "Use when designing DRY Terragrunt across multiple modules or accounts -- inheritance, dependency management, and run-all orchestration."
allowed-tools: Bash, Glob, Grep, Read, Write, WebFetch
tags: [infrastructure]
---

# Terragrunt

DRY Terragrunt configuration design for multi-module, multi-account infrastructure. Assumes working knowledge of Terraform — see `/terraform` for foundational patterns.

---

## When to Use

- Implementing or refactoring a Terragrunt root config (`root.hcl` / root `terragrunt.hcl`)
- Designing a folder-hierarchy environment model for multiple accounts or regions
- Setting up `dependency` blocks and mock outputs for CI plan-on-PR
- Running `run --all` across a module stack with correct ordering
- Deciding whether Terragrunt is the right tool (vs plain Terraform workspaces)
- Migrating from `run-all` to the newer `run --all` syntax (v0.67+)

---

## Project Context

TERRAGRUNT FILES DETECTED:

```
!`find . -maxdepth 6 -name "terragrunt.hcl" 2>/dev/null | sort | head -40`
```

TERRAGRUNT VERSION:

```
!`terragrunt --version 2>/dev/null || echo "terragrunt not installed"`
```

TERRAFORM VERSION:

```
!`terraform version 2>/dev/null || tofu version 2>/dev/null || echo "terraform/tofu not installed"`
```

DIRECTORY HIERARCHY:

```
!`find . -name "terragrunt.hcl" -maxdepth 6 2>/dev/null | sed 's|/[^/]*$||' | sort -u | head -20`
```

---

## Modes

| Mode | When to Use |
|------|-------------|
| **init** | Setting up a new Terragrunt project — root config, folder hierarchy, backend |
| **plan** | Planning a single unit or entire stack with `run --all plan` |
| **apply** | Applying in dependency-safe order; reviewing destroy gates |
| **audit** | Reviewing DRY patterns, dependency graph health, and remote state design |
| **migrate** | Converting plain Terraform folder layout to Terragrunt, or updating old syntax |

---

## Quick Reference

| Topic | Reference File | Key Patterns |
|-------|---------------|--------------|
| DRY patterns | `references/dry-patterns.md` | `root.hcl` inheritance, `generate` blocks, `locals`, `include` |
| Remote state | `references/remote-state.md` | `remote_state` block, path-based keys, auto-create |
| Dependency management | `references/dependency-management.md` | `dependency`/`dependencies` blocks, mock outputs, DAG |
| run-all patterns | `references/run-all-patterns.md` | Ordering, scope flags, destroy gates, CI integration |
| Decision guide | `references/decision-guide.md` | Terragrunt vs workspaces vs plain folders |

---

## Limited Context Strategy

When context is tight, load only what you need:
- **New project setup:** `dry-patterns.md` + `remote-state.md`
- **Multi-module CI:** `dependency-management.md` + `run-all-patterns.md`
- **Tool selection:** `decision-guide.md` only
- **Audit:** `dry-patterns.md` + `dependency-management.md`

---

## Core Principles

- `root.hcl` is the single source of truth for backend config, provider generation, and common inputs
- The folder path IS the deployment key — `account/region/service/resource/terragrunt.hcl`
- All child units inherit root via `find_in_parent_folders()` — no copy-paste
- Use `dependency` blocks to read other units' outputs, not `terraform_remote_state` data sources
- Always provide `mock_outputs` for `run --all plan` on stacks with new units
- Never `run --all destroy` without a manual confirmation gate in CI

---

## Folder Hierarchy Pattern

```
infrastructure/
├── terragrunt.hcl          # Root: backend, provider generation, common inputs
├── _modules/               # Optional: local module library
├── prod/
│   ├── us-east-1/
│   │   ├── networking/
│   │   │   └── terragrunt.hcl
│   │   └── app/
│   │       └── terragrunt.hcl
│   └── eu-west-1/
│       └── networking/
│           └── terragrunt.hcl
└── staging/
    └── us-east-1/
        └── networking/
            └── terragrunt.hcl
```

---

## Root `terragrunt.hcl` Skeleton

```hcl
locals {
  account_id  = get_aws_account_id()
  region      = get_env("AWS_REGION", "us-east-1")
  environment = element(split("/", path_relative_to_include()), 0)
}

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "tf-state-${local.account_id}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = local.region
    encrypt        = true
    dynamodb_table = "tf-state-lock"
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.region}"
}
EOF
}

inputs = {
  environment = local.environment
  account_id  = local.account_id
}
```

---

## Tooling Quick Reference

| Command | Purpose |
|---------|---------|
| `terragrunt run --all plan` | Plan entire stack in DAG order |
| `terragrunt run --all apply` | Apply entire stack in DAG order |
| `terragrunt run --all destroy` | Destroy in reverse DAG order |
| `terragrunt run --all plan --terragrunt-include-dir "prod/us-east-1/*"` | Scope to a subset |
| `terragrunt graph-dependencies` | Visualize the dependency DAG |
| `terragrunt validate-inputs` | Check that all required inputs are supplied |

---

## OpenTofu Compatibility

Terragrunt fully supports OpenTofu as a drop-in Terraform replacement. Set in root config:

```hcl
terraform_binary = "tofu"
```

---

## Triggers

| Trigger | Example |
|---------|---------|
| New project setup | "set up a Terragrunt project for 3 AWS accounts and 2 regions" |
| DRY refactor | "eliminate duplicate backend configs across our Terraform modules" |
| Dependency wiring | "module B needs VPC ID from module A" |
| CI plan-on-PR | "plan the entire stack on every PR without applying" |
| Tool selection | "should we use Terragrunt or Terraform workspaces?" |
| run-all | "apply all modules in the correct order across our mono-repo" |

---

## Related Skills

- `/terraform` — Foundational Terraform patterns (modules, state, providers, security)
