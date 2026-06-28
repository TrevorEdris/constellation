# Error Handling

## Error Response Format

Standard error envelope:

```json
{
  "error": {
    "type": "BAD_REQUEST",
    "message": "Invalid email address format",
    "subcode": 12001
  }
}
```

| Field | Description |
|-------|-------------|
| `error.type` | Machine-readable error category (SCREAMING_SNAKE_CASE) |
| `error.message` | Short, human-readable description of the error |
| `error.subcode` | Numeric code for programmatic handling and documentation lookup |

**Validation errors** add a `fields` array:

```json
{
  "error": {
    "type": "VALIDATION_FAILED",
    "message": "One or more fields failed validation",
    "subcode": 10001,
    "fields": [
      { "field": "quantity", "code": "INVALID_RANGE", "message": "Must be between 1 and 999" },
      { "field": "productId", "code": "NOT_FOUND", "message": "Product prod_zzz does not exist" }
    ]
  }
}
```

## Request and Trace IDs

Every response (success and error) must include correlation headers:

```
X-Request-Id: req_abc123              # Server-generated if client omits
X-Trace-Id: trace_def456             # Distributed tracing correlation
Retry-After: 60                       # Seconds until retry (429, 503)
```

- **X-Request-Id:** If the client sends one, echo it back. Otherwise, generate a UUID server-side. Log it with every request.
- **X-Trace-Id:** Propagated through all downstream service calls for distributed tracing.
- **Do NOT put trace IDs in the error body.** Headers are the canonical location — they're present on all responses (not just errors), are accessible to proxies/load balancers, and avoid coupling error schemas to tracing infrastructure.

## Error Code Registry

Define typed error codes as constants in your API:

```
VALIDATION_FAILED       422   One or more fields are invalid           10001
RESOURCE_NOT_FOUND      404   The requested resource does not exist     10002
DUPLICATE_RESOURCE      409   A resource with this identifier exists    10003
INSUFFICIENT_FUNDS      422   Account balance is insufficient           10004
RATE_LIMIT_EXCEEDED     429   Too many requests; retry after X seconds  10005
UNAUTHORIZED            401   Authentication credentials invalid        10006
FORBIDDEN               403   Caller lacks permission for this action   10007
```

Document the full registry in your OpenAPI spec under `x-error-codes`.

## HTTP Status Decision Tree

```
Is the request malformed JSON?          -> 400 Bad Request
Do the fields fail validation?          -> 422 Unprocessable Entity
Is authentication missing or invalid?   -> 401 Unauthorized
Is the user authenticated but denied?   -> 403 Forbidden
Does the resource not exist?            -> 404 Not Found
Does a conflict exist (duplicate)?      -> 409 Conflict
Did a business rule fail?               -> 422 Unprocessable Entity
Is the server broken?                   -> 500 Internal Server Error
Is the service temporarily unavailable? -> 503 Service Unavailable
```

## RFC 9457 Compatibility

The error format above is intentionally simpler than RFC 9457 (Problem Details). If your API must comply with RFC 9457, use:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "One or more fields failed validation.",
  "instance": "/v1/orders/ord_xyz"
}
```

Set `Content-Type: application/problem+json` for RFC 9457 responses.
