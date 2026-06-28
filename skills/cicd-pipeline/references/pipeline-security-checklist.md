# Pipeline Security Checklist

Security requirements for production CI/CD pipelines. Each item includes why it matters and how to implement it.

---

## Permissions and Access Control

- [ ] **`permissions` block explicitly set on every workflow**
  - WHY: Default GitHub Actions `GITHUB_TOKEN` has write access to everything. A compromised step can push code, modify releases, or exfiltrate tokens.
  - HOW: Add `permissions: contents: read` at the workflow level, then expand only as needed per job.
  ```yaml
  permissions:
    contents: read
  ```

- [ ] **Each job has only the permissions it needs**
  - WHY: A job that deploys only needs `id-token: write`, not `contents: write`.
  - HOW: Override at the job level for jobs that need elevated access.
  ```yaml
  jobs:
    deploy:
      permissions:
        id-token: write
        contents: read
  ```

- [ ] **Self-hosted runners are isolated and ephemeral**
  - WHY: Persistent self-hosted runners accumulate secrets, environment state, and can be compromised across jobs/repos.
  - HOW: Use JIT runners or autoscaling runner groups that destroy the VM after each job.

- [ ] **Public repositories do not use self-hosted runners**
  - WHY: Untrusted fork PRs can run malicious code on self-hosted runners.
  - HOW: Use GitHub-hosted runners for public repos. If self-hosted is required, use `pull_request_target` carefully with explicit conditions.

---

## Supply Chain Security

- [ ] **All third-party actions pinned to full SHA, not mutable tags**
  - WHY: A tag like `@v4` can be moved to point to malicious code. A SHA cannot be changed.
  - HOW: Find the SHA on the action's release page, or use `pin-github-action` CLI.
  ```yaml
  # UNSAFE
  - uses: actions/checkout@v4
  # SAFE
  - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
  ```

- [ ] **Dependabot or Renovate configured to update action SHAs**
  - WHY: Pinned SHAs become stale. Automation keeps them current with security patches.
  - HOW: Add `.github/dependabot.yml` with `package-ecosystem: github-actions`.

- [ ] **Dependency review action enabled on PRs**
  - WHY: Detects new dependencies with known vulnerabilities before they merge.
  - HOW: Add `actions/dependency-review-action` to PR workflow.
  ```yaml
  - uses: actions/dependency-review-action@38b3ce3a5c1efb7c9f44b9d3bbba8e68e765c89e  # v4.7.1
  ```

- [ ] **SBOM generated for release artifacts**
  - WHY: Software Bill of Materials enables vulnerability tracking across the supply chain.
  - HOW: Use `anchore/sbom-action` or `syft` to generate SPDX or CycloneDX format.

---

## Secret Handling

- [ ] **No long-lived credentials in repository or environment secrets when OIDC is available**
  - WHY: Long-lived credentials can be leaked, forgotten, or not rotated. OIDC tokens are short-lived and scoped to the workflow run.
  - HOW: Configure OIDC for AWS, GCP, or Azure. See `github-actions-patterns.md` for implementation.

- [ ] **Secrets not echoed to logs**
  - WHY: GitHub masks secrets in logs automatically, but only if they're passed via `${{ secrets.NAME }}`. Constructing secrets from parts or using `echo` with shell manipulation can bypass masking.
  - HOW: Pass secrets directly to tools via environment variables. Never use `echo $SECRET`.
  ```yaml
  env:
    API_KEY: ${{ secrets.API_KEY }}
  run: ./deploy.sh   # Tool reads API_KEY from env, not from a shell echo
  ```

- [ ] **Secrets not stored in artifacts or container image layers**
  - WHY: Artifacts are accessible to anyone with repo read access. Image layers persist even after `docker rmi`.
  - HOW: Use multi-stage Docker builds. Never `COPY` secrets into image layers. Use build args only for non-sensitive build-time config.

