# Terragrunt vs Plain Terraform Decision Guide

## Decision Matrix

| Scenario | Recommendation | Reasoning |
|----------|---------------|-----------|
| Single team, <10 modules, 1-2 environments | Plain Terraform + folder-per-env | Terragrunt overhead not justified |
| Multiple teams, many accounts/regions, module catalog | Terragrunt | DRY backend config, dependency DAG, `run --all` ROI is clear |
| Ephemeral environments (PRs, feature branches) | Terraform workspaces OR Terragrunt with path-derived key | Short-lived; either works |
| Large monorepo with 50+ modules | Terragrunt | Module orchestration and dependency ordering not feasible in plain Terraform |
| OpenTofu (Terraform fork) | Terragrunt with `terraform_binary = "tofu"` | Drop-in replacement; full support |
| Existing plain Terraform, growing complexity | Evaluate at 10+ modules or 3+ accounts | Migration has cost; evaluate ROI at that threshold |
| Single-account, single-region app | Plain Terraform | Terragrunt hierarchy adds structure without benefit |

## Plain Terraform: When It's Enough

Plain Terraform with a folder-per-environment layout is the right choice when:
- Team size is 1-5 engineers
- Infrastructure is localized to one or two AWS accounts
- The module catalog is small (<10 modules)
- Backend config copy-paste is manageable (3-5 environments)
- CI/CD is simple (one pipeline per environment)

```
infra/
├── modules/       # Shared child modules
│   └── vpc/
├── dev/
│   ├── main.tf
│   ├── variables.tf
│   └── backend.tf  # Manually managed per-env
└── prod/
    ├── main.tf
    ├── variables.tf
    └── backend.tf
```

## Terragrunt: When the ROI Is Clear

Terragrunt pays for itself when:
- Backend config is copy-pasted 5+ times (one per env/account/region combination)
- Modules have cross-module output dependencies that require correct ordering
- `run --all` across 20+ modules would need manual orchestration in plain Terraform
- Teams frequently apply to the wrong environment (workspace confusion)
- Multiple AWS accounts require consistent provider and backend structure

```
# Before Terragrunt — backend.tf copy-paste in 12 directories
# After Terragrunt — one remote_state block in root
```

## Terraform Workspaces vs Terragrunt Hierarchy

| Feature | Workspaces | Terragrunt Folders |
|---------|-----------|-------------------|
| State isolation | Separate state per workspace in same bucket | Completely separate backends possible |
| Accidental cross-env apply risk | High (easy `workspace select` mistake) | Low (cd to wrong directory is obvious) |
| Backend config | Shared — same bucket for all workspaces | Separate per folder |
| Visibility | `terraform workspace list` | `ls` in your repo |
| Resource differences per env | Variable files only | Different `terragrunt.hcl` per unit |
| Recommended for | Ephemeral stacks | Persistent environments |

**Rule:** Never use `terraform workspace` for prod, staging, and dev. Use it only for ephemeral, short-lived stacks.

## Migration: Plain Terraform → Terragrunt

The migration path preserves existing state. No state manipulation required.

### Step 1: Create root `terragrunt.hcl`

Write the root config with `remote_state` pointing to your existing S3 bucket/key pattern.

### Step 2: Add child `terragrunt.hcl` files

For each existing folder, add a minimal `terragrunt.hcl`:

```hcl
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "."  # or module source if extracting
}
```

### Step 3: Remove `backend.tf` files

Since Terragrunt generates `backend.tf`, remove the static ones. Verify the generated config matches the existing backend exactly (bucket, key, region).

### Step 4: Verify with `terragrunt plan`

Run `terragrunt plan` in each unit. The plan should show no changes — infrastructure is unchanged.

### Step 5: Add `dependency` blocks

Identify cross-module references currently done via `terraform_remote_state` data sources. Replace with `dependency` blocks.

## OpenTofu Compatibility

Terragrunt supports OpenTofu as a drop-in replacement for Terraform:

```hcl
# Root terragrunt.hcl
terraform_binary = "tofu"

# Or via environment variable
# TERRAGRUNT_TFPATH=tofu
```

Feature parity: all Terragrunt features work identically with OpenTofu. The `terraform {}` HCL block is still used in Terragrunt config files (it refers to the underlying binary, not specifically Terraform).

## Checklist Before Adopting Terragrunt

- [ ] Team has read Terragrunt docs (dry-patterns, dependencies, run-all)
- [ ] Agreed on folder hierarchy convention (account/region/service/resource vs account/environment/service)
- [ ] Root `terragrunt.hcl` drafted and reviewed
- [ ] CI/CD pipeline updated for `terragrunt run --all`
- [ ] `.gitignore` updated for Terragrunt-generated files (`.terragrunt-cache/`, generated `backend.tf`, `provider.tf`)
- [ ] Bootstrap process for state bucket and DynamoDB table documented
- [ ] Destroy protection gate added to CI

## When NOT to Adopt Terragrunt

- The team is new to Terraform — learn plain Terraform first
- The codebase is being migrated to Pulumi or CDK — don't add Terragrunt to a system being replaced
- The infrastructure is truly a single-environment proof of concept
- Regulatory requirements prevent tool additions without extended approval processes
