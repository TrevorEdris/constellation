# Production Readiness Checklist

A 45-item checklist for verifying a service is ready to go live in production. Review each section with the team before a first production deployment or a major release.

---

## Application

### Health and Observability

- [ ] **Health endpoints implemented**
  - `/health/live` -- Returns 200 if process is alive (no dependency checks)
  - `/health/ready` -- Returns 200 only when all dependencies are reachable
  - `/health/startup` -- Returns 200 when initialization is complete (migrations, cache warm)

- [ ] **Structured logging configured**
  - Log format is JSON (or compatible with log aggregation system)
  - Request ID / trace ID propagated through all log lines
  - Log level is configurable via environment variable (not hardcoded)
  - No secrets, PII, or credentials appear in log output

- [ ] **Distributed tracing instrumented**
  - Spans created for external calls (HTTP, database, cache, queue)
  - Trace context propagated via W3C Trace Context headers

- [ ] **Metrics exposed**
  - Request count, latency (p50/p95/p99), and error rate instrumented
  - Key business metrics defined and tracked
  - Metrics endpoint is not publicly accessible

- [ ] **Error tracking configured**
  - Unhandled exceptions routed to error tracking tool (Sentry, Honeybadger, etc.)
  - Alert on error rate spike

### Resilience

- [ ] **Graceful shutdown implemented**
  - Process handles SIGTERM by stopping acceptance of new requests
  - In-flight requests are allowed to complete before shutdown
  - Shutdown completes within 30 seconds (or Kubernetes `terminationGracePeriodSeconds`)

- [ ] **Timeouts set on all outbound calls**
  - HTTP client timeouts (connect + read)
  - Database query timeouts
  - Cache operation timeouts
  - No call blocks indefinitely

- [ ] **Retry logic implemented for transient failures**
  - Exponential backoff with jitter on retries
  - Idempotency verified before retrying non-idempotent operations

- [ ] **Circuit breakers configured for critical dependencies**
  - External services have circuit breakers to prevent cascade failures

- [ ] **Environment variable validation at startup**
  - All required configuration is validated on startup
  - App fails fast with a clear error if required config is missing

- [ ] **Feature flags implemented for risky features**
  - New features behind flags for gradual rollout

---

## CI/CD Pipeline

- [ ] **CI enforces merge gate** -- No merge to main without passing CI

- [ ] **Automated tests cover critical paths**
  - Unit tests cover business logic
  - Integration tests cover database interactions
  - Contract tests cover critical API interactions (if applicable)
  - End-to-end smoke tests run post-deploy

- [ ] **Pipeline security meets baseline** -- See `references/pipeline-security-checklist.md`

- [ ] **Container image scanned for vulnerabilities** -- No CRITICAL/HIGH CVEs unaddressed

- [ ] **SBOM generated and stored** -- Software Bill of Materials attached to release

- [ ] **Deployment is automated** -- No manual steps required to deploy to production

- [ ] **Rollback is automated and tested** -- Rollback procedure has been run at least once

---

## Infrastructure

### Compute

- [ ] **Auto-scaling configured**
  - Horizontal pod autoscaler (or equivalent) set with appropriate min/max
  - Scale-up triggers tuned to avoid spiking latency during scaling events

- [ ] **Resource requests and limits set**
  - CPU and memory requests reflect actual usage (from load testing)
  - Memory limit prevents OOM from consuming neighboring workloads

- [ ] **Pod disruption budget configured** (Kubernetes)
  - At least 1 replica always available during voluntary disruptions

- [ ] **Multiple replicas running** -- No single points of failure in compute

- [ ] **Anti-affinity rules prevent all replicas on same node** (Kubernetes)

### Networking

- [ ] **Load balancer configured with health checks**
  - Unhealthy instances are removed from rotation automatically

- [ ] **DNS TTL set appropriately**
  - Short TTL (60s) for services that need fast failover
  - Long TTL (300s+) for stable services to reduce DNS load

- [ ] **SSL/TLS certificates valid and auto-renewing**
  - Expiration alerts set at 30 days

- [ ] **Network policies restrict pod-to-pod traffic** (Kubernetes)

### Data

- [ ] **Database has read replicas for high-traffic reads**

- [ ] **Database connection pooling configured**
  - Pool size matches compute tier and workload
  - Connection timeout and max lifetime set

- [ ] **Database migrations are backward-compatible**
  - Old version of app can run alongside new schema during rolling deployment

- [ ] **Backups verified**
  - Automated backups running and tested (restore has been exercised)
  - Point-in-time recovery window meets RTO/RPO requirements

---

## Security

- [ ] **Secrets rotated before go-live**
  - API keys, database credentials, and JWT signing keys are fresh
  - Rotation schedule documented

- [ ] **Dependencies scanned for known vulnerabilities** -- No CRITICAL/HIGH CVEs unaddressed

- [ ] **HTTPS enforced** -- HTTP redirects to HTTPS; HSTS header set

- [ ] **WAF or rate limiting configured**
  - Rate limiting on authentication endpoints
  - WAF rules for common attack patterns (OWASP Top 10)

- [ ] **Least-privilege IAM** -- Service accounts have only the permissions they need

- [ ] **CORS configured correctly** -- Allowed origins are an explicit allowlist, not wildcard (for authenticated APIs)

- [ ] **Security headers set**
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

- [ ] **Input validation and output encoding**
  - SQL injection, XSS, and path traversal vulnerabilities addressed

---

## Monitoring and Alerting

- [ ] **SLOs defined**
  - Availability target (e.g., 99.9%)
  - Latency target (e.g., p95 < 500ms)
  - Error rate target (e.g., < 0.1%)

- [ ] **Alerts configured for SLO burn rate**
  - Alert when error budget is burning faster than sustainable rate

- [ ] **Dashboards created** for key metrics (request rate, error rate, latency, saturation)

- [ ] **On-call rotation established** -- Someone is accountable for alerts 24/7

- [ ] **Escalation policy defined** -- Alert -> first responder -> escalation path

---

## Operations

- [ ] **Runbook written** for common operational procedures:
  - How to deploy
  - How to rollback
  - How to scale up/down
  - How to investigate high error rate

- [ ] **Incident process documented**
  - Incident commander role defined
  - Communication channels established (Slack, status page, etc.)
  - Post-mortem process agreed

- [ ] **Log retention configured** -- Meets compliance requirements

- [ ] **Rollback tested in staging** -- Rollback procedure verified against real traffic patterns

---

## Scoring

Count checked items:

| Score | Status |
|-------|--------|
| 40-45 | Production-ready |
| 30-39 | Ready with known gaps -- document and track |
| 20-29 | Not ready -- critical gaps present |
| <20 | Do not deploy to production |

Document any unchecked items with a justification and an owner + due date before going live.
