# API Design Checklist

Complete checklist for designing and reviewing APIs before launch.

---

## Pre-Design

- [ ] **Requirements Gathered**: Understand the domain, entities, and operations needed
- [ ] **Consumers Identified**: Know who calls the API (mobile app, web app, service-to-service, third parties)
- [ ] **Auth Model Chosen**: Bearer JWT, API key, OAuth 2.0, or session — documented before design begins
- [ ] **Versioning Strategy Decided**: URL path, header, or content negotiation — committed from day one
- [ ] **Existing API Reviewed**: If extending an existing API, conventions are documented and followed
- [ ] **Rate Limiting Policy Defined**: Per-consumer, per-endpoint, or global limits established

---

## Resource Design

- [ ] **Plural Nouns**: All resource collections use plural nouns (`/orders`, not `/order`)
- [ ] **No Verbs in URLs**: Operations expressed as HTTP methods, not URL paths (`POST /orders`, not `/createOrder`)
- [ ] **Consistent Casing**: URL paths use kebab-case; JSON fields use camelCase (or snake_case — pick one and apply everywhere)
- [ ] **Nesting Max 2 Levels**: Sub-resource paths go no deeper than `/v1/{resource}/{id}/{child}`
- [ ] **Opaque IDs**: Resource IDs do not expose internal database sequences or implementation details
- [ ] **No Exposing Internal State**: URLs and field names reflect domain concepts, not database column names

---

## HTTP Semantics

- [ ] **Correct Methods**: GET reads, POST creates, PUT replaces, PATCH partially updates, DELETE removes
- [ ] **Idempotency on PUT**: Replacing a resource with the same data produces the same result
- [ ] **Idempotency on DELETE**: Deleting an already-deleted resource returns 404 (or 204), not an error state
- [ ] **Safe Methods**: GET and HEAD have no side effects
- [ ] **Appropriate Status Codes**:
  - [ ] 201 returned on resource creation (POST)
  - [ ] 204 returned on DELETE with no response body
  - [ ] 400 for malformed requests
  - [ ] 401 for missing/invalid authentication
  - [ ] 403 for authorization failures
  - [ ] 404 for missing resources
  - [ ] 409 for conflicts (duplicate creates, optimistic lock failures)
  - [ ] 422 for semantic/business rule failures
  - [ ] 429 for rate limit violations

---

## Request and Response

- [ ] **Consistent Envelope**: All responses use the same top-level structure (`data`, `meta`, `links`, `errors`)
- [ ] **Content-Type Header**: `Content-Type: application/json` on all JSON endpoints
- [ ] **ISO 8601 Dates**: All date/time fields use `YYYY-MM-DDTHH:MM:SSZ` format in UTC
- [ ] **No Float for Money**: Monetary values are integer cents or string decimal, never float
- [ ] **No Null Arrays**: Empty arrays returned as `[]`, never `null`
- [ ] **Pagination on Collections**: All list endpoints support pagination
- [ ] **Pagination Metadata**: Response includes `meta.total`, cursor, or `links.next`/`links.prev` as appropriate
- [ ] **Max Page Size Enforced**: Server enforces a maximum `limit` regardless of client request
- [ ] **Optional Fields Documented**: Schema distinguishes required vs optional fields explicitly

---

## Error Handling

- [ ] **RFC 7807 Format**: Error responses include `type`, `title`, `status`, `detail`, `instance`
- [ ] **Field-Level Validation Errors**: 422 responses include an `errors` array with `field`, `code`, `message` per violation
- [ ] **Typed Error Codes**: Error `type` URIs are stable and documentable (not ephemeral strings)
- [ ] **Error Code Registry**: All error types are listed in a reference document or OpenAPI extension
- [ ] **No Stack Traces in Responses**: Internal errors return generic messages; details go to logs only
- [ ] **Correlation IDs**: Error responses include `requestId` for tracing

---

## Security

- [ ] **Auth on All Protected Endpoints**: Every state-mutating endpoint requires authentication
- [ ] **Scoping Enforced**: Tokens are validated for the minimum required scope on each endpoint
- [ ] **Input Validation**: All request fields have type constraints, max lengths, and format validation in the schema
- [ ] **Rate Limiting Active**: All public endpoints have rate limiting configured
- [ ] **Rate Limit Headers Returned**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` in responses
- [ ] **CORS Configured**: Allowed origins, methods, and headers are explicitly defined (not wildcard for authenticated APIs)
- [ ] **Sensitive Data Not Logged**: Tokens, passwords, and PII are excluded from access logs and error traces

---

## Documentation

- [ ] **OpenAPI Spec Generated**: Valid OpenAPI 3.1 document covering all endpoints
- [ ] **Examples on Every Endpoint**: At least one request/response example per endpoint in the spec
- [ ] **Error Responses Documented**: All 4xx and 5xx responses listed with schemas in the spec
- [ ] **Changelog Maintained**: Breaking changes, deprecations, and new features are recorded
- [ ] **Deprecation Notices**: Deprecated endpoints marked in spec with migration instructions

---

## Versioning

- [ ] **Version Present from Day One**: API version is in URL path or header — not added retroactively
- [ ] **Deprecation Policy Documented**: Consumers know how much notice they get before a version is removed
- [ ] **No Breaking Changes in Existing Version**: Only additive changes within a major version
- [ ] **Sunset Header Added**: Deprecated endpoints include `Sunset` and `Deprecation` response headers
- [ ] **Migration Guide Available**: Breaking changes have an accompanying migration doc linked from the deprecation header
