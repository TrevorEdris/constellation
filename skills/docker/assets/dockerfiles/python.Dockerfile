# syntax=docker/dockerfile:1
# Python multi-stage Dockerfile — slim runtime, virtualenv copy pattern
# Replace <APP_MODULE> (e.g., src.main:app) and port with your values.

# ─── Stage 1: Build virtualenv ───────────────────────────────────────────────
FROM python:3.13-slim AS builder
WORKDIR /app

# Install uv for fast dependency resolution
RUN pip install --no-cache-dir uv==0.5.26

# Install production dependencies into a virtualenv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache

# If using requirements.txt instead of uv:
# COPY requirements.txt ./
# RUN python -m venv /app/.venv && \
#     /app/.venv/bin/pip install --no-cache-dir -r requirements.txt

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.13-slim AS release
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --no-create-home --shell /sbin/nologin appuser

# Copy virtualenv from builder
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

# Copy application source
COPY --chown=appuser:appuser src/ ./src/

# OCI labels
LABEL org.opencontainers.image.title="<APP_NAME>"
LABEL org.opencontainers.image.source="https://github.com/org/repo"

# Activate virtualenv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/livez')" || exit 1

CMD ["uvicorn", "<APP_MODULE>", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
