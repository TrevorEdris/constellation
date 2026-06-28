---
description: 'Enforce Kubernetes manifest standards: resource limits on every container,
  liveness/readiness probes, non-root securityContext, and PodDisruptionBudgets.'
paths:
- '**/**/*.yaml'
- '**/**/*.yml'
---

## Kubernetes Conventions

These rules apply to Kubernetes resource manifests (Deployment, StatefulSet, DaemonSet, Job).

### Resource Limits (Required on Every Container)

- **[CRITICAL]** Every container must declare both `requests` and `limits` for CPU and memory
- A container without `limits.memory` can exhaust node memory and cascade OOMKills to other pods

```yaml
resources:
  requests:
    cpu: "100m"      # Scheduler uses this for placement
    memory: "128Mi"  # Scheduler uses this for placement
  limits:
    cpu: "500m"      # Throttled if exceeded — container NOT killed
    memory: "256Mi"  # OOMKilled if exceeded — size conservatively
```

Sizing guide:
- `requests`: P99 usage under normal load
- `limits.cpu`: 2-5x requests
- `limits.memory`: 1.5-2x requests

### Health Probes (Required on Every Container)

- **[HIGH]** Every container must have both `livenessProbe` and `readinessProbe`
- Liveness and readiness must use **different endpoints**: `/livez` for liveness, `/readyz` for readiness
- **[CRITICAL]** Liveness probe must not check external dependencies (database, cache, external APIs) — this causes cascade restarts when dependencies fail

```yaml
livenessProbe:
  httpGet:
    path: /livez     # Process health only — no dependency checks
    port: http
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /readyz    # May check dependencies — gates traffic, not restarts
    port: http
  periodSeconds: 5
  failureThreshold: 3
```

For services with long startup: add `startupProbe` with high `failureThreshold` to prevent premature liveness failures.

### Security Context (Pod and Container Level)

Pod-level (in `spec.template.spec`):

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534
  runAsGroup: 65534
  fsGroup: 65534
  seccompProfile:
    type: RuntimeDefault
```

Container-level (in each `containers[]` entry):

```yaml
securityContext:
  allowPrivilegeEscalation: false   # [CRITICAL] if missing
  readOnlyRootFilesystem: true      # [HIGH] if missing
  capabilities:
    drop: ["ALL"]                   # [HIGH] if missing
```

- **[CRITICAL]** `allowPrivilegeEscalation: false` is mandatory
- **[CRITICAL]** `privileged: true` is forbidden for application workloads
- **[HIGH]** `readOnlyRootFilesystem: true` required; use `emptyDir` volumes for writable paths
- **[HIGH]** `capabilities.drop: ["ALL"]` required; only `add` specific capabilities with justification

### No Plaintext Secrets in Environment Variables

- **[CRITICAL]** Secrets must not use `env.value` directly — use `secretKeyRef`:

```yaml
# Wrong:
env:
  - name: DB_PASSWORD
    value: "mysecret"    # [CRITICAL]

# Correct:
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: my-secret
        key: db-password
```

### Image Pinning

- **[HIGH]** Container images must not use `:latest` tag
- Pin to specific version tag or digest: `my-org/my-service:1.2.3` or `my-org/my-service@sha256:...`

### Rolling Update Strategy

Every Deployment must specify an explicit rolling update strategy:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0   # Never reduce below desired replica count
    maxSurge: 1         # Allow one extra pod during rollout
```

`maxUnavailable: 0` ensures zero capacity loss during deployments.

### PodDisruptionBudget

- **[HIGH]** Every Deployment with `replicas > 1` must have a PodDisruptionBudget
- Prevents node drains from taking all pods offline simultaneously

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: my-service
```

### ServiceAccount

- **[HIGH]** Use a dedicated ServiceAccount per workload — do not use the `default` ServiceAccount
- Set `automountServiceAccountToken: false` unless the workload calls the Kubernetes API

```yaml
spec:
  serviceAccountName: my-service-sa
  automountServiceAccountToken: false
```

### Required Labels

Every resource must include standard Kubernetes recommended labels:

```yaml
labels:
  app.kubernetes.io/name: my-service
  app.kubernetes.io/version: "1.0.0"
  app.kubernetes.io/managed-by: helm    # or: kustomize, kubectl
```
