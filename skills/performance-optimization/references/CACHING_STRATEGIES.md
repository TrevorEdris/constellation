# Caching Strategies Reference

## Cache Patterns

| Pattern | How It Works | Best For | Tradeoff |
|---------|-------------|----------|----------|
| **Cache-aside (lazy)** | App checks cache; on miss, fetches from DB, writes to cache | Read-heavy workloads; tolerates brief staleness | Cache miss adds one extra RTT |
| **Write-through** | App writes to cache and DB simultaneously on every write | Reads must always be fresh; read-heavy after writes | Write latency increased; cache may hold data that's never read |
| **Write-behind (write-back)** | App writes to cache; async flush to DB on schedule or threshold | Write-heavy; tolerates eventual consistency | Data loss risk if cache node fails before flush |
| **Read-through** | Cache itself fetches from DB on miss (cache library handles it) | Simplifies application code; transparent to callers | Cache library must know the data source |
| **Refresh-ahead** | Cache proactively refreshes entries before they expire | Predictable, high-frequency access patterns | Wastes resources if access pattern is unpredictable |

### Choosing a Pattern

- Default choice: **cache-aside**. Simple, explicit, works everywhere.
- Need zero-stale reads after writes: **write-through**.
- Write throughput is the bottleneck: **write-behind** (with durability consideration).
- Building on a caching framework (Ehcache, Spring Cache): **read-through** may be built-in.
- Hot data with predictable TTL and access pattern: **refresh-ahead**.

---

## TTL Strategy

| Data Type | Suggested TTL | Rationale |
|-----------|--------------|-----------|
| Static configuration (feature flags, app config) | 1h – 24h | Rarely changes; long TTL safe; cache bust on deploy |
| User profile / preferences | 5m – 15m | Changes occasionally; short enough to stay fresh |
| Authorization / permission data | 1m – 5m | Security-sensitive; staleness can cause incorrect access |
| API responses (external service) | 30s – 5m | Depends on upstream freshness SLA |
| Search results / aggregations | 30s – 2m | High compute cost; moderate staleness acceptable |
| Session data | Match session timeout | Security boundary; must expire with session |
| Computed aggregations (counts, sums) | Depends on update frequency | Cache the cost of recomputation; align with batch update interval |
| Public/CDN-served assets | 1d – 1y (with cache-busting) | Immutable content with hashed filenames; maximize CDN efficiency |
| Database query results | 10s – 5m | Depends on write frequency and consistency requirements |

**Rules of thumb:**
- TTL too long: users see stale data; cache poisons itself on bad writes.
- TTL too short: cache hit rate collapses; no performance benefit.
- When in doubt, start shorter and lengthen after measuring hit rate.
- Always use `Cache-Control: max-age` + `ETag` or `Last-Modified` for HTTP caching.

---

## Cache Invalidation Approaches

### Event-Driven Invalidation (preferred for consistency)
Invalidate or update cache entries when the underlying data changes.

```python
# On write, invalidate related cache keys
def update_user_profile(user_id, data):
    db.update("users", user_id, data)
    cache.delete(f"user:{user_id}")
    cache.delete(f"user:email:{data['email']}")  # if email indexed separately
```

Suitable for: systems with clear write events (REST mutations, DB triggers, event bus messages).

### TTL-Based Invalidation (simplest)
Let entries expire naturally. No invalidation code needed.

Suitable for: data where brief staleness is acceptable (config, aggregations, search results).

### Manual / API-Triggered Invalidation
Expose an admin endpoint or CLI command to flush specific cache keys.

```bash
# Redis: invalidate by pattern
redis-cli --scan --pattern "user:*" | xargs redis-cli del

# Application endpoint
POST /admin/cache/invalidate
{ "pattern": "user:12345:*" }
```

Suitable for: emergency cache busts, deployment-triggered refreshes, data corrections.

### Versioned Keys
Append a version number or timestamp to cache keys. "Invalidation" becomes writing a new key; old keys expire naturally.

```python
# Increment version on schema change or major data update
VERSION = "v3"
key = f"product:{product_id}:{VERSION}"
```

Suitable for: cache entries that change in bulk (e.g., after a data migration or feature flag change).

---

## Cache Stampede Prevention

A cache stampede occurs when many concurrent requests simultaneously encounter a cache miss and all attempt to fetch and write the same value to the backing store.

### Mutex / Lock (simplest)
Only one request fetches; others wait.

