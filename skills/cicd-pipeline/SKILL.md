---
name: cicd-pipeline
description: "Use when creating or optimizing a CI/CD pipeline for GitHub Actions or GitLab CI -- build caching, secret handling, matrix testing, deployment strategies, or environment management."
user-invocable: true
argument-hint: "[generate|optimize|deploy|secrets|matrix|audit]"
tags: [ci-cd]
tier: core
---

# CI/CD Pipeline

Generate, optimize, and audit CI/CD pipelines for GitHub Actions and GitLab CI.

---

## Quick Start

```
/cicd-pipeline generate    # New pipeline tailored to detected stack
/cicd-pipeline optimize    # Improve an existing pipeline
/cicd-pipeline deploy      # Deployment workflow (preview/staging/production)
/cicd-pipeline secrets     # Secret handling and OIDC setup
/cicd-pipeline matrix      # Multi-version/multi-OS matrix testing
/cicd-pipeline audit       # Security and performance audit of existing pipeline
```

No argument? If no CI config exists, defaults to `generate`. If one exists, defaults to `optimize`.

---

## Context

PROJECT FILES:
```
!`ls -la .github/workflows/ 2>/dev/null; ls -la .gitlab-ci.yml 2>/dev/null; echo "---"; ls package.json go.mod Cargo.toml pyproject.toml setup.py requirements.txt Makefile Taskfile.yml Dockerfile docker-compose.yml 2>/dev/null`
```

