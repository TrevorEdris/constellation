# Terraform CI/CD Integration

## Core Principle: Plan on PR, Apply on Merge

Never auto-apply on push without a plan review gate.

```
PR opened → terraform plan → post plan as PR comment → human reviews
PR approved and merged → terraform apply (same plan) → deployment
```

## Plan Artifact Preservation

Always save the plan binary and apply only that exact plan. This prevents plan/apply drift — where the state changes between plan and apply.

```bash
# Plan — save to binary
terraform plan -out=plan.bin

# Show human-readable plan (for PR comment)
terraform show -no-color plan.bin > plan.txt

# Apply — only the exact saved plan
terraform apply plan.bin
```

**Do NOT** run `terraform apply` without `-out` and then replan separately. The second plan may differ from the first.

## GitHub Actions — Complete Workflow

```yaml
name: Terraform

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write      # Required for OIDC
  contents: read
  pull-requests: write # Required to post PR comments

jobs:
  plan:
    name: Plan
    runs-on: ubuntu-latest
    outputs:
      plan_exitcode: ${{ steps.plan.outputs.exitcode }}

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.8.0"

      - name: Terraform Init
        run: terraform init

      - name: Terraform Format Check
        run: terraform fmt -check -recursive

      - name: Terraform Validate
        run: terraform validate

      - name: Terraform Plan
        id: plan
        run: |
          terraform plan -out=plan.bin -detailed-exitcode
        continue-on-error: true  # Exit code 2 = changes, not an error

      - name: Show Plan
        run: terraform show -no-color plan.bin > plan.txt

      - name: Post Plan to PR
        uses: actions/github-script@v7
        if: github.event_name == 'pull_request'
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('plan.txt', 'utf8');
            const body = `## Terraform Plan\n\`\`\`\n${plan}\n\`\`\``;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body.substring(0, 65536)  // GitHub comment limit
            });

      - name: Upload Plan
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan
          path: plan.bin
          retention-days: 5

  apply:
    name: Apply
    runs-on: ubuntu-latest
    needs: plan
    if: github.ref == 'refs/heads/main' && needs.plan.outputs.plan_exitcode == '2'
    environment: production  # Requires manual approval in GitHub Environments

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.8.0"

      - name: Terraform Init
        run: terraform init

      - name: Download Plan
        uses: actions/download-artifact@v4
        with:
          name: terraform-plan

      - name: Terraform Apply
        run: terraform apply plan.bin
```

## Atlantis

Self-hosted GitOps for Terraform: auto-plans on PR, posts plan as comment, applies on PR approval.

```yaml
# atlantis.yaml — repository configuration
version: 3
automerge: false
delete_source_branch_on_merge: false

projects:
  - name: api-service
    dir: services/api
    workspace: default
    terraform_version: v1.8.0
    autoplan:
      when_modified: ["*.tf", "*.tfvars", "../modules/**/*.tf"]
      enabled: true
    apply_requirements: [approved, mergeable]
```

**Atlantis considerations:**
- Requires self-managed infra (EC2, EKS, ECS)
- Plan output in PR comments — team reviews before apply
- Apply locks — only one apply per project at a time
- Webhook-driven — no polling

## TACOS (Managed Terraform Orchestration)

| Platform | Key Feature | Best For |
|----------|------------|---------|
| HCP Terraform (HashiCorp Cloud) | Managed runners, policy enforcement, drift detection | Teams without self-hosted infra |
| Spacelift | Advanced policy engine, stack dependencies | Complex multi-stack orgs |
| Scalr | Multi-tenant, cost governance | Enterprise cost management |

## Drift Detection

Schedule periodic `terraform plan` runs to detect out-of-band changes:

```yaml
# .github/workflows/drift-detection.yml
on:
  schedule:
    - cron: '0 8 * * *'  # Daily at 8 AM UTC

jobs:
  drift-check:
    steps:
      - terraform plan -detailed-exitcode
      # Exit code 2 = drift detected
      - name: Alert on drift
        if: ${{ failure() }}
        uses: slackapi/slack-github-action@v1
        with:
          channel-id: '#infra-alerts'
          slack-message: "Terraform drift detected in ${{ github.repository }}"
```

## Destroy Protection

Gate `terraform destroy` behind a manual approval or an explicit opt-in environment variable:

```yaml
# In GitHub Actions
- name: Terraform Destroy
  if: env.CONFIRM_DESTROY == 'yes'
  run: terraform destroy -auto-approve
  env:
    CONFIRM_DESTROY: ${{ inputs.confirm_destroy }}
```

For Atlantis, require `atlantis destroy` to be explicitly triggered with an `apply_requirements` of `[approved]`.

## State Migration

When changing backend configuration:

```bash
# 1. Update backend config in versions.tf
# 2. Initialize with migration flag
terraform init -migrate-state

# Terraform prompts to confirm state copy
# Answer "yes" — state is copied to new backend
# Old state remains in old location (clean up manually after verification)
```

## Multi-Environment Pipeline Pattern

```
repo/
├── environments/
│   ├── dev/
│   │   └── terraform.tfvars
│   ├── staging/
│   │   └── terraform.tfvars
│   └── prod/
│       └── terraform.tfvars
└── main.tf

# CI: matrix strategy
strategy:
  matrix:
    environment: [dev, staging]  # prod is manual
steps:
  - terraform plan -var-file="environments/${{ matrix.environment }}/terraform.tfvars"
```
