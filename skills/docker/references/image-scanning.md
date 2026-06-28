# Image Scanning

## Overview

Container image scanning detects OS package vulnerabilities, application dependency vulnerabilities, and misconfigurations in Dockerfiles. This reference covers local scanning workflows — CI pipeline scanning is owned by the `cicd-pipeline` skill.

---

## Trivy (Recommended)

Trivy by Aqua Security is the most widely adopted OSS scanner. It covers OS packages, language dependencies, and Dockerfile misconfigurations.

### Installation

```bash
# macOS
brew install aquasecurity/trivy/trivy

# Docker (no install needed)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image my-app:latest
```

### Basic Usage

```bash
# Scan a local image
trivy image my-app:latest

# Scan with severity filter (fails CI on CRITICAL/HIGH)
trivy image --severity CRITICAL,HIGH my-app:latest

# Scan a Dockerfile for misconfigurations
trivy config Dockerfile

# Scan a Compose file
trivy config docker-compose.yml

# Generate SBOM (Software Bill of Materials)
trivy image --format spdx-json --output sbom.json my-app:latest

# Scan filesystem (useful in CI before image build)
trivy fs --security-checks vuln,config .
```

### Severity Levels

| Trivy Level | Meaning | Action |
|-------------|---------|--------|
| CRITICAL | CVSS 9.0–10.0, known exploits | Fix immediately, block deploy |
| HIGH | CVSS 7.0–8.9, likely exploitable | Fix in current sprint |
| MEDIUM | CVSS 4.0–6.9, limited impact | Backlog with SLA |
| LOW | CVSS 0.1–3.9, theoretical | Track, fix opportunistically |
| UNKNOWN | No CVSS score | Review case by case |

### Ignoring False Positives

Create `.trivyignore` at the project root:

```
# CVE that doesn't apply: vulnerability is in an unused code path
CVE-2023-12345

# Accepted risk with justification and expiry
CVE-2024-67890 exp:2026-06-01 # Vendor fix expected in Q2 2026
```

### Trivy in CI (brief reference)

```yaml
# GitHub Actions example (full patterns in cicd-pipeline skill)
- name: Scan image
  uses: aquasecurity/trivy-action@0.28.0
  with:
    image-ref: my-app:${{ github.sha }}
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: 1
```

---

## Hadolint (Dockerfile Linting)

Hadolint enforces Dockerfile best practices, overlapping with the security checklist.

```bash
# Install
brew install hadolint

# Lint a Dockerfile
hadolint Dockerfile

# Ignore specific rules
hadolint --ignore DL3008 Dockerfile

# JSON output for CI integration
hadolint -f json Dockerfile
```

---

## Grype (Alternative Scanner)

Anchore Grype for teams already using Anchore's ecosystem:

```bash
brew install anchore/grype/grype
grype my-app:latest
grype --fail-on high my-app:latest
```

---

## Syft (SBOM Generation)

Generate a Software Bill of Materials independently from scanning:

```bash
brew install syft
syft my-app:latest -o spdx-json > sbom.json
syft my-app:latest -o cyclonedx-json > sbom-cyclonedx.json
```

---

## Reducing Vulnerability Surface

The most effective way to reduce findings is to minimize the image:

1. **Use distroless or scratch base images** — eliminates all OS package vulnerabilities
2. **Multi-stage builds** — dev dependencies and build tools don't reach the runtime image
3. **Alpine over Debian/Ubuntu** — musl libc has a much smaller attack surface than glibc
4. **Update base images regularly** — pin to specific minor versions and update on a cadence (monthly)
5. **Only install required packages** — every `apk add` / `apt-get install` is potential surface

### Expected Finding Counts by Base Image (approximate)

| Base Image | Typical CRITICAL+HIGH Findings |
|-----------|-------------------------------|
| ubuntu:24.04 | 15-40 |
| debian:12-slim | 5-20 |
| alpine:3.21 | 0-5 |
| gcr.io/distroless/static | 0-2 |
| gcr.io/distroless/cc | 0-3 |
| scratch | 0 |

---

## SBOM and Supply Chain

For regulated environments or public-facing APIs, maintain an SBOM:

1. Generate at build time: `trivy image --format spdx-json --output sbom.json my-app:$TAG`
2. Attest to the image: `cosign attest --predicate sbom.json --type spdxjson my-app:$TAG`
3. Verify before deploy: `cosign verify-attestation --type spdxjson my-app:$TAG`

Cosign + Sigstore provides cryptographic proof that:
- The image was built from a known source
- The SBOM is authentic
- No tampering occurred between build and deploy
