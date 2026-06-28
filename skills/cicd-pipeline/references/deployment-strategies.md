# Deployment Strategies

Decision guide and implementation patterns for rolling, blue-green, canary, and preview deployments.

---

## Comparison Table

| Strategy | Rollback Speed | Infra Cost | Complexity | Risk Level | Best For |
|----------|---------------|------------|------------|------------|----------|
| **Rolling** | Minutes (re-deploy old version) | 1x | Low | Medium | Stateless services, acceptable brief mixed versions |
| **Blue-Green** | Seconds (DNS/LB switch) | 2x | Medium | Low | Critical services, zero-downtime requirement, instant rollback |
| **Canary** | Minutes (remove canary weight) | 1.1-1.5x | High | Low | High-traffic services, gradual validation, observability in place |
| **Preview** | N/A (ephemeral) | +env per PR | Medium | None | Pre-merge validation, QA environments, stakeholder review |

---

## Decision Guide

```
Is zero-downtime deployment required?
├── No  → Rolling (simplest, lowest cost)
└── Yes
    └── Is instant rollback critical?
        ├── No  → Blue-Green with DNS TTL of ~60s (still fast)
        └── Yes
            └── Do you have observability (metrics, error rates)?
                ├── No  → Blue-Green (atomic switch, manual monitoring)
                └── Yes
                    └── Is traffic high enough to validate at small %?
                        ├── No (<1000 req/min) → Blue-Green
                        └── Yes → Canary
```

**Preview** is orthogonal to the above -- use it for pre-merge validation regardless of production strategy.

---

## Rolling Deployment

**How it works:** Replace instances one at a time (or in batches). During the update, both old and new versions serve traffic simultaneously.

**Pros:**
- No extra infrastructure cost
- Simple to implement

**Cons:**
- Brief period of mixed versions (API compatibility must be maintained)
- Rollback requires re-deploying the old version (takes time)
- Hard to validate the new version before it reaches all users

### GitHub Actions: Rolling on Kubernetes

```yaml
deploy-rolling:
  needs: build
  environment:
    name: production
    url: https://example.com
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

    - name: Configure kubectl
      uses: azure/setup-kubectl@776e8d6bd5b3c0da2bc54ba21bbf8cd0a0e9dba2  # v4.0.1

    - name: Deploy rolling update
      run: |
        kubectl set image deployment/app app=$IMAGE_TAG
        kubectl rollout status deployment/app --timeout=5m

    - name: Verify health
      run: |
        kubectl wait --for=condition=ready pod -l app=app --timeout=2m
        curl --fail https://example.com/health

    - name: Rollback on failure
      if: failure()
      run: kubectl rollout undo deployment/app
```

### GitHub Actions: Rolling on AWS ECS

```yaml
- name: Deploy to ECS
  uses: aws-actions/amazon-ecs-deploy-task-definition@b1d7a12c9b2b2e843e9df8a0bd76618abd00c7d1  # v2.3.1
  with:
    task-definition: task-definition.json
    service: my-service
    cluster: my-cluster
    wait-for-service-stability: true
    codedeploy-appspec: appspec.yaml    # Use CodeDeploy for blue-green on ECS
```

---

## Blue-Green Deployment

**How it works:** Maintain two identical environments (blue = current production, green = new version). Deploy to green, validate, then switch the load balancer to point at green. Blue becomes idle standby.

**Pros:**
- Zero-downtime (atomic switch)
- Instant rollback (switch back to blue)
- Full validation of new version before it receives any production traffic

**Cons:**
- Double infrastructure cost during deployment
- Database migrations must be backward-compatible (both versions hit the same DB)

### GitHub Actions: Blue-Green on Kubernetes

```yaml
deploy-blue-green:
  environment:
    name: production
  runs-on: ubuntu-latest
  steps:
    - name: Determine target slot
      id: slot
      run: |
        CURRENT=$(kubectl get service app-production -o jsonpath='{.spec.selector.slot}')
        if [ "$CURRENT" = "blue" ]; then
          echo "target=green" >> $GITHUB_OUTPUT
          echo "current=blue" >> $GITHUB_OUTPUT
        else
          echo "target=blue" >> $GITHUB_OUTPUT
          echo "current=green" >> $GITHUB_OUTPUT
        fi

    - name: Deploy to target slot
      run: |
        kubectl set image deployment/app-${{ steps.slot.outputs.target }} app=$IMAGE_TAG
        kubectl rollout status deployment/app-${{ steps.slot.outputs.target }} --timeout=5m

    - name: Smoke test target slot
      run: |
        TARGET_IP=$(kubectl get pod -l slot=${{ steps.slot.outputs.target }} -o jsonpath='{.items[0].status.podIP}')
        curl --fail http://$TARGET_IP/health

    - name: Switch traffic to target slot
      run: |
        kubectl patch service app-production -p '{"spec":{"selector":{"slot":"${{ steps.slot.outputs.target }}"}}}'

    - name: Verify production after switch
      run: |
        sleep 10
        curl --fail https://example.com/health

    - name: Rollback on failure
      if: failure()
      run: |
        kubectl patch service app-production -p '{"spec":{"selector":{"slot":"${{ steps.slot.outputs.current }}"}}}'
```

