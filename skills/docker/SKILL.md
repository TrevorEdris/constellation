---
name: docker
description: "Use when authoring or hardening Dockerfiles and Docker Compose -- multi-stage builds, layer optimization, image security, or local dev orchestration."
context: fork
allowed-tools: Bash, Read, Glob, Grep, Write
model: sonnet
argument-hint: "[dockerfile|compose|harden|scan]"
tags: [infrastructure]
---

# Docker

---

## When to Use

- Writing or reviewing a Dockerfile
- Setting up Docker Compose for local development
- Hardening an existing image (non-root, read-only filesystem, minimal base)
- Scanning an image or Compose config for security issues
- Selecting the right base image for a language/framework

---

## Quick Start

```
/docker dockerfile    # Write or improve a Dockerfile for this service
/docker compose       # Generate or fix a Docker Compose stack
/docker harden        # Harden an existing Dockerfile against security risks
/docker scan          # Audit Dockerfile and Compose for security issues
```

No argument? Detect context automatically and suggest the most relevant mode.

---

## Context

DETECTED PROJECT FILES:
```
!`ls Dockerfile* docker-compose* compose* .dockerignore 2>/dev/null; ls *.go go.mod package.json Cargo.toml pyproject.toml requirements.txt 2>/dev/null || echo "none detected"`
```

CURRENT DOCKERFILE:
```
!`cat Dockerfile 2>/dev/null || echo "No Dockerfile found"`
```

CURRENT COMPOSE:
```
!`cat docker-compose.yml compose.yml docker-compose.yaml compose.yaml 2>/dev/null | head -80 || echo "No Compose file found"`
```

---

## Mode: dockerfile

Write or improve a multi-stage Dockerfile for the detected stack.

**Steps:**
1. Detect language: Go (`go.mod`), Node.js (`package.json`), Python (`pyproject.toml`/`requirements.txt`), Rust (`Cargo.toml`)
2. Select the correct asset template from `assets/dockerfiles/`
3. Customize for the project's entry point, build commands, and port
4. Apply all items from the hardening checklist automatically
5. Verify the result passes the security checklist in `references/dockerfile-security-checklist.md`

**Multi-stage pattern (required for production images):**

```dockerfile
# Stage 1: Build
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /app/server ./cmd/server

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/server /server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
```

**Base image selection:**

| Language | Dev/Debug | Production |
|----------|-----------|-----------|
| Go | `golang:1.24-alpine` | `gcr.io/distroless/static-debian12:nonroot` |
| Node.js | `node:22-alpine` | `node:22-alpine` (strip devDeps) |
| Python | `python:3.13-slim` | `python:3.13-slim` (venv copy) |
| Rust | `rust:1.80-alpine` | `gcr.io/distroless/cc-debian12:nonroot` |

**Layer ordering (cache efficiency):**
1. Base image
2. System dependencies (`apt-get`, `apk add`)
3. Dependency manifests (go.mod, package.json, requirements.txt)
4. Dependency install (`go mod download`, `npm ci`, `pip install`)
5. Source code (`COPY . .`)
6. Build (`RUN go build`, `RUN npm run build`)

---

## Mode: compose

Generate or fix a Docker Compose stack for local development.

**Steps:**
1. Identify required services from codebase (database connections, cache usage, queue consumers)
2. Select matching template from `assets/compose/`
3. Apply health checks with `condition: service_healthy` on `depends_on`
4. Add named volumes for persistent data (databases); bind mounts only for source code
5. Generate `compose.override.yml` for dev-only settings (volume mounts, debug ports)
6. Optionally generate `compose.ci.yml` for CI service containers

**Health check patterns:**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  app:
    depends_on:
      postgres:
        condition: service_healthy
```

**Profile usage (optional services):**
```yaml
services:
  kafka:
    image: confluentinc/cp-kafka:7.7.0
    profiles: ["kafka", "full"]
```
Start with: `docker compose --profile kafka up`

---

## Mode: harden

Apply security hardening to an existing Dockerfile.

**Hardening checklist** (applied automatically):
- [ ] Multi-stage build — no build tools in runtime image
- [ ] Non-root `USER` — use named user, not numeric UID only
- [ ] `--no-cache` on `apk`/`apt-get` install
- [ ] Pin base image to digest or specific minor version (not `:latest`)
- [ ] No secrets in `ENV` or `ARG` — use `--mount=type=secret` (BuildKit)
- [ ] `.dockerignore` excludes `.git`, `.env`, `node_modules`, test data, credentials
- [ ] `COPY --chown` to set file ownership in one layer
- [ ] `HEALTHCHECK` instruction present
- [ ] Read-only root filesystem note (enforce at runtime via `--read-only` or `securityContext`)
- [ ] Drop all capabilities at runtime (document in comments)

**Secret mounting (BuildKit):**
```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --only=production
```

Build: `docker build --secret id=npmrc,src=.npmrc .`

---

## Mode: scan

Audit the Dockerfile and Compose config for security and quality issues.

**Steps:**
1. Review Dockerfile against `references/dockerfile-security-checklist.md`
2. Review Compose against `references/compose-patterns.md` security section
3. Check for Hadolint violations (if installed): `hadolint Dockerfile`
4. Check for Trivy findings (image-level — but note: CI scanning is owned by `cicd-pipeline` skill)
5. Report findings using severity levels:
   - **[CRITICAL]**: secrets in ENV, running as root with writable filesystem
   - **[HIGH]**: no multi-stage build, pinned to `:latest`, missing `.dockerignore`
   - **[MEDIUM]**: missing HEALTHCHECK, no layer cache ordering, devDependencies in prod image
   - **[LOW]**: minor label improvements, cosmetic ordering

---

## Scope

**In scope:**
- Dockerfile authoring and multi-stage patterns
- Docker Compose local development stacks
- Image security hardening
- Base image selection

**Out of scope:**
- Trivy / image scanning in CI pipelines (use `cicd-pipeline` skill)
- Docker build/push Actions (use `cicd-pipeline` skill)
- Kubernetes manifests and Helm charts (use `kubernetes` skill)

---

## References

- [references/dockerfile-best-practices.md](references/dockerfile-best-practices.md) — Layer ordering, cache efficiency, multi-stage patterns
- [references/dockerfile-security-checklist.md](references/dockerfile-security-checklist.md) — Hardening checklist with rationale
- [references/compose-patterns.md](references/compose-patterns.md) — Health checks, profiles, overrides, CI usage
- [references/image-scanning.md](references/image-scanning.md) — Scanning tools, severity mapping, SBOM
- [assets/dockerfiles/go.Dockerfile](assets/dockerfiles/go.Dockerfile) — Go multi-stage template
- [assets/dockerfiles/node.Dockerfile](assets/dockerfiles/node.Dockerfile) — Node.js multi-stage template
- [assets/dockerfiles/python.Dockerfile](assets/dockerfiles/python.Dockerfile) — Python multi-stage template
- [assets/dockerfiles/rust.Dockerfile](assets/dockerfiles/rust.Dockerfile) — Rust multi-stage template
- [assets/compose/web-db-cache.yml](assets/compose/web-db-cache.yml) — Web + Postgres + Redis template
- [assets/compose/compose.override.dev.yml](assets/compose/compose.override.dev.yml) — Dev override template