- [ ] **Production secrets scoped to the production environment, not repo-wide**
  - WHY: Repo-wide secrets are accessible from any workflow on any branch. Environment-scoped secrets require the deployment environment to be selected.
  - HOW: Move production credentials to GitHub Environments with protection rules.

- [ ] **Secret rotation schedule defined**
  - WHY: Rotated secrets limit the blast radius of a past leak.
  - HOW: Document rotation schedule. Use short-lived credentials (OIDC) where possible. Track expiration dates.

---

## Code and Pipeline Integrity

- [ ] **No `pull_request_target` workflow that checks out PR HEAD code**
  - WHY: `pull_request_target` runs with write access and repo secrets. Checking out the PR's code gives the PR author access to these.
  - HOW: Never combine `pull_request_target` with a checkout of `github.event.pull_request.head.sha` unless you know exactly what you're doing.
  ```yaml
  # DANGEROUS combination
  on: pull_request_target
  steps:
    - uses: actions/checkout@...
      with:
        ref: ${{ github.event.pull_request.head.sha }}  # DO NOT DO THIS
  ```

- [ ] **`CODEOWNERS` file protects CI config files**
  - WHY: Ensures pipeline changes require review from security or platform team members.
  - HOW: Add `.github/` to `CODEOWNERS` requiring platform team approval.
  ```
  .github/  @org/platform-team
  ```

- [ ] **Workflow changes from forks require approval before running**
  - WHY: Prevents fork PRs from immediately running untrusted pipeline modifications.
  - HOW: In GitHub repository settings: **Actions > Fork pull request workflows > Require approval for all outside collaborators**.

- [ ] **Branch protection rules enforce CI pass before merge**
  - WHY: Allows the pipeline to serve as a merge gate.
  - HOW: In GitHub: **Settings > Branches > Require status checks to pass before merging**.

---

## Container Image Security

- [ ] **Container images scanned for vulnerabilities**
  - WHY: Base images and installed packages accumulate CVEs. Catch them before deployment.
  - HOW: Use `aquasecurity/trivy-action` or `anchore/scan-action` in the build pipeline.
  ```yaml
  - uses: aquasecurity/trivy-action@a20de5420d57c4102486cdd9349b532415f15e8b  # v0.29.0
    with:
      image-ref: ${{ env.IMAGE_TAG }}
      severity: CRITICAL,HIGH
      exit-code: 1
  ```

- [ ] **Base images pinned to digest, not mutable tag**
  - WHY: `FROM golang:1.23` resolves to whatever is latest at build time -- unpredictable and unauditable.
  - HOW: Use digest pinning in Dockerfile.
  ```dockerfile
  FROM golang:1.23@sha256:7c6c4...  # Pin to digest
  ```

- [ ] **Images built as non-root user**
  - WHY: Root processes in containers can escalate privileges if container isolation is breached.
  - HOW:
  ```dockerfile
  RUN addgroup -S app && adduser -S app -G app
  USER app
  ```

---

## Runner Security

- [ ] **Runners run as non-root**
  - WHY: Root runners can be abused to modify the host system.

- [ ] **Runner network access is restricted to necessary endpoints**
  - WHY: A compromised runner can exfiltrate data via outbound network. Restrict to required registries and APIs.

- [ ] **Workflow run logs reviewed periodically for anomalies**
  - WHY: Anomalous patterns (unexpected network calls, file writes) can indicate a compromised workflow.

---

## Scoring Guide

Rate each category:

| Category | Items | Score |
|----------|-------|-------|
| Permissions & Access | 4 items | /4 |
| Supply Chain | 4 items | /4 |
| Secret Handling | 5 items | /5 |
| Code Integrity | 4 items | /4 |
| Container Security | 3 items | /3 |
| Runner Security | 3 items | /3 |
| **Total** | **23 items** | **/23** |

**Severity:**
- 18-23: Production-ready
- 12-17: Acceptable for non-critical services -- address gaps in next sprint
- <12: High risk -- do not deploy to production until addressed
