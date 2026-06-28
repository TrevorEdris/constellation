# REST Endpoint Design

## Resource Naming

| Rule | Good | Bad |
|------|------|-----|
| Plural nouns | `/users`, `/orders` | `/user`, `/order` |
| kebab-case | `/line-items`, `/tax-rates` | `/lineItems`, `/taxRates` |
| No verbs | `POST /orders` | `POST /createOrder` |
| Opaque IDs | `/users/usr_abc123` | `/users/42` |

## URL Structure

```
/v1/{resource}               # collection
/v1/{resource}/{id}          # single resource
/v1/{resource}/{id}/{child}  # sub-resource (max 2 levels)
```

**Examples:**
```
GET    /v1/orders              # list orders
POST   /v1/orders              # create order
GET    /v1/orders/{id}         # get order
PUT    /v1/orders/{id}         # replace order
PATCH  /v1/orders/{id}         # partial update
DELETE /v1/orders/{id}         # delete order
GET    /v1/orders/{id}/items   # list items for order
POST   /v1/orders/{id}/items   # add item to order
```

## HTTP Method Mapping

| Method | Semantics | Idempotent | Body |
|--------|-----------|------------|------|
| GET | Read, no side effects | Yes | No |
| POST | Create, trigger action | No | Yes |
| PUT | Replace entire resource | Yes | Yes |
| PATCH | Partial update | No* | Yes |
| DELETE | Remove resource | Yes | No |

*PATCH can be made idempotent with conditional requests (`If-Match`)

## Status Code Reference

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST creating a resource |
| 204 | No Content | Successful DELETE, or PUT/PATCH with no body |
| 400 | Bad Request | Malformed request, validation failure |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Authenticated but not authorized |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Duplicate create, optimistic lock failure |
| 422 | Unprocessable Entity | Semantically invalid (business rule violation) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected server failure |
| 503 | Service Unavailable | Temporary outage, maintenance |

## Sub-Resource Patterns

Keep sub-resources to actions that only make sense in context of the parent:

```
# Good: items only exist within an order
GET  /v1/orders/{id}/items
POST /v1/orders/{id}/items

# Prefer flat resources when entities stand alone
GET  /v1/items/{id}       # better than /v1/orders/{oid}/items/{iid}
```

For actions that don't map cleanly to CRUD, use a verb suffix as a last resort:
```
POST /v1/orders/{id}/cancel
POST /v1/orders/{id}/fulfill
POST /v1/users/{id}/verify-email
```
