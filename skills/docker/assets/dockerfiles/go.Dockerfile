# syntax=docker/dockerfile:1
# Go multi-stage Dockerfile — distroless runtime, static binary
# Replace <APP_NAME> and <CMD_PATH> with your values.

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder
WORKDIR /app

# System dependencies (add extras if CGO is required)
RUN apk add --no-cache \
    git \
    ca-certificates \
    tzdata

# Download dependencies first (cached unless go.mod/go.sum change)
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -trimpath \
    -ldflags="-s -w -extldflags=-static" \
    -o /app/<APP_NAME> \
    ./<CMD_PATH>

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

# Copy CA certs for outbound HTTPS calls
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy timezone data if needed
# COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Copy the binary
COPY --from=builder /app/<APP_NAME> /<APP_NAME>

# OCI labels
LABEL org.opencontainers.image.title="<APP_NAME>"
LABEL org.opencontainers.image.source="https://github.com/org/repo"

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/<APP_NAME>"]
