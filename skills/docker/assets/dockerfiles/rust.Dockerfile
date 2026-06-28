# syntax=docker/dockerfile:1
# Rust multi-stage Dockerfile — distroless/cc runtime, dependency caching trick
# Replace <APP_NAME> with your binary name (from [package] name in Cargo.toml).

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM rust:1.80-alpine AS builder
WORKDIR /app

RUN apk add --no-cache musl-dev

# Cache crate downloads: build a stub binary first
# This layer is cached unless Cargo.toml or Cargo.lock changes
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Build the real binary
# touch forces cargo to recognize source as changed
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# distroless/cc includes glibc-compatible C runtime (needed by most Rust binaries)
# Use distroless/static if you compiled with musl and --target x86_64-unknown-linux-musl
FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=builder /app/target/release/<APP_NAME> /<APP_NAME>

# OCI labels
LABEL org.opencontainers.image.title="<APP_NAME>"
LABEL org.opencontainers.image.source="https://github.com/org/repo"

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/<APP_NAME>"]
