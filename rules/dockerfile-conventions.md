---
description: 'Enforce Dockerfile best practices: multi-stage builds, non-root USER,
  no secrets in ENV/ARG, and .dockerignore hygiene.'
paths:
- '**/Dockerfile'
- '**/Dockerfile.*'
- '**/*.Dockerfile'
---

## Dockerfile Conventions

### Multi-Stage Builds

- Every production Dockerfile must use multi-stage builds
- Runtime image must not contain: compilers, package managers (`apk`, `apt`), build tools, test files, source code (for Go/Rust/compiled languages)
- Use `AS` to name every stage: `FROM golang:1.24-alpine AS builder`

```dockerfile
# Required pattern:
FROM golang:1.24-alpine AS builder
# ... build steps ...

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/server /server
```

### Non-Root User

- **[CRITICAL]** No `USER root` in the final stage
- Every Dockerfile must have a `USER` instruction in the runtime stage
- Use named user, not only numeric UID: `USER appuser:appuser`
- For distroless images, use predefined nonroot: `USER nonroot:nonroot` or `USER 65534:65534`

```dockerfile
# For Alpine/Debian:
RUN addgroup --system --gid 1001 appuser && \
    adduser --system --uid 1001 --ingroup appuser appuser
USER appuser:appuser

# For distroless:
FROM gcr.io/distroless/static-debian12:nonroot
USER nonroot:nonroot
```

### Secrets Must Not Appear in ENV or ARG

- **[CRITICAL]** Credentials, tokens, and API keys are forbidden in `ENV` or `ARG`
- `ENV SECRET=value` is visible in `docker inspect` and embedded in image layers
- `ARG SECRET` is visible in `docker history --no-trunc`
- Use BuildKit secret mounts for build-time secrets:

```dockerfile
# syntax=docker/dockerfile:1
# Correct — secret never persists in a layer:
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

# Wrong — secret written to layer:
COPY .npmrc /root/.npmrc    # [CRITICAL]
ENV NPM_TOKEN=abc123        # [CRITICAL]
```

### Base Image Pinning

- **[HIGH]** Never use `:latest` tag for base images
- Pin to specific version: `FROM node:22.11.0-alpine`
- For maximum reproducibility, pin to digest: `FROM node:22-alpine@sha256:...`

### .dockerignore

- Every repository with a Dockerfile must have a `.dockerignore` file
- **[HIGH]** `.dockerignore` must exclude: `.git`, `.env`, `.env.*`, credentials
- Must also exclude large directories to reduce build context: `node_modules/`, `target/`, `__pycache__/`

```
.git
.env
.env.*
node_modules
target/
__pycache__
*.pyc
.pytest_cache
coverage/
```

### Layer Cache Ordering

Order instructions from least to most frequently changing:

1. Base image
2. System package installs
3. Dependency manifests (`COPY go.mod go.sum ./`)
4. Dependency install (`RUN go mod download`)
5. Application source (`COPY . .`)
6. Build (`RUN go build`)

Placing `COPY . .` before dependency install breaks cache on every source change.

### Package Installation

- Clear package cache in the same `RUN` layer:
  - Alpine: `apk add --no-cache git ca-certificates`
  - Debian: `apt-get install -y git && rm -rf /var/lib/apt/lists/*`
- Pin package versions where reproducibility is critical

### HEALTHCHECK

- Include a `HEALTHCHECK` instruction in every production Dockerfile
- For distroless images without shell tools, document reliance on Kubernetes probes instead
