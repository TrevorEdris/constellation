# Breaking Change Management

## What Counts as Breaking

| Change | Breaking? | Notes |
|--------|-----------|-------|
| Add optional request field | No | Clients ignore unknown fields |
| Add response field | No | Clients ignore unknown fields |
| Remove request field | Yes | Existing clients may send it |
| Remove response field | Yes | Existing clients may read it |
| Rename field | Yes | Equivalent to remove + add |
| Change field type | Yes | Parsing will fail |
| Tighten validation | Yes | Previously valid requests rejected |
| Loosen validation | No | More permissive |
| Remove endpoint | Yes | 404 where clients expect 200 |
| Change auth requirement | Yes | Auth failures for existing clients |
| Add required request field | Yes | Existing requests missing the field |
| Add new enum value | Usually no* | Depends on client handling unknown values |

*Clients should be designed to handle unknown enum values gracefully.

## Additive-Only Evolution

Design for additive-only changes within a major version:
- Add new optional fields to requests
- Add new fields to responses
- Add new endpoints
- Add new optional query parameters
- Add new enum values (with consumer guidance on handling unknowns)

## Deprecation Process

**Step 1: Mark deprecated in OpenAPI spec**
```yaml
/v1/orders/{id}/cancel:
  post:
    deprecated: true
    description: "Deprecated: Use PATCH /v1/orders/{id} with status=cancelled instead."
```

**Step 2: Add Sunset header to responses**
```
Sunset: Sat, 31 Dec 2026 23:59:59 GMT
Deprecation: true
Link: <https://api.example.com/docs/migrations/v1-to-v2>; rel="deprecation"
```

**Step 3: Notify consumers**
- Email registered API consumers
- Post in developer changelog
- Add in-response warning in `meta.warnings` array

**Step 4: Enforce removal timeline**
- Minimum 6 months from Sunset header to removal for external APIs
- Minimum 2 sprints for internal service-to-service APIs

## Migration Guide Template

```markdown
## Migrating from v1 to v2: Orders

### What changed
- `GET /v1/orders` response: `items` renamed to `lineItems`
- `POST /v1/orders` now requires `shippingAddressId`
- Error format changed from `{"error": "..."}` to `{ error: { type, message, subcode } }`

### Migration steps
1. Update `items` -> `lineItems` in your order parsing code
2. Add `shippingAddressId` to order creation requests
3. Update error handling to read `type` and `detail` from responses

### Timeline
- v1 sunset: 2026-12-31
- v1 removal: 2027-03-31
```
