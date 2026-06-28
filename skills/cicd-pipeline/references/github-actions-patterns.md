# GitHub Actions Patterns

Practical patterns for production-grade GitHub Actions workflows.

---

## Reusable Workflows vs Composite Actions

| | Reusable Workflow | Composite Action |
|--|-------------------|-----------------|
| **What it is** | A complete workflow called via `workflow_call` | A multi-step action called in a `uses:` step |
| **Unit** | Jobs and steps | Steps only |
| **Secrets** | Must be explicitly passed via `secrets: inherit` or declared inputs | Inherited from caller |
| **Runners** | Caller specifies, OR callee can specify its own | Runs on caller's runner |
| **Best for** | Shared CI logic across repos (lint + test + build) | Reusable step sequences within a workflow |

### Reusable Workflow Example

```yaml
# .github/workflows/reusable-ci.yml
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: "20"
    secrets:
      NPM_TOKEN:
        required: false

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci
      - run: npm test
```

### Composite Action Example

```yaml
# .github/actions/setup-go/action.yml
name: Setup Go with Cache
runs:
  using: composite
  steps:
    - uses: actions/setup-go@d60b41a563a35a8c32d69f5d4f82aab80ae4af30  # v5.5.0
      with:
        go-version-file: go.mod
    - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
      with:
        path: |
          ~/go/pkg/mod
          ~/.cache/go-build
        key: go-${{ runner.os }}-${{ hashFiles('go.sum') }}
        restore-keys: go-${{ runner.os }}-
```

---

## Concurrency Groups

Cancel in-progress runs when a new commit is pushed to the same branch or PR.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**For production branches** -- allow the in-progress run to finish:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

**For release workflows** -- never cancel:
```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

---

## Permissions Block

Always set `permissions` explicitly. The default grants `write` to everything -- a poisoned pipeline can exfiltrate tokens.

```yaml
# Minimum for read-only CI
permissions:
  contents: read

# PR commenting
permissions:
  contents: read
  pull-requests: write

# Deploying with OIDC
permissions:
  contents: read
  id-token: write

# Creating releases
permissions:
  contents: write
  packages: write
```

**Rule:** Grant only what the workflow needs. Add to `permissions` as you add steps, not before.

---

## Job Dependency Graphs

Use `needs` to express dependencies. Independent jobs run in parallel automatically.

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [...]

  test:
    runs-on: ubuntu-latest
    steps: [...]

  build:
    needs: [lint, test]      # Waits for both; runs immediately after both pass
    runs-on: ubuntu-latest
    steps: [...]

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [...]
```

**Conditional execution with job results:**
```yaml
notify:
  needs: [lint, test, build]
  if: always()               # Run even if previous jobs failed
  runs-on: ubuntu-latest
```

---

## Artifact Passing Between Jobs

Pass build artifacts between jobs to avoid rebuilding.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: go build -o dist/app ./cmd/app
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02  # v4.6.2
        with:
          name: app-binary
          path: dist/
          retention-days: 1     # Short retention for CI artifacts

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@95815c38cf2ff2164869cbab79da8d1f422bc89e  # v4.2.1
        with:
          name: app-binary
          path: dist/
      - run: ./deploy.sh dist/app
```

---

## Environment Protection Rules

Protect production deployments with required reviewers and wait timers.

```yaml
jobs:
  deploy-production:
    environment:
      name: production
      url: https://example.com
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

Configure in GitHub repository settings:
- **Required reviewers**: 1+ people must approve before the job runs
- **Wait timer**: Delay before deployment proceeds (gives time to cancel)
- **Branch restrictions**: Only allow deployment from `main`
- **Deployment branch policy**: Restrict which branches/tags can deploy

---

## OIDC for Cloud Authentication

Use OIDC to authenticate to cloud providers without storing long-lived credentials.

### AWS

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@b47578312673ae6fa5b5096b15b7a56c4b4f0e1  # v4.2.1
    with:
      role-to-assume: arn:aws:iam::123456789:role/github-actions-deploy
      aws-region: us-east-1
```

AWS trust policy for the IAM role:
```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::123456789:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:sub": "repo:org/repo:ref:refs/heads/main"
    }
  }
}
```

### GCP

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: google-github-actions/auth@ba79af03959ebeac9769e648ef5e8fc31534c7e0  # v2.1.10
    with:
      workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
      service_account: deploy@project.iam.gserviceaccount.com
```

### Azure

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: azure/login@a457da9f9b927aad50e0a05daa10895d23d00070  # v2.3.0
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

---

## Self-Hosted Runners

**When to use:**
- Needs access to private network resources
- Builds require specialized hardware (GPU, ARM, large RAM)
- High runner minute costs for long-running jobs
- Compliance requirements (data must not leave your infrastructure)

**Security requirements for self-hosted runners:**

- Use ephemeral runners that are destroyed after each job (JIT runners or scale sets)
- Never use self-hosted runners for public repositories
- Isolate runners in a dedicated network segment
- Apply least-privilege IAM to the runner's identity
- Run runners as a non-root user
- Enable runner autoscaling to avoid idle costs

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64, large]
    steps: [...]
```

---

## Action Pinning

Pin actions to full SHAs, not mutable tags. A tag can be moved; a SHA cannot.

```yaml
# UNSAFE -- tag is mutable
- uses: actions/checkout@v4

# SAFE -- SHA is immutable
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

**Tools to automate SHA pinning:**
- `pin-github-action` CLI
- Dependabot (creates PRs to update pinned SHAs)
- `renovate` with `pinDigests: true`

**Dependabot config for action updates:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

---

## Trigger Patterns

**Standard CI (PR + main only):**
```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

**Release workflow:**
```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:    # Manual trigger with optional inputs
    inputs:
      environment:
        type: choice
        options: [staging, production]
```

**Scheduled jobs:**
```yaml
on:
  schedule:
    - cron: '0 6 * * 1'    # Monday at 06:00 UTC
```

**Avoiding duplicate runs** (push and PR both trigger for the same commit):
```yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
```

---

## Common Pitfalls

| Pitfall | Problem | Fix |
|---------|---------|-----|
| `pull_request_target` + PR checkout | Poisoned pipeline attack | Use `pull_request` or isolate sensitive steps |
| Secrets in `run:` debug output | Credentials leak to logs | Use `::add-mask::` or avoid echoing secrets |
| No `permissions` block | Over-privileged `GITHUB_TOKEN` | Always set `permissions` explicitly |
| Mutable action tags | Supply chain attack | Pin to SHA |
| Cache without lockfile hash | Stale cache serves wrong deps | Always hash the lockfile |
| No concurrency group | Redundant parallel runs | Add `concurrency` to every workflow |
| No `timeout-minutes` | Hung jobs consume runner quota | Set on jobs and individual steps |
