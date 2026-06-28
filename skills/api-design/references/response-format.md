# Response Format

## Envelope Structure

Use a consistent envelope for all responses:

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2025-10-31T14:30:00Z"
  },
  "links": {
    "self": "/v1/orders/ord_xyz",
    "next": "/v1/orders?cursor=eyJpZCI6MTAwfQ"
  },
  "errors": [ ... ]
}
```

- `data` — the primary payload (object for single, array for collection)
- `meta` — pagination cursors, request IDs, timestamps
- `links` — HATEOAS navigation (self, next, prev, related actions)
- `errors` — only present on error responses (4xx/5xx)

## HATEOAS: Links and Actions

Use the `links` object for both navigation and available actions on the resource. Each key is a [link relation type](https://www.iana.org/assignments/link-relations/link-relations.xhtml):

```json
{
  "data": {
    "id": "ord_xyz",
    "status": "pending",
    "total": 1099
  },
  "links": {
    "self": { "href": "/v1/orders/ord_xyz" },
    "cancel": { "href": "/v1/orders/ord_xyz/cancel", "method": "POST" },
    "items": { "href": "/v1/orders/ord_xyz/items" },
    "payment": { "href": "/v1/orders/ord_xyz/pay", "method": "POST" }
  }
}
```

**Key principles:**
- Actions are state-dependent — `cancel` only appears when the order is cancellable
- Include `method` when the action is not a GET (avoids client guessing)
- Use IANA-registered relation types where they exist (`self`, `next`, `prev`, `collection`)
- Use descriptive custom relation types for domain actions (`cancel`, `approve`, `payment`)
- Do NOT use a separate `actions` array — this is Siren format, not widely adopted. Standard `links` with method hints covers the same use case with less complexity

## Field Naming Convention

| Convention | When | Example |
|------------|------|---------|
| camelCase | JSON APIs (default) | `createdAt`, `lineItems` |
| snake_case | Python/Go backends matching language convention | `created_at`, `line_items` |

Pick one and apply it everywhere. Document it in your OpenAPI spec's `x-naming-convention` extension.

## Null Handling

- Omit optional fields that have no value rather than returning `null` where possible
- When `null` is semantically meaningful (explicitly unset vs absent), include it with documentation
- Never return `null` for arrays — return `[]`

## Date Format

Always ISO 8601 in UTC:
```
"createdAt": "2025-10-31T14:30:00Z"     # correct
"createdAt": "10/31/2025 2:30 PM"       # wrong — ambiguous and locale-dependent
"createdAt": 1730382600                 # avoid — requires client-side conversion
```

## Monetary Values

```json
{
  "amount": 1099,
  "currency": "USD",
  "amountFormatted": "$10.99"
}
```

- Store and transmit as integer cents (or smallest currency unit)
- Include currency code with every monetary field
- Optionally include a pre-formatted display string for convenience
