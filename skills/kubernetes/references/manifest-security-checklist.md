# Kubernetes Manifest Security Checklist

Aligned with Kubernetes Pod Security Standards (PSS) Restricted profile.
Severity: [CRITICAL] / [HIGH] / [MEDIUM] / [LOW]

---

## Pod-Level Security Context

Every Pod (via Deployment/StatefulSet/DaemonSet `spec.template.spec`) must have:

```yaml
spec:
  securityContext:
    runAsNonRoot: true          # Reject root containers at admission
    runAsUser: 65534            # nobody; or app-specific UID (1001, etc.)
    runAsGroup: 65534
    fsGroup: 65534              # Files in mounted volumes owned by this GID
    seccompProfile:
      type: RuntimeDefault      # OS default seccomp profile (syscall filtering)
```

- [ ] **[CRITICAL]** `runAsNonRoot: true` — prevents root container execution
- [ ] **[HIGH]** `seccompProfile: RuntimeDefault` — filters dangerous syscalls
- [ ] **[HIGH]** `runAsUser` set to non-zero UID
- [ ] **[MEDIUM]** `fsGroup` set — ensures volume files are accessible to non-root

---

## Container-Level Security Context

Every container in the pod must have:

```yaml
containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false   # Cannot gain more privileges than parent
      readOnlyRootFilesystem: true      # Prevents writes to container filesystem
      capabilities:
        drop: ["ALL"]                   # Drop every Linux capability
        # add: ["NET_BIND_SERVICE"]     # Only add back what's explicitly required
```

- [ ] **[CRITICAL]** `allowPrivilegeEscalation: false`
- [ ] **[CRITICAL]** `capabilities.drop: ["ALL"]` — no capabilities by default
- [ ] **[HIGH]** `readOnlyRootFilesystem: true` — combine with `emptyDir` volumes for writable scratch space:
  ```yaml
  volumeMounts:
    - name: tmp
      mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
  ```
- [ ] **[MEDIUM]** No `privileged: true` anywhere in the manifest

---

## Secrets Management

- [ ] **[CRITICAL]** No plaintext secrets in `env.value` — use `secretKeyRef`:
  ```yaml
  env:
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: my-secret
          key: db-password
  ```
- [ ] **[HIGH]** Kubernetes Secrets are base64-encoded, not encrypted at rest by default — verify etcd encryption is enabled at the cluster level
- [ ] **[HIGH]** Consider using an external secrets operator (External Secrets Operator + Vault, AWS Secrets Manager, GCP Secret Manager) for production

---

## Host Namespace Isolation

- [ ] **[CRITICAL]** `hostNetwork: false` (default) — do not share host network namespace
- [ ] **[CRITICAL]** `hostPID: false` (default) — do not share host PID namespace
- [ ] **[CRITICAL]** `hostIPC: false` (default) — do not share host IPC namespace
- [ ] **[HIGH]** No `hostPath` volumes unless explicitly required by infrastructure tooling (node-level DaemonSets)

---

## RBAC

- [ ] **[HIGH]** Dedicated ServiceAccount per workload — do not use `default`:
  ```yaml
  spec:
    serviceAccountName: my-service-sa
  ```
- [ ] **[HIGH]** `automountServiceAccountToken: false` unless the workload calls the Kubernetes API:
  ```yaml
  spec:
    automountServiceAccountToken: false
  ```
- [ ] **[MEDIUM]** ServiceAccount has only the minimum required RBAC permissions (least-privilege Role/ClusterRole)
- [ ] **[MEDIUM]** No ClusterRoleBinding to `cluster-admin` for application workloads

---

## Network Policy

- [ ] **[HIGH]** Default-deny NetworkPolicy present in the namespace (see `assets/network-policy-default-deny.yaml`)
- [ ] **[HIGH]** Explicit allow-list policies for required ingress/egress
- [ ] **[MEDIUM]** No wildcard `podSelector: {}` in allow policies unless justified

---

## Image Security

- [ ] **[HIGH]** Image tag is not `:latest` — pin to specific version or digest
- [ ] **[HIGH]** `imagePullPolicy: IfNotPresent` or `Always` — never omit on `latest` tags
- [ ] **[MEDIUM]** Image is pulled from a trusted registry with image scanning enabled

---

## Pod Disruption Budget

- [ ] **[HIGH]** PodDisruptionBudget present for every Deployment with `replicas > 1`:
  ```yaml
  spec:
    minAvailable: 1     # Or maxUnavailable: 1 depending on replica count
    selector:
      matchLabels:
        app: my-service
  ```

---

## Additional Checks

- [ ] **[LOW]** Labels include standard Kubernetes recommended labels:
  - `app.kubernetes.io/name`
  - `app.kubernetes.io/version`
  - `app.kubernetes.io/component`
  - `app.kubernetes.io/managed-by`
- [ ] **[LOW]** Annotations include `kubectl.kubernetes.io/last-applied-configuration` is set by `kubectl apply` automatically
