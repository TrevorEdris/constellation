# Performance Review Checklist

Use this checklist during performance reviews. Address items in order — higher sections have higher production impact.

---

## Database & Queries

- [ ] No N+1 query patterns — ORM relationships use eager loading (`select_related`, `include`, `joinedload`, etc.)
- [ ] Queries use appropriate indexes — verify with `EXPLAIN` / `EXPLAIN ANALYZE`
- [ ] No `SELECT *` — explicit column lists only
- [ ] Pagination applied to all unbounded result sets (`LIMIT`/`OFFSET` or cursor-based)
- [ ] Connection pool sized for expected concurrency (not default single-connection settings)
- [ ] No queries inside loops — batch or JOIN instead
- [ ] Bulk/batch operations used for multi-row insert/update/delete
- [ ] Read replicas used for read-heavy or reporting queries where available
- [ ] No queries inside database transactions that could run outside
- [ ] Prepared statements used for repeated query patterns

---

## Algorithmic Complexity

- [ ] Hot path functions are O(n log n) or better — no O(n²) or worse on large inputs
- [ ] No nested loops over large collections where a hash lookup suffices
- [ ] Membership tests use sets/maps, not linear scans over arrays/lists
- [ ] Cyclomatic complexity per function ≤ 10
- [ ] No redundant computation inside loops — hoist invariant calculations
- [ ] Memoization applied to pure functions called repeatedly with the same arguments
- [ ] Sorting performed only when required — not re-sorted on every access
- [ ] Data structures chosen for access pattern (deque for queue, heap for priority, etc.)

---

## Memory & Resources

- [ ] No unbounded in-memory collections (growing maps, slices, arrays with no eviction)
- [ ] Event listeners removed on component unmount / object destruction
- [ ] Streams used for large data processing — entire file/result set not loaded into memory
- [ ] Database connections returned to pool after use (no leaked connections)
- [ ] File handles closed in `finally` / `defer` / `with` / RAII blocks
- [ ] No circular references that prevent garbage collection
- [ ] In-memory caches have eviction policy (LRU, TTL, max-size cap)
- [ ] Goroutines/threads/tasks have defined lifecycle — not started without a stop signal

---

## Caching

- [ ] Frequently accessed, rarely changing data is cached at an appropriate layer
- [ ] Cache TTL matches data volatility (not too long = stale, not too short = ineffective)
- [ ] Cache invalidation triggered on data mutation events
- [ ] No cache stampede risk — mutex, lock, or probabilistic early expiration on miss
- [ ] Cache key includes all parameters that affect the result (user ID, locale, filters, etc.)
- [ ] Appropriate cache layer used: CDN for public assets, reverse proxy for rendered pages, application cache for computed results, query cache for DB results
- [ ] Negative results (empty responses) cached with short TTL, not the same TTL as hits
- [ ] Cache dependencies documented — what clears this cache and when

---

## Bundle & Payload (Frontend)

- [ ] No unused dependencies in the production bundle
- [ ] Large or rarely-used libraries loaded via dynamic `import()` / code splitting
- [ ] Images optimized: WebP format, sized for display dimensions, lazy-loaded below the fold
- [ ] Code splitting at route boundaries (not a single monolithic bundle)
- [ ] Barrel file re-exports verified not to pull entire modules (tree-shaking audit)
- [ ] Gzip or Brotli compression enabled at transport layer
- [ ] Third-party scripts loaded with `async`/`defer` — not render-blocking
- [ ] Bundle size baseline tracked — diff reported in PR if applicable

---

## I/O & Network

- [ ] No synchronous blocking I/O in async/event-loop context (`readFileSync` in Node.js handler, `time.sleep` in async Python, etc.)
- [ ] Batch API calls where possible — no sequential single-item calls to services with batch endpoints
- [ ] Response compression enabled on API endpoints
- [ ] Appropriate timeouts set on all external HTTP/RPC calls
- [ ] Retry logic uses exponential backoff with jitter — not tight polling loops
- [ ] HTTP connection reuse enabled (keep-alive, connection pooling on client)
- [ ] Large payloads streamed, not buffered entirely before response begins
- [ ] gRPC / HTTP/2 used where supported to multiplex concurrent requests

---

## Verification

After implementing fixes:

1. Run `EXPLAIN ANALYZE` on modified queries and compare row estimates and scan types.
2. Profile the hot path before and after (flamegraph, `py-spy`, `pprof`, Chrome DevTools).
3. Load test the endpoint under expected concurrency and compare p50/p95/p99 latency.
4. Monitor memory usage over time (not just at startup) to confirm no accumulation.
5. Bundle analyze before and after (`webpack-bundle-analyzer`, `vite-bundle-visualizer`, etc.).
