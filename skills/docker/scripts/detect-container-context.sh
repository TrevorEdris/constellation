#!/usr/bin/env bash
# detect-container-context.sh
# Detects the language/framework, existing Dockerfile, and Compose configuration
# in the current directory. Outputs structured context for the docker skill.

set -euo pipefail

echo "=== Container Context Detection ==="
echo ""

# ── Language detection ────────────────────────────────────────────────────────
echo "--- Language ---"
LANG_DETECTED=""
if [ -f "go.mod" ]; then
  GO_VERSION=$(grep '^go ' go.mod | awk '{print $2}' || echo "unknown")
  echo "Go (go.mod detected, version: ${GO_VERSION})"
  LANG_DETECTED="go"
elif [ -f "package.json" ]; then
  NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
  echo "Node.js (package.json detected, runtime: ${NODE_VERSION})"
  LANG_DETECTED="node"
elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ] || [ -f "setup.py" ]; then
  PYTHON_VERSION=$(python3 --version 2>/dev/null || echo "unknown")
  echo "Python (${PYTHON_VERSION})"
  LANG_DETECTED="python"
elif [ -f "Cargo.toml" ]; then
  RUST_VERSION=$(rustc --version 2>/dev/null || echo "unknown")
  echo "Rust (${RUST_VERSION})"
  LANG_DETECTED="rust"
else
  echo "Unknown (no recognized manifest found)"
fi

# ── Dockerfile detection ──────────────────────────────────────────────────────
echo ""
echo "--- Dockerfile ---"
DOCKERFILES=$(ls Dockerfile Dockerfile.* *.Dockerfile 2>/dev/null || echo "")
if [ -n "${DOCKERFILES}" ]; then
  for df in ${DOCKERFILES}; do
    STAGES=$(grep -c '^FROM ' "${df}" 2>/dev/null || echo 0)
    HAS_USER=$(grep -c '^USER ' "${df}" 2>/dev/null || echo 0)
    echo "${df}: ${STAGES} stage(s), USER instruction: $([ "${HAS_USER}" -gt 0 ] && echo 'yes' || echo 'NO (missing)')"
  done
else
  echo "No Dockerfile found — recommend: /docker dockerfile (lang: ${LANG_DETECTED:-unknown})"
fi

# ── .dockerignore detection ───────────────────────────────────────────────────
echo ""
echo "--- .dockerignore ---"
if [ -f ".dockerignore" ]; then
  LINES=$(wc -l < .dockerignore)
  HAS_GIT=$(grep -c '^\.git$' .dockerignore 2>/dev/null || echo 0)
  HAS_ENV=$(grep -c '\.env' .dockerignore 2>/dev/null || echo 0)
  echo "Present (${LINES} lines) | .git excluded: $([ "${HAS_GIT}" -gt 0 ] && echo 'yes' || echo 'NO') | .env excluded: $([ "${HAS_ENV}" -gt 0 ] && echo 'yes' || echo 'NO')"
else
  echo "MISSING — [HIGH] Build context may include sensitive files"
fi

# ── Compose detection ─────────────────────────────────────────────────────────
echo ""
echo "--- Docker Compose ---"
COMPOSE_FILES=$(ls compose.yml compose.yaml docker-compose.yml docker-compose.yaml 2>/dev/null || echo "")
if [ -n "${COMPOSE_FILES}" ]; then
  for cf in ${COMPOSE_FILES}; do
    SERVICES=$(grep -c '^  [a-zA-Z]' "${cf}" 2>/dev/null || echo "?")
    echo "${cf}: ~${SERVICES} service definitions"
  done
  OVERRIDE=$(ls compose.override.yml compose.override.yaml docker-compose.override.yml 2>/dev/null || echo "")
  [ -n "${OVERRIDE}" ] && echo "Override file detected: ${OVERRIDE}"
else
  echo "No Compose file found"
fi

echo ""
echo "=== Detection complete ==="
