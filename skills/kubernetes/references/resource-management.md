# Kubernetes Resource Management

## Requests vs Limits

| Field | Meaning | Scheduler Uses | Node Enforces |
|-------|---------|----------------|---------------|
| `requests.cpu` | Guaranteed CPU allocation | Yes — pod placement | No — throttled if exceeded |
| `requests.memory` | Guaranteed memory allocation | Yes — pod placement | OOMKill if exceeded |
| `limits.cpu` | Maximum CPU (throttle) | No | Throttled — not killed |
| `limits.memory` | Maximum memory (OOMKill) | No | OOMKill if exceeded |

**Key insight:** A missing `limits.memory` means a runaway process can consume all node memory and cause a cascade of OOMKills across other pods.

---

## Sizing Methodology

**Do not guess.** Measure first, then set:

1. Run the service under realistic load (load test or production traffic sample)
2. Record P99 CPU and memory usage over a 24-hour window
3. Set `requests` = P99 usage values
4. Set `limits.cpu` = 2-5x requests (CPU throttles, doesn't kill)
5. Set `limits.memory` = 1.5-2x requests (memory OOMKills — be conservative)

**Practical starting points (first deploy, before measurement):**

| Service Type | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-------------|-------------|-----------|----------------|-------------|
| Lightweight API | 50m | 250m | 64Mi | 128Mi |
| Standard backend | 100m | 500m | 128Mi | 256Mi |
| Memory-intensive | 200m | 1000m | 512Mi | 1Gi |
| CPU-intensive | 500m | 2000m | 256Mi | 512Mi |

Revisit after first week in production with actual metrics.

---

## CPU Units

- `1` = 1 vCPU (1 core)
- `500m` = 500 millicores = 0.5 vCPU
- `100m` = 100 millicores = 0.1 vCPU
- CPU is compressible — throttling, not termination, when limit exceeded

## Memory Units

- `128Mi` = 128 Mebibytes (use Mi/Gi, not MB/GB — they're different)
- `1Gi` = 1 Gibibyte
- Memory is incompressible — OOMKill when limit exceeded

---

## LimitRange (Namespace Defaults)

Set namespace-wide defaults to prevent resource-less pods:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: my-namespace
spec:
  limits:
    - type: Container
      default:            # Applied when limits not specified
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:     # Applied when requests not specified
        cpu: "100m"
        memory: "128Mi"
      max:                # Prevent overly large allocations
        cpu: "4"
        memory: "4Gi"
      min:                # Prevent zero-resource pods
        cpu: "10m"
        memory: "32Mi"
```

---

## ResourceQuota (Namespace Caps)

Prevent a namespace from consuming unlimited cluster resources:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: namespace-quota
  namespace: my-namespace
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 4Gi
    limits.cpu: "16"
    limits.memory: 16Gi
    pods: "20"
    persistentvolumeclaims: "10"
```

---

## Horizontal Pod Autoscaler (HPA)

Scale replicas based on CPU or memory utilization:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # Scale up when avg CPU > 70% of request
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

**HPA requires:** `requests.cpu` set on containers (it scales based on requests, not limits).

---

## VPA (Vertical Pod Autoscaler)

Automatically adjust requests/limits based on observed usage. Requires VPA admission controller.

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-service-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  updatePolicy:
    updateMode: "Off"   # "Off" = recommendation only, no auto-apply
                        # "Initial" = apply only at pod creation
                        # "Auto" = evict and recreate (production use with caution)
```

Use `updateMode: "Off"` first to gather recommendations without disruption.

---

## Quality of Service (QoS) Classes

Kubernetes assigns QoS based on requests/limits:

| QoS Class | Condition | OOMKill Priority |
|-----------|-----------|-----------------|
| Guaranteed | `requests == limits` for all containers | Last to be killed |
| Burstable | Some resources have requests != limits | Middle priority |
| BestEffort | No requests or limits set | First to be killed |

For production: aim for **Guaranteed** on critical services, **Burstable** for normal services.