CURRENT CI CONFIG:
```
!`cat .github/workflows/*.yml 2>/dev/null | head -200; cat .gitlab-ci.yml 2>/dev/null | head -200; echo "No CI config found" 2>/dev/null`
```

PROJECT STRUCTURE:
```
!`find . -maxdepth 2 \( -name "*.go" -o -name "*.ts" -o -name "*.py" -o -name "*.rs" -o -name "Dockerfile" \) 2>/dev/null | head -30`
```

---

## Mode: generate

Build a complete CI/CD pipeline from scratch.

**Steps:**
1. Run `scripts/detect-stack.sh` to identify language, framework, package manager, and test runner
2. Ask for CI platform preference (GitHub Actions / GitLab CI) -- default: GitHub Actions
3. Ask which pipeline stages to include:
   - Lint (default: yes)
   - Test (default: yes)
   - Build (default: yes)
   - Security scan (default: yes, if dependencies detected)
   - Docker build (default: yes, if Dockerfile detected)
   - Deploy (default: no -- use `deploy` mode separately)
4. Select the matching template from `assets/` and customize it for the detected stack
5. Apply caching strategy from `references/caching-strategies.md` based on detected package manager
6. Write the generated workflow to `.github/workflows/ci.yml` or `.gitlab-ci.yml`
7. Validate the YAML is parseable

**Stack-specific customizations:**

| Stack | Cache Key | Lint | Test | Build |
|-------|-----------|------|------|-------|
| Node.js | `node_modules` via lockfile hash | `eslint`/`biome` | `jest`/`vitest` | `tsc`/`esbuild` |
| Go | `~/go/pkg/mod` + `~/.cache/go-build` via `go.sum` hash | `golangci-lint` | `go test -race ./...` | `go build ./...` |
| Python | `~/.cache/pip` via requirements hash | `ruff`/`flake8` | `pytest` | `poetry build` |
| Rust | `~/.cargo/registry` + `target/` via `Cargo.lock` hash | `clippy` + `fmt` | `cargo test` | `cargo build --release` |

**Asset templates:** `assets/github-actions/` and `assets/gitlab-ci/`

---

## Mode: optimize

Improve an existing pipeline's performance, reliability, and maintainability.

**Steps:**
1. Run `scripts/analyze-pipeline.sh` to parse and summarize the existing config
2. Check for performance issues:
   - Missing dependency caching
   - Sequential jobs that could run in parallel
   - No concurrency controls (duplicate runs on force-push)
   - Overly broad triggers (running on all branches instead of PR + main)
   - Missing `fail-fast` in matrix jobs
   - Full checkout instead of shallow clone (`fetch-depth: 1`)
   - No artifact passing between jobs (rebuilding in each job)
   - Missing `timeout-minutes` on jobs or steps
3. Check for reliability issues:
   - No retry on flaky steps
   - Actions pinned to major version tags (`@v4`) instead of full SHA
   - Missing `permissions` block (over-privileged default)
   - Missing `continue-on-error` for non-critical steps
4. Generate an optimized version with inline comments explaining each change
5. Present a diff between the current config and the optimized version

---

## Mode: deploy

Generate deployment workflows with environment protection and rollback.

**Steps:**
1. Ask for deployment target: Kubernetes, AWS/GCP/Azure, PaaS (Vercel/Railway/Fly.io), Docker registry
2. Ask for deployment strategy:
   - **Rolling** -- Gradual pod replacement, zero-downtime, simple but no instant rollback
   - **Blue-Green** -- Two identical environments, atomic switch, instant rollback, double infra cost
   - **Canary** -- Percentage-based rollout, metrics-driven promotion, requires observability
   - **Preview** -- Per-PR ephemeral environments for testing
3. Generate deployment workflow with:
   - Environment protection rules (manual approval gate for production)
   - Health check verification after each deployment step
   - Automatic rollback on health check failure
   - Deployment status notifications (Slack, GitHub status, etc.)
4. Generate environment-specific config files (staging, production)

Reference: `references/deployment-strategies.md`

---

## Mode: secrets

Audit and configure secure secret handling in pipelines.

**Steps:**
1. Detect current secret usage in the existing pipeline config
2. Recommend the appropriate secret storage mechanism:
   - **GitHub Actions**: Repository secrets vs environment-scoped secrets vs OIDC
   - **GitLab CI**: CI/CD variables, protected variables, masked variables, Vault integration
3. Generate OIDC trust policies for cloud providers (if applicable):
   - AWS: `aws-actions/configure-aws-credentials` with `role-to-assume`
   - GCP: `google-github-actions/auth` with Workload Identity Federation
   - Azure: `azure/login` with federated credentials
4. Generate environment protection rules with required reviewers
5. Audit for secret anti-patterns:
   - Secrets echoed or printed to logs
   - Secrets not scoped to environments (repo-wide when they should be env-scoped)
   - Over-broad `permissions` block
   - Long-lived credentials when OIDC is available

Reference: `references/pipeline-security-checklist.md`

---

## Mode: matrix

Generate matrix testing strategies for multi-version and multi-OS coverage.

**Steps:**
1. Detect dimensions that make sense for the project:
   - Language versions (Node 18/20/22, Go 1.22/1.23/1.24, Python 3.10/3.11/3.12/3.13)
   - OS targets (ubuntu-latest, macos-latest, windows-latest)
   - Database versions (Postgres 14/15/16, MySQL 8.0/8.4)
   - Build modes (debug/release)
2. Generate matrix strategy with:
   - `fail-fast: false` or `true` with trade-off explanation
   - `max-parallel` to control runner cost
   - `include`/`exclude` for targeted combinations (e.g., Windows only on LTS version)
   - Service containers for database testing
3. Show estimated runner minutes impact for the matrix
4. Identify which combinations are highest priority vs nice-to-have

Reference: `references/matrix-testing-guide.md`

---

## Mode: audit

Score an existing pipeline against security, performance, reliability, and maintainability criteria.

**Steps:**
1. Parse the existing pipeline config using `scripts/analyze-pipeline.sh`
2. Score against four categories:
   - **Security**: Permissions block, pinned action SHAs, no secrets in logs, OIDC usage, supply chain protections
   - **Performance**: Caching, concurrency groups, parallelism, shallow clone, artifact reuse
   - **Reliability**: Timeouts, retries, fail-fast, health checks, rollback capability
   - **Maintainability**: Reusable workflows, DRY config, clear job naming, inline comments
3. Generate a report with:
   - Pass/warn/fail status per checklist item
   - Priority-ordered recommendations
   - Estimated time savings per optimization
4. Provide a remediation roadmap ordered by impact vs effort

References: `references/pipeline-security-checklist.md`, `references/caching-strategies.md`

---

## Modes Reference

| Mode | When to Use | Primary Output |
|------|-------------|----------------|
| `generate` | No CI config exists, or starting fresh | Complete `.github/workflows/ci.yml` or `.gitlab-ci.yml` |
| `optimize` | Existing pipeline is slow or fragile | Optimized config with diff and explanation |
| `deploy` | Need preview, staging, or production deployment | Deployment workflow with protection rules |
| `secrets` | Secrets stored unsafely or need OIDC | Secret config, OIDC policy, environment rules |
| `matrix` | Need multi-version or multi-OS coverage | Matrix strategy with cost estimate |
| `audit` | Want a pipeline health check | Scored report with remediation roadmap |

---

## Scope

**In scope:**
- GitHub Actions workflows (primary)
- GitLab CI pipelines (secondary)
- Caching, matrix, secrets, deployment strategies
- Pipeline security (supply chain, OIDC, permissions)

**Out of scope:**
- Kubernetes manifests and Helm charts (use infrastructure tools)
- Cloud IaC (Terraform, Pulumi)
- Application-level vulnerability scanning (see `security-review` skill)
- Docker Compose orchestration

---

## Key References

| Reference | Contents |
|-----------|----------|
| `references/github-actions-patterns.md` | Reusable workflows, OIDC, concurrency, permissions |
| `references/gitlab-ci-patterns.md` | Includes, rules, DAG, review apps |
| `references/deployment-strategies.md` | Rolling, blue-green, canary comparison and decision guide |
| `references/pipeline-security-checklist.md` | 20-item security checklist |
| `references/caching-strategies.md` | Per-language cache configs and anti-patterns |
| `references/matrix-testing-guide.md` | Matrix dimensions, fail-fast, cost control |

## Asset Templates

| Template | Stack | Platform |
|----------|-------|----------|
| `assets/github-actions/node.yml` | Node.js / TypeScript | GitHub Actions |
| `assets/github-actions/go.yml` | Go | GitHub Actions |
| `assets/github-actions/python.yml` | Python | GitHub Actions |
| `assets/github-actions/rust.yml` | Rust | GitHub Actions |
| `assets/github-actions/docker-build.yml` | Docker | GitHub Actions |
| `assets/github-actions/deploy-preview.yml` | Any | GitHub Actions |
| `assets/github-actions/release.yml` | Any | GitHub Actions |
| `assets/github-actions/reusable-ci.yml` | Any | GitHub Actions |
| `assets/gitlab-ci/node.gitlab-ci.yml` | Node.js / TypeScript | GitLab CI |
| `assets/gitlab-ci/go.gitlab-ci.yml` | Go | GitLab CI |
| `assets/gitlab-ci/python.gitlab-ci.yml` | Python | GitLab CI |
| `assets/gitlab-ci/docker.gitlab-ci.yml` | Docker | GitLab CI |
| `assets/production-readiness-checklist.md` | Any | Platform-agnostic |
