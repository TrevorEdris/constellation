# Versioning Strategies

## Strategy Comparison

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| **URL path** | `/v1/orders` | Visible, cacheable, easy to test | Pollutes URL, not REST-pure |
| **Request header** | `Accept-Version: 2` | Clean URLs, REST-pure | Harder to test, requires header tooling |
| **Content negotiation** | `Accept: application/vnd.api.v2+json` | Standards-compliant | Verbose, limited browser/tool support |
| **Query parameter** | `/orders?version=2` | Easy to test | Cache-unfriendly, easy to forget |

## Recommendation

**Default: URL path versioning.**
- Easiest to understand, document, and test
- Works natively with all HTTP clients and proxies
- Every environment can hit a specific version directly

Use header versioning only when you have multiple clients with very different needs and want a single URL namespace.

## Version Lifecycle

```
v1 (stable)   ──────────────────────────────────► active
v2 (preview)  ────────► stable ─────────────────► active
v1 (sunset)             Sunset header added ──────► deprecated ──► removed
```

Timeline example:
- **v1 launch**: `/v1/` is stable, no deprecation
- **v2 launch**: Announce v2, keep v1 running
- **v1 sunset**: Add `Sunset: Sat, 31 Dec 2026 23:59:59 GMT` header to v1 responses
- **v1 removal**: 6-12 months after Sunset header, remove v1

## Backward-Compatible Changes (No Version Bump Needed)

- Adding optional request fields
- Adding new response fields
- Adding new endpoints
- Adding new enum values (if clients handle unknown values)
- Relaxing validation (e.g., increasing max length)

## Breaking Changes (Require Version Bump)

- Removing or renaming fields
- Changing field types
- Removing endpoints
- Changing HTTP methods
- Tightening validation
- Changing authentication requirements
