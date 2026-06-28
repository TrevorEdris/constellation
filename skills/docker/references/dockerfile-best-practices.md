# Dockerfile Best Practices

## Multi-Stage Build Pattern

Multi-stage builds are the highest-impact optimization for production images. They eliminate build tooling, source code, and intermediate artifacts from the final image.

### Why Multi-Stage

- **Smaller images**: Go binaries built in `golang:1.24-alpine` (400MB+) → `distroless/static` (< 5MB)
- **Reduced attack surface**: No compiler, no shell, no package manager in production
- **Faster pulls and deploys**: Smaller images → less network transfer

### Stage Naming Convention

Name every stage (`AS builder`, `AS tester`, `AS release`). This allows:
- Building only a specific stage: `docker build --target builder .`
- Referencing stages by name across the file
- CI caching individual stages

```dockerfile
FROM golang:1.24-alpine AS builder   # Build tools here
FROM gcr.io/distroless/static AS release  # Minimal runtime only
```

---

## Layer Ordering for Cache Efficiency

Docker caches layers by comparing the instruction and its inputs. Invalidating one layer invalidates all subsequent layers.

**Optimal order (least frequently changing → most frequently changing):**

1. Base image selection
2. System package installs (`apk add`, `apt-get install`)
3. Dependency manifest copy (`COPY go.mod go.sum ./`)
4. Dependency installation (`RUN go mod download`)
5. Application source copy (`COPY . .`)
6. Build (`RUN go build`)

**Anti-pattern (breaks cache on any source change):**
```dockerfile
COPY . .                  # ← Copies everything; invalidates on any file change
RUN go mod download       # ← Runs every time, even if go.mod unchanged
RUN go build ./...
```

**Correct pattern:**
```dockerfile
COPY go.mod go.sum ./
RUN go mod download       # Cached unless go.mod/go.sum change
COPY . .
RUN go build ./...
```

---

## Language-Specific Patterns

### Go

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates tzdata
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w -extldflags=-static" \
    -o /app/server \
    ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/server /server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
```

Key points:
- `CGO_ENABLED=0` + `-extldflags=-static` → fully static binary, works in distroless/static
- `-trimpath` → removes local filesystem paths from binary (security + reproducibility)
- `-ldflags="-s -w"` → strips debug info and DWARF symbols (smaller binary)
- `distroless/static` → no libc, no shell, no OS package manager

### Node.js

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS release
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
USER nextjs
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

Key points:
- Separate `deps` stage (prod deps only) from `builder` stage (dev deps for build)
- `npm ci` instead of `npm install` — deterministic, faster, fails on lockfile mismatch
- Create dedicated user with `addgroup`/`adduser` (Alpine) or `useradd` (Debian)

### Python

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache

FROM python:3.13-slim AS release
WORKDIR /app
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --no-create-home appuser
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --chown=appuser:appuser src/ ./src/
USER appuser
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Key points:
- `uv` for fast dependency resolution (or `pip install -r requirements.txt --no-cache-dir`)
- Copy virtualenv from builder stage, not the full Python installation
- `python:3.13-slim` for production (smaller than full, still has glibc)

### Rust

```dockerfile
# syntax=docker/dockerfile:1
FROM rust:1.80-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
# Cache dependencies separately
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot AS release
COPY --from=builder /app/target/release/my-app /my-app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/my-app"]
```

Key points:
- Dependency caching trick: build a stub `main.rs` first to cache crate downloads
- `musl-dev` for static linking on Alpine
- `distroless/cc` (not `distroless/static`) for Rust binaries that link against glibc
- `touch src/main.rs` forces the real binary to rebuild without re-downloading deps

---

## .dockerignore

Always include a `.dockerignore` to prevent sensitive files and large directories from being included in the build context.

```
.git
.github
.env
.env.*
*.env
node_modules
dist
build
coverage
__pycache__
*.pyc
.pytest_cache
target/
.cargo/registry
*.log
*.md
.dockerignore
docker-compose*.yml
Makefile
Taskfile*
.vscode
.idea
tests/
test/
spec/
*.test.ts
*.spec.ts
```

---

## HEALTHCHECK Instruction

Every production image should include a `HEALTHCHECK`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/server", "-health"] || exit 1
```

For distroless images (no curl/wget), use a compiled health binary or rely on Kubernetes probes at the orchestration layer instead.

---

## Image Labels

Document images with standard OCI labels:

```dockerfile
LABEL org.opencontainers.image.title="my-service"
LABEL org.opencontainers.image.description="API server for the order pipeline"
LABEL org.opencontainers.image.version="1.2.3"
LABEL org.opencontainers.image.source="https://github.com/org/repo"
LABEL org.opencontainers.image.created="2026-02-20T00:00:00Z"
```

Set dynamic labels at build time: `docker build --label org.opencontainers.image.version=$(git describe --tags) .`
