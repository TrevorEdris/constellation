# Authentication and Authorization Patterns

## Auth Mechanism Comparison

| Mechanism | Best For | Complexity | Stateless |
|-----------|----------|------------|-----------|
| API Key | Server-to-server, simple integrations | Low | Yes |
| Bearer JWT | User-facing APIs, short-lived tokens | Medium | Yes |
| OAuth 2.0 + PKCE | User-delegated access, third-party integrations | High | Yes |
| Session cookies | Traditional web apps, SSR | Low | No |

## Bearer Token (JWT) Pattern

```
Authorization: Bearer eyJhbGciOiJSUzI1NiJ9...
```

JWT payload convention:
```json
{
  "sub": "usr_abc123",
  "iss": "https://auth.example.com",
  "aud": "https://api.example.com",
  "exp": 1730386200,
  "iat": 1730382600,
  "scope": "orders:read orders:write"
}
```

## API Key Pattern

```
X-API-Key: sk_live_abc123xyz
```

- Prefix keys with environment (`sk_live_`, `sk_test_`) for instant recognition
- Hash keys at rest; never store plaintext
- Issue per-integration, not per-user
- Support key rotation without downtime (accept both old and new during transition)

## OAuth 2.0 Flows

| Flow | When |
|------|------|
| Authorization Code + PKCE | Web/mobile apps on behalf of a user |
| Client Credentials | Service-to-service (no user context) |
| Device Code | Devices without browsers (CLI tools, smart TVs) |

## Scoping

Define scopes as `{resource}:{action}` pairs:
```
orders:read          Read orders
orders:write         Create and update orders
orders:delete        Delete orders
users:read           Read user profiles
admin:full           All access (restrict heavily)
```

Request minimum scopes. Validate scopes server-side on every request.

## Rate Limiting Headers

Always return rate limit state in responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1730383200
```

On 429:
```
Retry-After: 47
```