---

## Canary Deployment

**How it works:** Deploy new version alongside current version, send a small percentage of traffic to the canary (5-10%), monitor error rates and latency, gradually increase traffic if healthy, promote to 100% or rollback.

**Requirements:** Load balancer that supports weighted routing (Nginx ingress, Istio, AWS ALB, GCP Load Balancer).

**Pros:**
- Validates real production traffic before full rollout
- Limits blast radius of bugs
- Data-driven promotion decisions

**Cons:**
- Requires observability (error rates, latency, custom metrics)
- More complex to automate fully
- Canary period extends deployment time

### GitHub Actions: Canary with Weight Progression

```yaml
deploy-canary:
  environment:
    name: production-canary
  runs-on: ubuntu-latest
  steps:
    - name: Deploy canary (5% traffic)
      run: |
        kubectl apply -f k8s/canary.yaml
        kubectl set image deployment/app-canary app=$IMAGE_TAG
        kubectl annotate ingress app-production nginx.ingress.kubernetes.io/canary-weight="5" --overwrite

    - name: Monitor canary (5 minutes)
      run: |
        ./scripts/monitor-canary.sh --duration 300 --error-threshold 0.5 --latency-threshold 200

    - name: Increase traffic to 25%
      run: |
        kubectl annotate ingress app-production nginx.ingress.kubernetes.io/canary-weight="25" --overwrite

    - name: Monitor canary (5 more minutes)
      run: |
        ./scripts/monitor-canary.sh --duration 300 --error-threshold 0.5 --latency-threshold 200

    - name: Promote to 100%
      run: |
        kubectl set image deployment/app-production app=$IMAGE_TAG
        kubectl rollout status deployment/app-production --timeout=5m
        kubectl delete deployment app-canary
        kubectl annotate ingress app-production nginx.ingress.kubernetes.io/canary- --overwrite

    - name: Rollback canary on failure
      if: failure()
      run: |
        kubectl delete deployment app-canary --ignore-not-found
        kubectl annotate ingress app-production nginx.ingress.kubernetes.io/canary- --overwrite
```

---

## Preview Deployments

**How it works:** Deploy an ephemeral environment for each PR. Tear it down when the PR is closed.

**Use cases:**
- QA and stakeholder review before merge
- Integration testing against a real environment
- Verifying infrastructure changes before they hit production

### GitHub Actions: Preview with Comment

```yaml
deploy-preview:
  if: github.event_name == 'pull_request'
  environment:
    name: preview-pr-${{ github.event.pull_request.number }}
    url: https://pr-${{ github.event.pull_request.number }}.preview.example.com
  runs-on: ubuntu-latest
  steps:
    - name: Deploy preview environment
      run: |
        ./deploy.sh preview pr-${{ github.event.pull_request.number }}

    - name: Comment preview URL on PR
      uses: peter-evans/create-or-update-comment@71345be0265236311c031f5c7866368bd1eff043  # v4.0.0
      with:
        issue-number: ${{ github.event.pull_request.number }}
        body: |
          Preview deployed: https://pr-${{ github.event.pull_request.number }}.preview.example.com

cleanup-preview:
  if: github.event.action == 'closed'
  runs-on: ubuntu-latest
  steps:
    - name: Teardown preview environment
      run: ./teardown.sh pr-${{ github.event.pull_request.number }}
```

---

## Health Check Design

Every deployment should verify health before considering it successful.

### Liveness vs Readiness vs Startup

| Probe | Purpose | Failure Action |
|-------|---------|----------------|
| **Startup** | Has the app finished initializing? | Kill and restart |
| **Liveness** | Is the app alive (not deadlocked)? | Kill and restart |
| **Readiness** | Is the app ready to receive traffic? | Remove from load balancer rotation |

```yaml
# Kubernetes health probes
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2

startupProbe:
  httpGet:
    path: /health/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

**Health endpoint design:**
- `/health/live` -- Returns 200 if process is alive. No database checks here.
- `/health/ready` -- Returns 200 only if all dependencies (DB, cache, upstream) are reachable.
- `/health/startup` -- Returns 200 when initial setup is complete (migrations run, caches warmed).

---

## Rollback Procedures

| Platform | Rollback Command |
|----------|-----------------|
| Kubernetes | `kubectl rollout undo deployment/app` |
| Kubernetes (to specific revision) | `kubectl rollout undo deployment/app --to-revision=3` |
| ECS | `aws ecs update-service --service app --task-definition app:42` |
| Vercel | `vercel rollback [deployment-url]` |
| Fly.io | `fly releases rollback` |
| Railway | Roll back via dashboard or `railway up` with previous image |

**Always automate rollback** as part of the deployment workflow. A deployment that doesn't include automated rollback on failure is incomplete.
