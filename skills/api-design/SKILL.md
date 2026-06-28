---
name: api-design
description: "Use when designing or reviewing an API -- REST endpoints, GraphQL schema, OpenAPI spec, versioning, pagination, error response format, or auth; even when the user just describes endpoints they need without saying 'API design'."
tags: [architecture]
---

# API Design

---

## Quick Start

Just describe your domain:

```
design an API for an e-commerce platform with products, orders, and customers
```

You'll get a complete endpoint design and OpenAPI snippet like:

```yaml
paths:
  /v1/products:
    get:
      summary: List products
      parameters:
        - $ref: '#/components/parameters/PageLimit'
        - $ref: '#/components/parameters/PageCursor'
      responses:
        '200':
          description: Paginated product list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductListResponse'
  /v1/products/{id}:
    get:
      summary: Get product by ID
      responses:
        '200':
          description: Product detail
        '404':
          $ref: '#/components/responses/NotFound'
```

**What to include in your request:**
- Domain or system name (e-commerce, billing, identity)
- Key resources (users, products, orders)
- Relationships (orders belong to users, orders have line items)
- Consumer context (mobile app, internal service, public API)
- Existing constraints (auth system, versioning requirements)

---

## Key Terms

| Term | Definition |
|------|------------|
| **REST** | Representational State Transfer — stateless, resource-oriented HTTP API style |
| **GraphQL** | Query language for APIs with a single endpoint and client-driven data fetching |
| **OpenAPI** | Standard specification format for describing REST APIs (current version: 3.1) |
| **Endpoint** | A URL path + HTTP method combination that handles a specific operation |
| **Resource** | A noun representing an entity in your domain (user, order, product) |
| **Schema** | Formal definition of the shape and constraints of request/response data |
| **Idempotency** | An operation that produces the same result no matter how many times it's called |
| **HATEOAS** | Hypermedia As The Engine Of Application State — embedding navigable links in responses |
| **Pagination** | Strategy for returning large datasets in chunks (offset-based or cursor-based) |
| **Rate Limiting** | Restricting how often a client can call an endpoint within a time window |

---

## Quick Reference

| Task | Approach | Key Consideration |
|------|----------|-------------------|
| New API | Start with resource identification | Model the domain, not the UI |
| Versioning | URL path `/v1/` for simplicity | Commit to support policy before launch |
| Pagination | Cursor-based for large/live data | Offset breaks on concurrent writes |
| Auth | Bearer token (JWT) as default | Scope to least privilege |
| Error handling | `{ error: { type, message, subcode } }` envelope | Machine-readable codes, human-readable messages |
| GraphQL vs REST | REST for CRUD, GraphQL for flexible queries | Consider client diversity and caching needs |

---

## Process Overview

```
Your API Requirements
    |
    v
+-----------------------------------------------------+
| Phase 1: REQUIREMENTS                               |
| * Identify resources and relationships              |
| * Determine consumers (mobile, web, service-to-service) |
| * Define auth model and access control needs        |
| * Enumerate constraints (rate limits, SLAs, quotas) |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Phase 2: DESIGN                                     |
| * Define URL structure and resource hierarchy       |
| * Map HTTP methods to CRUD operations               |
| * Design request/response schemas                   |
| * Choose auth mechanism and scoping                 |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Phase 3: SPECIFY                                    |
| * Generate OpenAPI 3.1 spec (or GraphQL SDL)        |
| * Define error codes and Problem Details format     |
| * Document pagination strategy and parameters       |
| * Add examples for every endpoint                   |
+-----------------------------------------------------+
    |
    v
+-----------------------------------------------------+
| Phase 4: VALIDATE                                   |
| * Run verification checklist                        |
| * Assess breaking change risk                       |
| * Review auth coverage                              |
| * Confirm documentation completeness               |
+-----------------------------------------------------+
    |
    v
Production-Ready API Specification
```

---

## Commands

| Command | When to Use | Action |
|---------|-------------|--------|
| `design api for {domain}` | Starting fresh | Full endpoint design + OpenAPI spec |
| `add endpoints for {resource}` | Extending existing API | New resource endpoints |
| `openapi spec for {api}` | Formalizing existing design | Complete OpenAPI 3.1 document |
| `graphql schema for {domain}` | GraphQL API | Type definitions + queries + mutations |
| `review api` | Auditing existing API | Checklist audit + recommendations |

**Workflow:** Start with `design api` → formalize with `openapi spec` → extend with `add endpoints` → audit with `review api`

---

## Core Principles

| Principle | WHY | Implementation |
|-----------|-----|----------------|
| Resource-oriented design | Resources are stable; operations on them are predictable | Nouns in URLs, verbs in HTTP methods |
| Consistent naming | Reduces cognitive load for consumers | Plural nouns, kebab-case paths, camelCase fields |
| Explicit versioning | Allows evolution without breaking clients | Version in URL path or header, committed from day one |
| Defensive schemas | Fail fast on bad input; never trust caller data | Required fields, format constraints, max lengths |

