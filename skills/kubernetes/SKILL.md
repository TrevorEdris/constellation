---
name: kubernetes
description: "Use when authoring Kubernetes manifests, Helm charts, or Kustomize overlays -- resource limits, probes, security contexts, RBAC, or auditing existing manifests."
context: fork
allowed-tools: Bash, Read, Glob, Grep, Write
model: sonnet
argument-hint: "[manifest|helm|kustomize|audit]"
tags: [infrastructure]
---

# Kubernetes

---

## When to Use

- Writing or reviewing Kubernetes manifests (Deployment, Service, Ingress, etc.)
- Creating or templating a Helm chart
- Structuring Kustomize base/overlay environments
- Auditing existing manifests for security, resource limits, or reliability gaps
- Selecting the right deployment strategy for a service

---

## Quick Start

```
/kubernetes manifest    # Generate K8s manifests for this service
/kubernetes helm        # Scaffold or improve a Helm chart
/kubernetes kustomize   # Set up Kustomize base + overlay structure
/kubernetes audit       # Audit existing manifests for security and reliability
```

No argument? Scan the working directory for existing manifests or Helm charts and suggest the most relevant mode.

---

## Context

DETECTED K8S FILES:
```
!`find . -maxdepth 5 \( -name "*.yaml" -o -name "*.yml" \) 2>/dev/null | xargs grep -l "kind:" 2>/dev/null | head -20 || echo "none"`
```

HELM CHART DETECTED:
```
!`ls Chart.yaml charts/*/Chart.yaml 2>/dev/null || echo "No Helm chart found"`
```

KUSTOMIZE DETECTED:
```
!`ls kustomization.yaml kustomization.yml 2>/dev/null || ls base/kustomization.yaml overlays/*/kustomization.yaml 2>/dev/null | head -10 || echo "No Kustomize found"`
```

CURRENT NAMESPACE/CONTEXT:
```
!`kubectl config current-context 2>/dev/null && kubectl config view --minify --output 'jsonpath={.contexts[0].context.namespace}' 2>/dev/null || echo "kubectl not configured or not available"`
```

---

## Mode: manifest

Generate Kubernetes manifests for a service.

**Steps:**
1. Identify service type: stateless web service, stateful service, batch job, or DaemonSet
2. Generate core resources: Deployment, Service, optionally Ingress
3. Add PodDisruptionBudget for availability guarantees
4. Add NetworkPolicy (default-deny + allow for required peers)
5. Create a ServiceAccount with least-privilege RBAC
6. Apply the mandatory fields checklist

**Mandatory fields (every Deployment):**

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0   # No capacity loss during rollout
      maxSurge: 1         # One extra pod during rollout
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        fsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          resources:
            requests:
              cpu: "100m"       # Measured P99 CPU under load
              memory: "128Mi"   # Measured P99 memory under load
            limits:
              cpu: "500m"       # 2-5x requests typical
              memory: "256Mi"   # 1.5-2x requests; OOMKill if exceeded
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          livenessProbe:
            httpGet:
              path: /livez
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 3
```

**Resource sizing guide:**
- `requests`: Set to P99 usage under normal load (measure, don't guess)
- `limits.cpu`: 2-5x requests — CPU throttles (slow), not kill
- `limits.memory`: 1.5-2x requests — OOM kills the container, size conservatively

**Startup probe (long-boot services):**
```yaml
startupProbe:
  httpGet:
    path: /livez
    port: 8080
  failureThreshold: 30   # 30 * 10s = 5 min max startup
  periodSeconds: 10
```

---

## Mode: helm

Scaffold or improve a Helm chart.

**Steps:**
1. If no chart exists: scaffold from `assets/helm-chart-skeleton/`
2. If chart exists: audit against the Helm best practices checklist
3. Generate `_helpers.tpl` with standard label helpers
4. Validate: `helm lint` and `helm template . --dry-run`

**Chart skeleton structure:**
```
my-chart/
├── Chart.yaml            # apiVersion, name, version (semver), appVersion
├── values.yaml           # Defaults with inline comments
├── values.schema.json    # JSON schema for values validation (recommended)
├── templates/
│   ├── _helpers.tpl      # Named templates: labels, selectorLabels, serviceAccountName
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── serviceaccount.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── networkpolicy.yaml
│   └── NOTES.txt
└── charts/               # Subcharts (dependencies)
```

**Standard label helpers (`_helpers.tpl`):**
```
{{- define "mychart.labels" -}}
helm.sh/chart: {{ include "mychart.chart" . }}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
```

**Chart versioning:** Bump `version` on any chart template change. Bump `appVersion` on application version changes. Use semver.

**Validation workflow:**
```bash
helm lint ./my-chart
helm template my-release ./my-chart --dry-run --debug | kubectl apply --dry-run=client -f -
```

See `references/helm-patterns.md` for subchart patterns and advanced topics.

---

## Mode: kustomize

Set up Kustomize base/overlay structure for multi-environment deployments.

**Steps:**
1. Create base/ with raw manifests and base `kustomization.yaml`
2. Create overlays/ for each environment (dev, staging, production)
3. Use strategic merge patches for simple field overrides
4. Use JSON patches for array element targeting
5. Configure image tag replacement in overlays

**Canonical structure:**
```
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── serviceaccount.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── patch-replicas.yaml
    ├── staging/
    │   ├── kustomization.yaml
    │   └── patch-resources.yaml
    └── production/
        ├── kustomization.yaml
        └── patch-production.yaml
