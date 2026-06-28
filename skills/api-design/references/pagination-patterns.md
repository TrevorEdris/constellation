# Pagination Patterns

## Offset-Based vs Cursor-Based

| Factor | Offset | Cursor |
|--------|--------|--------|
| Implementation | Simple (LIMIT/OFFSET) | Moderate (encode last-seen ID) |
| Performance on large datasets | Degrades (full table scan) | Consistent (index seek) |
| Handles concurrent writes | Skips/duplicates items | Stable position |
| Supports jump to page N | Yes | No |
| Best for | Small datasets, admin UIs | Large/live datasets, feeds |

## Offset Pagination Response

```json
{
  "data": [ ... ],
  "meta": {
    "total": 1842,
    "page": 3,
    "perPage": 20,
    "totalPages": 93
  },
  "links": {
    "self": "/v1/orders?page=3&perPage=20",
    "prev": "/v1/orders?page=2&perPage=20",
    "next": "/v1/orders?page=4&perPage=20",
    "first": "/v1/orders?page=1&perPage=20",
    "last": "/v1/orders?page=93&perPage=20"
  }
}
```

## Cursor Pagination Response

```json
{
  "data": [ ... ],
  "meta": {
    "hasNext": true,
    "hasPrev": true,
    "cursor": {
      "next": "eyJpZCI6MTAwLCJjcmVhdGVkQXQiOiIyMDI1LTEwLTMxIn0=",
      "prev": "eyJpZCI6ODEsImNyZWF0ZWRBdCI6IjIwMjUtMTAtMzAifQ=="
    }
  }
}
```

**Client usage:**
```
GET /v1/orders?limit=20&after=eyJpZCI6MTAwfQ==
```

## Cursor Implementation Pattern

Encode the sort key(s) and last-seen ID in the cursor:
```json
{ "id": 100, "createdAt": "2025-10-31" }
```
Base64-encode this JSON — opaque to the client, but deterministic on the server.

## Pagination Parameters

| Parameter | Offset | Cursor |
|-----------|--------|--------|
| `page` | Page number (1-indexed) | -- |
| `perPage` / `limit` | Items per page | Items per page |
| `after` | -- | Cursor for next page |
| `before` | -- | Cursor for prev page |

Always enforce a maximum `limit` (e.g., 100) server-side regardless of what the client requests.
