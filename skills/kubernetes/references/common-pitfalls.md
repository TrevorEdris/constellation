# Kubernetes Common Pitfalls

## OOMKilled

**Symptom:** Pod status is `OOMKilled` or `Error`, exit code `137`.

**Cause:** Container exceeded `resources.limits.memory`.

**Diagnosis:**
```bash
kubectl describe pod <pod-name>    # Look for "OOMKilled" in Last State
kubectl top pods                   # Current memory usage
kubectl logs <pod-name> --previous # Last logs before crash
```

**Fixes:**
1. Increase `limits.memory` — measure actual P99 usage first
2. Profile the application for memory leaks (goroutine leaks, connection pool leaks, unbounded caches)
3. Add memory profiling endpoint (`/debug/pprof/heap` in Go)
4. Use VPA in recommendation mode to get sizing suggestions

---

## CrashLoopBackOff

**Symptom:** Pod cycles through `CrashLoopBackOff` with exponential backoff (10s → 20s → 40s → 80s → 160s → 300s cap).

**Cause:** Container keeps exiting with non-zero exit code.

**Diagnosis:**
```bash
kubectl logs <pod-name> --previous    # Last crash output
kubectl describe pod <pod-name>       # Events section, exit codes, reason
kubectl get events --sort-by=.lastTimestamp
```

**Common causes:**
- Application panics/crashes at startup (check logs first)
- Liveness probe fires during startup → pod killed before ready (add `startupProbe`)
- Missing required environment variables or secrets (`secretKeyRef` to non-existent Secret)
- `readOnlyRootFilesystem: true` but app writes to non-volume path (add `emptyDir` volume)
- Image entrypoint command not found (check `CMD`/`ENTRYPOINT` vs actual binary path)

---

## ImagePullBackOff / ErrImagePull

**Symptom:** Pod stuck in `ImagePullBackOff`.

**Cause:** Kubernetes cannot pull the container image.

**Diagnosis:**
```bash
kubectl describe pod <pod-name>    # Events section shows exact error
```

**Common causes:**
- Image tag doesn't exist in the registry
- Private registry without `imagePullSecrets`
- Rate limiting (Docker Hub: 100 pulls/6h for unauthenticated)
- Wrong registry URL

**Fix for private registry:**
```yaml
spec:
  imagePullSecrets:
    - name: registry-credentials
```

Create the secret: `kubectl create secret docker-registry registry-credentials --docker-server=... --docker-username=... --docker-password=...`

---

## Pending Pod (Unschedulable)

**Symptom:** Pod stays in `Pending` state indefinitely.

**Diagnosis:**
```bash
kubectl describe pod <pod-name>    # "Events" section → "FailedScheduling"
kubectl describe nodes             # Node capacity and allocatable resources
```

**Common causes:**
- Insufficient CPU or memory on all nodes (`Insufficient cpu` / `Insufficient memory`)
- Node selector or affinity doesn't match any node
- Taint with no matching toleration
- PVC not bound (StatefulSet with dynamic provisioning issues)

**Fix for resource exhaustion:**
- Scale the node group (increase max nodes in auto-scaler)
- Reduce resource `requests` (not limits — only requests affect scheduling)
- Check for resource quota limits: `kubectl describe resourcequota`

---

## Service Not Reaching Pods

**Symptom:** Service exists but requests don't reach pods.

**Diagnosis:**
```bash
kubectl get endpoints <service-name>    # Should list pod IPs — empty means selector mismatch
kubectl describe service <service-name>
kubectl get pods -l app=my-service      # Does the label match?
```

**Common causes:**
- Service selector doesn't match pod labels
- Readiness probe failing — pod excluded from endpoints
- NetworkPolicy blocking traffic

**Fix selector mismatch:**
```yaml
# Service selector must match pod labels exactly
apiVersion: v1
kind: Service
spec:
  selector:
    app.kubernetes.io/name: my-service    # Must match Deployment pod labels
```

---

## Rolling Update Stuck

**Symptom:** `kubectl rollout status deployment/my-service` hangs or shows old pods not terminating.

**Diagnosis:**
```bash
kubectl rollout status deployment/my-service --timeout=5m
kubectl describe deployment my-service    # Check events and conditions
kubectl get replicasets                   # Old RS still has pods?
```

**Common causes:**
- `maxUnavailable: 0` + readiness probe failing → new pods never become ready → old pods never terminate
- `PodDisruptionBudget` blocking termination of old pods
- New image CrashLoopBackOff → rollout fails, old RS preserved

**Fix for failed rollout:**
```bash
# Rollback to previous version
kubectl rollout undo deployment/my-service

# Check rollout history
kubectl rollout history deployment/my-service
```

---

## Secret Not Found / Permission Denied

**Symptom:** Pod fails with `secret "X" not found` or `forbidden: User "system:serviceaccount:ns:sa" cannot get resource "secrets"`.

**Common causes:**
- Secret doesn't exist in the same namespace as the pod
- Secret name in `secretKeyRef` doesn't match the actual Secret name
- RBAC Role doesn't grant access to the Secret

---

## readOnlyRootFilesystem Write Errors

**Symptom:** App crashes with `read-only file system` errors.

**Fix:** Mount `emptyDir` volumes for every writable path:

```yaml
containers:
  - name: app
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: var-run
        mountPath: /var/run
      # Add path the app needs to write to
volumes:
  - name: tmp
    emptyDir: {}
  - name: var-run
    emptyDir: {}
```

Find which paths need write access: run without `readOnlyRootFilesystem` first, then check app logs for write operations.
