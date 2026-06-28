---
name: terraform
description: "Use when writing, reviewing, refactoring, or auditing Terraform -- module structure, state management, providers, resource patterns, testing, or security."
allowed-tools: Bash, Glob, Grep, Read, Write, WebFetch
tags: [infrastructure]
---

# Terraform

Each reference file is self-contained and can be loaded independently.

---

## When to Use

- Writing new Terraform modules or root configurations
- Reviewing Terraform PRs for correctness, security, and idioms
- Refactoring existing configurations (splitting monoliths, adding `moved` blocks)
- Auditing state management, backend configuration, or CI/CD pipelines
- Setting up testing with `terraform test`, tflint, or Checkov
- Evaluating whether to use workspaces vs folder-per-environment

---

## Project Context

TERRAFORM FILES DETECTED:

```
!`find . -maxdepth 4 \( -name "*.tf" -o -name "*.tfvars" -o -name "terragrunt.hcl" -o -name ".terraform.lock.hcl" \) 2>/dev/null | sort | head -40`
```

TERRAFORM VERSION:

```
!`terraform version 2>/dev/null || echo "terraform not installed"`
```

LOCK FILE STATUS:

```
!`find . -name ".terraform.lock.hcl" -maxdepth 4 2>/dev/null | head -5`
```

---

## Modes

| Mode | When to Use |
|------|-------------|
| **write** | Implementing new resources, modules, or root configurations |
| **review** | Reviewing code for correctness, security, and best practices |
| **refactor** | Restructuring existing configs (splitting files, adding `moved` blocks, adopting `for_each`) |
| **audit** | Security and state management review of production configurations |
| **test** | Setting up or improving the testing pipeline (validate, tflint, Checkov, terraform test) |

---

## Quick Reference

| Topic | Reference File | Key Patterns |
|-------|---------------|--------------|
| Module structure | `references/module-structure.md` | Standard layout, root vs child, file splitting, versioning |
| State management | `references/state-management.md` | Remote backends, locking, folder-per-env vs workspaces |
| Provider patterns | `references/provider-patterns.md` | `required_providers`, versioning, multi-region, OIDC for CI |
| Resource patterns | `references/resource-patterns.md` | `for_each` vs `count`, lifecycle, `moved` blocks, dynamic blocks |
| Testing | `references/testing.md` | `terraform test`, tflint, Checkov, Terratest, pre-commit |
| CI/CD integration | `references/cicd-integration.md` | Plan-on-PR, Atlantis, plan artifact pinning, drift detection |
| Security | `references/security.md` | Secrets in state, backend encryption, least-privilege IAM |
| Anti-patterns | `references/anti-patterns.md` | Terralith, hardcoded values, workspace misuse, `-target` abuse |

---

## Limited Context Strategy

When context is tight, load only what you need:
- **Most tasks:** `module-structure.md` + `resource-patterns.md`
- **New project setup:** `module-structure.md` + `state-management.md` + `provider-patterns.md`
- **Security audit:** `security.md` + `state-management.md`
- **CI/CD work:** `cicd-integration.md` + `testing.md`
- **Refactoring:** `resource-patterns.md` + `anti-patterns.md`

---

## Core Principles

- Remote state from day one — local state is dev-only
- Separate backend per environment — never workspaces for prod/staging/dev
- Pin all module versions to semver tags — never `?ref=main`
- Prefer `for_each` over `count` — index shifts destroy unintended resources
- `sensitive = true` suppresses output; it does NOT encrypt state — use a secrets manager
- Commit `.terraform.lock.hcl` — it pins provider versions across machines

---

## File Layout (Every Root Module)

```
root-module/
├── main.tf          # Primary resources
├── variables.tf     # All variable declarations (type + description required)
├── outputs.tf       # All output declarations
├── versions.tf      # terraform {} block with required_version + required_providers
└── README.md        # Inputs/outputs table (generate with terraform-docs)
```

Split `main.tf` at ~150 lines into `<concern>.tf` files: `iam.tf`, `networking.tf`, `storage.tf`.

---

## Tooling Quick Reference

| Tool | Command | Purpose |
|------|---------|---------|
| `terraform fmt` | `terraform fmt -recursive .` | Format all HCL files |
| `terraform validate` | `terraform validate` | Structural + type check (no provider calls) |
| `terraform plan` | `terraform plan -out=plan.bin` | Save plan for exact apply |
| `terraform apply` | `terraform apply plan.bin` | Apply only the saved plan |
| `tflint` | `tflint --recursive` | Provider-aware linting |
| `checkov` | `checkov -d .` | Security policy scanning |
| `trivy config` | `trivy config .` | Security scanning (if using Trivy) |
| `terraform test` | `terraform test` | Native HCL tests (1.6+) |
| `terraform-docs` | `terraform-docs markdown .` | Generate README from variables/outputs |

---

## MCP Integration (Optional)

The HashiCorp Terraform MCP server provides live registry lookups, provider documentation, and HCP Terraform workspace management. The skill functions without it but gains live registry search when configured.

```json
{
  "mcpServers": {
    "terraform": {
      "command": "npx",
      "args": ["-y", "terraform-mcp-server"],
      "env": {
        "TF_TOKEN_app_terraform_io": "${TFC_TOKEN}"
      }
    }
  }
}
```

**Available MCP toolsets:** `registry` (provider/module search), `terraform` (HCP workspace management — requires `TFC_TOKEN`).

---

## Triggers

| Trigger | Example |
|---------|---------|
| Writing Terraform | "create an S3 bucket module with versioning and encryption" |
| Reviewing configs | "review this Terraform root module" |
| Refactoring | "split this monolithic main.tf into concern files" |
| Security audit | "audit this config for secrets in state and over-privileged IAM" |
| Testing setup | "add tflint and Checkov to our CI pipeline" |
| Architecture | "should we use workspaces or folder-per-environment?" |

---

## Related Skills

- `/terragrunt` — Multi-module orchestration with DRY patterns, dependency DAGs, and `run --all`
