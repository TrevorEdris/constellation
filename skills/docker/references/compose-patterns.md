# Docker Compose Patterns

## File Conventions

Use the modern `compose.yml` filename (Docker Compose v2+). Avoid `docker-compose.yml` (v1 legacy).

| File | Purpose |
|------|---------|
| `compose.yml` | Base definition — services, networks, volumes |
| `compose.override.yml` | Dev overrides — auto-merged by `docker compose up` |
| `compose.ci.yml` | CI service containers — merged explicitly in CI |
| `compose.prod.yml` | Production-specific overrides (rare — prefer K8s/Helm) |

Merge: `docker compose -f compose.yml -f compose.ci.yml up`

---

## Health Checks and Dependency Ordering

Always use `condition: service_healthy` instead of `condition: service_started`. `service_started` only waits for the container to start, not for the service inside to be ready.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 15s
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  app:
    build:
      context: .
      target: release
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/appdb
      REDIS_URL: redis://redis:6379

volumes:
  postgres_data:
```

**Health check test formats:**
- Shell form (recommended): `["CMD-SHELL", "pg_isready ..."]` — uses `/bin/sh`, allows `&&`
- Exec form: `["CMD", "redis-cli", "ping"]` — no shell, preferred for simple commands
- Note: `$$` escapes `$` in Compose (renders as literal `$` in the shell command)

---

## Volume Strategy

**Named volumes** for persistent data (databases, persistent state):
```yaml
volumes:
  postgres_data:      # Managed by Docker, survives container removal
  redis_data:
```

**Bind mounts** for local development only (source code, config overrides):
```yaml
# In compose.override.yml only — not in base compose.yml
services:
  app:
    volumes:
      - ./src:/app/src:ro        # Mount source for hot-reload
      - ./config/local.yml:/app/config/local.yml:ro
```

**Anonymous volumes** — avoid. They accumulate and are hard to clean up.

---

## Profiles for Optional Services

Use profiles to keep the base stack lean. Optional infrastructure (Kafka, Jaeger, OpenSearch) should be behind profiles.

```yaml
services:
  # Always started
  app:
    build: .
    # no profiles: always starts

  postgres:
    image: postgres:16-alpine
    # no profiles: always starts

  # Optional: started with --profile kafka
  kafka:
    image: confluentinc/cp-kafka:7.7.0
    profiles: ["kafka", "full"]
    depends_on:
      zookeeper:
        condition: service_healthy

  zookeeper:
    image: confluentinc/cp-zookeeper:7.7.0
    profiles: ["kafka", "full"]

  # Optional: started with --profile observability
  jaeger:
    image: jaegertracing/all-in-one:1.60
    profiles: ["observability", "full"]
    ports:
      - "16686:16686"   # UI
      - "4317:4317"     # OTLP gRPC
```

Start profiles: `docker compose --profile kafka up` or `docker compose --profile full up`

---

## Development Override (compose.override.yml)

Auto-merged when running `docker compose up`. Contains dev-only settings that should not go to CI or production.

```yaml
# compose.override.yml — dev only, auto-merged
services:
  app:
    build:
      target: builder    # Build to builder stage for hot-reload
    volumes:
      - ./src:/app/src:ro
      - ./config/local.yml:/app/config/local.yml:ro
    environment:
      - LOG_LEVEL=debug
      - HOT_RELOAD=true
    ports:
      - "2345:2345"    # Delve debugger (Go)

  postgres:
    ports:
      - "5432:5432"    # Expose for local DB client access
```

**Never expose database ports** in `compose.yml` — only in `compose.override.yml`.

---

## CI Compose (compose.ci.yml)

For CI service containers, strip all dev conveniences:

```yaml
# compose.ci.yml — CI use only
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: testdb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test"]
      interval: 2s
      retries: 15
    tmpfs:
      - /var/lib/postgresql/data    # In-memory for CI speed

  redis:
    image: redis:7-alpine
    tmpfs:
      - /data
```

`tmpfs` mounts for CI databases — faster than volumes, data discarded on shutdown.

---

## Docker Compose Watch (Live Reload)

For services that support hot reload, use `docker compose watch` instead of bind mounts:

```yaml
services:
  app:
    develop:
      watch:
        - path: ./src
          action: sync
          target: /app/src
          ignore:
            - node_modules/
        - path: package.json
          action: rebuild
```

Actions:
- `sync` — copy changed files into running container (no restart)
- `rebuild` — rebuild image and recreate container
- `sync+restart` — sync then restart the service entrypoint

Start: `docker compose watch`

---

## Networking

By default, all services in a Compose file share a single network and can reach each other by service name.

```yaml
networks:
  frontend:     # App ↔ reverse proxy
  backend:      # App ↔ database (not exposed to proxy)
  monitoring:   # Prometheus scraping

services:
  nginx:
    networks: [frontend]
  app:
    networks: [frontend, backend]
  postgres:
    networks: [backend]
```

Service discovery: within a network, use service name as hostname (`postgres://postgres:5432`).

---

## Security in Compose

- **Never** commit `compose.override.yml` if it contains real credentials
- Store secrets via environment variables, not hardcoded in `compose.yml`
- Use `.env` file for local secrets (add `.env` to `.gitignore` and `.dockerignore`)
- For shared team secrets, use a secrets manager — don't commit credentials

```yaml
# .env (gitignored)
POSTGRES_PASSWORD=my-local-secret

# compose.yml references .env automatically
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```