```

**Image tag replacement (overlay):**
```yaml
# overlays/production/kustomization.yaml
images:
  - name: my-app
    newTag: "1.2.3"
```

**When to choose Kustomize vs Helm:**
- **Kustomize**: You own the manifests, environments differ by a few fields, no external distribution
- **Helm**: Distributing a chart to others, many configurable parameters, community chart dependency

See `references/kustomize-patterns.md` for strategic merge vs JSON patch examples.

---

## Mode: audit

Audit existing manifests for security, reliability, and operational readiness.

**Steps:**
1. Scan all YAML files for Kubernetes resources
2. Score each Deployment/StatefulSet/DaemonSet against the checklist
3. Report findings with severity levels
4. Provide remediation snippets for each finding

**Audit categories:**

| Category | Key Checks |
|----------|-----------|
| Security | Non-root user, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, capabilities dropped, no `hostNetwork`/`hostPID` |
| Resource management | requests + limits on every container, no missing requests, limits within 5x requests |
| Reliability | Liveness + readiness probes, PodDisruptionBudget, rolling update strategy, `minReadySeconds` |
| Network | NetworkPolicy present, default-deny in namespace, no wildcard `podSelector` |
| RBAC | ServiceAccount per workload, no default SA, no `cluster-admin` for workloads |
| Pod Security | `seccompProfile: RuntimeDefault`, `securityContext` at pod and container level |

**Severity mapping:**
- **[CRITICAL]**: `privileged: true`, running as root with writable filesystem, secrets in env vars from plain `value:` (not `secretKeyRef`)
- **[HIGH]**: missing resource limits, no probes, no NetworkPolicy, `hostNetwork: true`
- **[MEDIUM]**: missing PDB, no seccomp profile, default ServiceAccount used
- **[LOW]**: label inconsistencies, missing `minReadySeconds`, cosmetic issues

---

## Scope

**In scope:**
- K8s manifest authoring (Deployment, Service, Ingress, ConfigMap, Secret, PDB, NetworkPolicy)
- Helm chart scaffolding and patterns
- Kustomize base/overlay structure
- Probe YAML specification
- Security context and RBAC configuration

**Out of scope:**
- K8s deployment in CI pipelines (use `cicd-pipeline` skill)
- Health probe semantics and /livez /readyz endpoint implementation (use `observability` skill)
- Terraform/Pulumi for cluster provisioning (use `terraform`/`pulumi` skills)

---

## References

- [references/manifest-security-checklist.md](references/manifest-security-checklist.md) — Full Pod Security Standards checklist
- [references/resource-management.md](references/resource-management.md) — Sizing guide, LimitRange, ResourceQuota
- [references/probes-guide.md](references/probes-guide.md) — Startup/liveness/readiness probe decision tree
- [references/helm-patterns.md](references/helm-patterns.md) — Chart structure, _helpers.tpl, subcharts, versioning
- [references/kustomize-patterns.md](references/kustomize-patterns.md) — Base/overlay, patch types, image replacement
- [references/common-pitfalls.md](references/common-pitfalls.md) — OOMKill, CrashLoopBackOff, ImagePullBackOff, Pending
- [assets/base-deployment.yaml](assets/base-deployment.yaml) — Production-hardened Deployment template
- [assets/base-service.yaml](assets/base-service.yaml) — Service template with annotations
- [assets/pdb.yaml](assets/pdb.yaml) — PodDisruptionBudget template
- [assets/network-policy-default-deny.yaml](assets/network-policy-default-deny.yaml) — Namespace default-deny
- [assets/helm-chart-skeleton/](assets/helm-chart-skeleton/) — Complete Helm chart skeleton
- [assets/kustomize-skeleton/](assets/kustomize-skeleton/) — Kustomize base + 3 overlays
