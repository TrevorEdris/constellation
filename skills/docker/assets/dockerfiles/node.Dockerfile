# syntax=docker/dockerfile:1
# Node.js multi-stage Dockerfile — Alpine runtime, production deps only
# Replace <APP_NAME> and entrypoint with your values.

# ─── Stage 1: Production dependencies ────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# ─── Stage 2: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS release
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Copy only what's needed
COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/package.json ./

# OCI labels
LABEL org.opencontainers.image.title="<APP_NAME>"
LABEL org.opencontainers.image.source="https://github.com/org/repo"

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
USER appuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/livez || exit 1

CMD ["node", "dist/server.js"]
