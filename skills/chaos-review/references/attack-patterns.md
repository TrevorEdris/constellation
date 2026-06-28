# Attack Patterns Reference

Common failure patterns and attack categories for adversarial code review.

## 1. Failure Modes

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Unhandled error | `err` assigned but not checked; bare `except: pass`; missing `.catch()` | Silent data corruption, request returns success on failure |
| Panic path | Index into slice/array without bounds check; nil pointer dereference | Process crash, pod restart, dropped requests during recovery |
| Missing timeout | HTTP client with no timeout; DB query with no context deadline | Thread/goroutine leak, connection pool exhaustion, cascading slowdown |
| Retry storm | Retries without backoff on transient failure | Amplified load on failing service, total outage from thundering herd |
| Resource leak | Opened file/connection in function body, error return before `defer Close()` | File descriptor exhaustion, connection pool starvation, OOM |

## 2. Concurrency

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Shared mutable state | Map/dict accessed from multiple goroutines/threads without lock | Data corruption, panic on concurrent map write, intermittent wrong results |
| Lock ordering | Two mutexes acquired in different orders across call sites | Deadlock under load, hanging requests, cascading timeouts |
| TOCTOU | Check-then-act without atomicity (file exists? then open; key absent? then insert) | Race condition exploitable under concurrent requests, duplicate inserts |
| Goroutine/thread leak | Spawned work with no cancellation path; blocked channel with no timeout | Memory growth, eventual OOM, degraded performance over time |
| Channel deadlock | Unbuffered channel send with no receiver; select with no default | Process hang, health check failure, pod restart loop |

## 3. Input Boundaries

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Integer overflow | Arithmetic on user-supplied integers without bounds; `int32` cast from `int64` | Wrong calculations, negative prices, buffer overflows in unsafe languages |
| Empty collection | `.first()` or `[0]` on potentially empty result set; `min()`/`max()` on empty | Panic/exception, 500 error on valid empty-state request |
| Unicode normalization | String comparison without normalization; length check on bytes vs chars | Authentication bypass (different byte sequences, same visual), truncation attacks |
| Null byte injection | User string concatenated into file path or shell command | Path traversal, command injection via `filename\x00.txt` |
| Max-length input | No limit on request body, query parameter, or field length | Memory exhaustion, regex backtracking DoS, log flooding |

## 4. Error Path Coverage

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Partial write | Multi-step write (insert row, update index, send event) with failure between steps | Inconsistent state: row exists without index, event sent for uncommitted data |
| Leaked resource on error | `open()` then error before `close()`; acquired lock then panic before unlock | Resource starvation, deadlock on next request to same resource |
| Failed rollback | Transaction rollback that itself can fail; compensating action with no retry | Permanently inconsistent state, data that can't be corrected without manual intervention |
| Silent swallow | `catch (e) {}` or `except Exception: pass` | Bugs invisible in production, data loss with no alert, customer-facing errors with no logs |

## 5. Dependency Failures

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Network partition | No circuit breaker on external service call; sync call in request path | Request hangs until timeout, user-facing latency spike, cascade to upstream callers |
| DNS failure | Hardcoded hostname resolution at startup only; no fallback on DNS timeout | Total service outage on DNS blip, no recovery without restart |
| Clock skew | `time.Now()` for distributed ordering; TTL based on wall clock across services | Out-of-order events, premature cache expiry, token validation failures |
| Disk full | Write without checking available space; append-only log with no rotation | Write failures cascade, database corruption, service enters read-only mode |
| Certificate expiry | TLS cert with no monitoring; mTLS with manual rotation | Complete connectivity loss between services at expiry time |

## 6. State Corruption

| Pattern | What to Look For | Blast Radius |
|---------|-----------------|--------------|
| Non-atomic update | Read-modify-write without optimistic locking or transaction | Lost updates under concurrent modification, counter drift, balance errors |
| Cache invalidation race | Write to DB, then invalidate cache — reader between write and invalidation gets stale data | Stale reads served for cache TTL duration, user sees old data after confirmed update |
| Phantom reference | Delete record but don't clean up foreign key references or cached pointers | Null pointer on dereference, 404 on valid-looking link, orphaned data accumulation |
| Eventual consistency gap | Read-after-write to replica; assume consistency in distributed system | User submits form, refreshes, doesn't see their submission — files support ticket |

## Usage

For each finding in the review, map it to one of these categories and use the blast radius template to describe production impact. If a finding doesn't map to any category, it may be too theoretical — reconsider whether it's a real issue.