---

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| Verbs in URLs (`/getUser`, `/createOrder`) | Conflates HTTP method semantics | `GET /users/{id}`, `POST /orders` |
| Inconsistent pluralization | Forces clients to memorize per-resource conventions | Always plural: `/users`, `/orders`, `/products` |
| No versioning on day one | First breaking change forces emergency migration | Add `/v1/` from the start |
| Generic error responses (`{"error": "failed"}`) | Client can't distinguish or act on error | `{ error: { type, message, subcode } }` with typed codes |
| Breaking changes without deprecation | Breaks deployed clients silently | Additive changes only; `Sunset` header for removals |
| Nesting resources more than 2 levels deep | URLs become unmaintainable and coupling increases | `/orders/{id}/items` yes; `/users/{id}/orders/{id}/items/{id}` no |
| FLOAT for monetary values in responses | Floating-point rounding corrupts financial data | Return money as integer cents or string decimal |
| Exposing internal IDs or database row numbers | Leaks implementation, complicates migration | Use opaque IDs (UUIDs or slugs) |

---

## Verification Checklist

After designing an API:

- [ ] All resource URLs use plural nouns
- [ ] No verbs in URL paths
- [ ] Nesting depth is 2 levels maximum
- [ ] URL paths use kebab-case for multi-word segments
- [ ] HTTP methods match semantics (GET=read, POST=create, PUT=replace, PATCH=partial, DELETE=remove)
- [ ] PUT and DELETE are idempotent
- [ ] Status codes are appropriate (201 for creation, 204 for no-content DELETE, 409 for conflict)
- [ ] Version is in URL path or header, documented from day one
- [ ] All endpoints with state mutation require auth
- [ ] Error responses use `{ error: { type, message, subcode } }` envelope
- [ ] Validation errors include field-level detail
- [ ] Pagination included for all collection endpoints
- [ ] Pagination response includes `meta.total`, `meta.cursor`, or `links.next`
- [ ] Money/currency fields use integer cents or string decimal (never float)
- [ ] Dates use ISO 8601 in UTC (`2025-10-31T14:30:00Z`)
- [ ] Content-Type is `application/json` on all JSON endpoints
- [ ] Rate limiting headers documented (`X-RateLimit-Limit`, `X-RateLimit-Remaining`)
- [ ] OpenAPI spec validates without errors
- [ ] Every endpoint has at least one request/response example
- [ ] Breaking changes assessed against existing consumers

See [api-design-checklist.md](references/api-design-checklist.md) for the full pre-launch review checklist.
See [openapi-templates.md](references/openapi-templates.md) for concrete OpenAPI 3.1 spec templates.
See [scalar-api-docs.md](references/scalar-api-docs.md) for interactive API documentation setup (Go, Python, TypeScript, Rust).

---

## References

Consult these when you need detailed patterns for a specific aspect of API design:

| Reference | When to Read |
|-----------|-------------|
| [rest-endpoint-design.md](references/rest-endpoint-design.md) | URL structure, HTTP methods, status codes, sub-resource patterns |
| [response-format.md](references/response-format.md) | Envelope structure, HATEOAS links, field naming, null/date/money handling |
| [versioning-strategies.md](references/versioning-strategies.md) | Choosing a versioning approach, lifecycle management, compatibility rules |
| [pagination-patterns.md](references/pagination-patterns.md) | Offset vs cursor pagination, response format, implementation patterns |
| [error-handling.md](references/error-handling.md) | Error envelope format, status code decision tree, RFC 9457, error code registry |
| [auth-patterns.md](references/auth-patterns.md) | JWT, API keys, OAuth 2.0 flows, scoping, rate limiting headers |
| [openapi-templates.md](references/openapi-templates.md) | Copy-paste OpenAPI 3.1 skeletons, reusable schema patterns, `$ref` strategy |
| [graphql-patterns.md](references/graphql-patterns.md) | Type definitions, query/mutation patterns, Relay pagination, union error types |
| [breaking-changes.md](references/breaking-changes.md) | Breaking vs non-breaking change matrix, deprecation process, migration guide template |

---

## Extension Points

1. **Framework-Specific Patterns:** Express middleware, FastAPI dependency injection, Go `net/http` routing conventions
2. **API Gateway Integration:** Kong, AWS API Gateway, Apigee — rate limiting, auth delegation, routing
3. **Contract Testing:** Pact for consumer-driven contract tests; validate against OpenAPI spec with `dredd`
4. **SDK Generation:** `openapi-generator` for client SDKs from OpenAPI spec; `graphql-code-generator` for TypeScript types
5. **Spec Validation Automation:** `spectral` rulesets in CI, `redocly lint` for doc quality gates
6. **API Mocking:** `prism` for mock servers from OpenAPI spec; enables parallel frontend/backend development
7. **Interactive Documentation:** [Scalar](https://github.com/scalar/scalar) for modern, themeable API reference UI — see [references/scalar-api-docs.md](references/scalar-api-docs.md)
