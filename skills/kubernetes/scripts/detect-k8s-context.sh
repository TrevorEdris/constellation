#!/usr/bin/env bash
# detect-k8s-context.sh
# Detects Helm charts, Kustomize overlays, raw manifests, and kubectl context
# in the current directory. Outputs structured context for the kubernetes skill.

set -euo pipefail

echo "=== Kubernetes Context Detection ==="
echo ""

# ── kubectl context ───────────────────────────────────────────────────────────
echo "--- Cluster Context ---"
if command -v kubectl &>/dev/null; then
  CONTEXT=$(kubectl config current-context 2>/dev/null || echo "no context set")
  NAMESPACE=$(kubectl config view --minify --output 'jsonpath={.contexts[0].context.namespace}' 2>/dev/null || echo "default")
  echo "Current context: ${CONTEXT}"
  echo "Current namespace: ${NAMESPACE:-default}"
else
  echo "kubectl not found in PATH"
fi

# ── Helm detection ────────────────────────────────────────────────────────────
echo ""
echo "--- Helm Charts ---"
CHART_YAML=$(find . -maxdepth 4 -name "Chart.yaml" 2>/dev/null | sort)
if [ -n "${CHART_YAML}" ]; then
  while IFS= read -r chart; do
    DIR=$(dirname "${chart}")
    NAME=$(grep '^name:' "${chart}" | awk '{print $2}' || echo "unknown")
    VERSION=$(grep '^version:' "${chart}" | awk '{print $2}' || echo "unknown")
    APP_VERSION=$(grep '^appVersion:' "${chart}" | awk '{print $2}' || echo "unset")
    echo "Chart: ${NAME} v${VERSION} (appVersion: ${APP_VERSION}) at ${DIR}"
  done <<< "${CHART_YAML}"
else
  echo "No Helm charts detected (no Chart.yaml found)"
fi

# ── Kustomize detection ───────────────────────────────────────────────────────
echo ""
echo "--- Kustomize ---"
KUSTOMIZE_FILES=$(find . -maxdepth 5 \( -name "kustomization.yaml" -o -name "kustomization.yml" \) 2>/dev/null | sort)
if [ -n "${KUSTOMIZE_FILES}" ]; then
  BASE_COUNT=0
  OVERLAY_COUNT=0
  while IFS= read -r kfile; do
    DIR=$(dirname "${kfile}")
    if echo "${DIR}" | grep -q "base"; then
      BASE_COUNT=$((BASE_COUNT + 1))
    elif echo "${DIR}" | grep -q "overlay"; then
      OVERLAY_COUNT=$((OVERLAY_COUNT + 1))
    fi
    RESOURCE_COUNT=$(grep -c '  - ' "${kfile}" 2>/dev/null || echo "?")
    echo "Kustomization: ${DIR} (~${RESOURCE_COUNT} entries)"
  done <<< "${KUSTOMIZE_FILES}"
else
  echo "No Kustomize configuration detected"
fi

# ── Raw manifests ─────────────────────────────────────────────────────────────
echo ""
echo "--- Kubernetes Manifests ---"
MANIFEST_FILES=$(find . -maxdepth 5 \( -name "*.yaml" -o -name "*.yml" \) 2>/dev/null | \
  xargs grep -l "^kind:" 2>/dev/null | \
  grep -v "Chart.yaml\|kustomization\|compose\|docker-compose\|GitHub\|gitlab" | \
  sort | head -20 || echo "")

if [ -n "${MANIFEST_FILES}" ]; then
  echo "Found manifests:"
  while IFS= read -r mfile; do
    KIND=$(grep '^kind:' "${mfile}" | head -1 | awk '{print $2}' || echo "unknown")
    NAME=$(grep '^  name:' "${mfile}" | head -1 | awk '{print $2}' || echo "unknown")
    echo "  ${mfile}: ${KIND}/${NAME}"
  done <<< "${MANIFEST_FILES}"
else
  echo "No raw Kubernetes manifests found"
fi

# ── Security quick-check ──────────────────────────────────────────────────────
echo ""
echo "--- Security Quick-Check (raw manifests) ---"
if [ -n "${MANIFEST_FILES}" ]; then
  # Check for missing securityContext
  MISSING_SECURITY=$(grep -L "securityContext" ${MANIFEST_FILES} 2>/dev/null || echo "")
  [ -n "${MISSING_SECURITY}" ] && echo "[HIGH] Missing securityContext in: ${MISSING_SECURITY}"

  # Check for root user
  ROOT_USER=$(grep -l "runAsUser: 0\|runAsNonRoot: false" ${MANIFEST_FILES} 2>/dev/null || echo "")
  [ -n "${ROOT_USER}" ] && echo "[CRITICAL] Running as root in: ${ROOT_USER}"

  # Check for latest tag
  LATEST_TAG=$(grep -l "image:.*:latest" ${MANIFEST_FILES} 2>/dev/null || echo "")
  [ -n "${LATEST_TAG}" ] && echo "[HIGH] Pinned to :latest in: ${LATEST_TAG}"

  [ -z "${MISSING_SECURITY}${ROOT_USER}${LATEST_TAG}" ] && echo "No critical issues detected (run /kubernetes audit for full report)"
else
  echo "No manifests to check"
fi

echo ""
echo "=== Detection complete ==="