```python
import threading

_locks = {}

def get_with_lock(key, fetch_fn, ttl):
    value = cache.get(key)
    if value:
        return value

    if key not in _locks:
        _locks[key] = threading.Lock()

    with _locks[key]:
        # Double-check after acquiring lock
        value = cache.get(key)
        if value:
            return value
        value = fetch_fn()
        cache.set(key, value, ttl)
        return value
```

Tradeoff: requests block on miss; adds latency spike at expiration.

### Probabilistic Early Expiration (XFetch Algorithm)
Randomly recompute the cache before it expires, proportional to how close it is to expiry and how long recomputation takes.

```python
import math, random, time

def get_xfetch(key, fetch_fn, ttl, beta=1.0):
    result = cache.get_with_metadata(key)  # returns (value, remaining_ttl, recompute_time)
    if result:
        value, remaining_ttl, delta = result
        # Early recompute probability increases as TTL approaches zero
        if -delta * beta * math.log(random.random()) >= remaining_ttl:
            # Voluntarily recompute early
            value = fetch_fn()
            cache.set_with_metadata(key, value, ttl, delta=time.time())
        return value

    value = fetch_fn()
    cache.set_with_metadata(key, value, ttl, delta=time.time())
    return value
```

Tradeoff: no blocking; some requests do extra work, but stampede is avoided.

### Stale-While-Revalidate
Return stale data immediately; recompute in background.

```python
def get_swr(key, fetch_fn, ttl, stale_ttl):
    value = cache.get(key)
    if value:
        return value  # Fresh hit

    stale = cache.get(f"{key}:stale")
    if stale:
        # Trigger background refresh without blocking caller
        threading.Thread(target=lambda: refresh(key, fetch_fn, ttl, stale_ttl)).start()
        return stale  # Return stale immediately

    # Cold miss: fetch synchronously
    value = fetch_fn()
    cache.set(key, value, ttl)
    cache.set(f"{key}:stale", value, stale_ttl)
    return value
```

Supported natively by HTTP `Cache-Control: stale-while-revalidate=60`.

---

## Cache Key Design

A cache key must uniquely identify the data it represents. Missing parameters return wrong data; extra parameters reduce hit rate.

**Rules:**
- Include every parameter that affects the query result.
- Include user/tenant context when data is user-scoped.
- Use a consistent, predictable prefix scheme: `<entity>:<id>:<variant>`.
- Avoid embedding mutable data in keys (e.g., user's display name changes; their ID does not).

```python
# Bad: Missing user context — all users get the same dashboard
key = "dashboard:summary"

# Good: User-scoped
key = f"dashboard:summary:user:{user_id}"

# Bad: Missing filter parameters
key = f"products:list"

# Good: All query parameters included
key = f"products:list:category:{category}:page:{page}:sort:{sort}"
```

---

## Cache Layer Selection

| Layer | Tool Examples | Best For |
|-------|--------------|---------|
| CDN | Cloudflare, Fastly, CloudFront | Public, cacheable HTTP responses; static assets; geo-distributed reads |
| Reverse proxy | Nginx, Varnish | Server-rendered pages; API response caching at the edge |
| Application (distributed) | Redis, Memcached | Session data, computed results, DB query caching; shared across instances |
| Application (in-process) | LRU dict, Caffeine (JVM) | Ultra-low latency; small, infrequently invalidated datasets; per-instance |
| Database query cache | PostgreSQL `pg_bouncer`, read replicas | Offload read load; not a substitute for application-layer caching |

**Layering principle:** Use multiple layers where appropriate. CDN handles public traffic; Redis handles authenticated/user-specific data; in-process cache handles ultra-hot lookup tables.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Caching everything | Memory pressure; stale data on mutation | Cache selectively based on measured miss cost |
| No eviction policy | Unbounded memory growth → OOM | Set max-memory limit + eviction policy (LRU recommended) |
| Cache key missing parameters | Returns wrong data for different contexts | Audit all parameters that affect the result |
| Caching errors (exceptions) | Errors served repeatedly without retry | Use short TTL for negative caching (5–30s), not full TTL |
| Cache and DB writes not atomic | Inconsistency window on partial failure | Write DB first, then invalidate cache; or use transactions with rollback |
| Shared cache between environments | Test data contaminates production | Namespace keys by environment (`prod:`, `staging:`) |
| Treating cache as primary store | Cache eviction = data loss | Cache is a read-optimization layer; DB is the source of truth |
| Not monitoring hit rate | Can't tell if cache is working | Alert on hit rate drop below threshold (e.g., <80%) |
