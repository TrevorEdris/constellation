# Scalar — Interactive API Documentation

[Scalar](https://github.com/scalar/scalar) renders interactive API documentation from OpenAPI specs. Replaces Swagger UI with a modern, themeable interface.

## When to Use

- Any endpoint that serves OpenAPI/Swagger docs
- Replace default `/docs` or `/swagger` endpoints
- Serve interactive API reference for internal or external consumers

## Go — `scalar-go`

```bash
go get github.com/bdpiprava/scalar-go
```

```go
package handler

import (
	"encoding/json"
	"net/http"

	scalargo "github.com/bdpiprava/scalar-go"
)

// DocsHandler serves interactive API docs from an OpenAPI spec.
func DocsHandler(specJSON []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		html, err := scalargo.NewV2(
			scalargo.WithSpecBytes(specJSON),
			scalargo.WithTheme(scalargo.ThemeKepler),
			scalargo.WithDarkMode(),
		)
		if err != nil {
			http.Error(w, "failed to render docs", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(html))
	}
}
```

**Options:** `WithSpecURL(url)`, `WithTheme(theme)`, `WithDarkMode()`, `WithLayout(LayoutModern | LayoutClassic)`, `WithSidebarVisibility(bool)`, `WithHideModels()`.

**Themes:** `ThemeDefault`, `ThemeMoon`, `ThemePurple`, `ThemeSolarized`, `ThemeBluePlanet`, `ThemeDeepSpace`, `ThemeSaturn`, `ThemeKepler`, `ThemeMars`.

## Python — `scalar-fastapi`

```bash
pip install scalar-fastapi
```

```python
from fastapi import FastAPI
from scalar_fastapi import get_scalar_api_reference

app = FastAPI()

@app.get("/docs", include_in_schema=False)
async def scalar_docs():
    return get_scalar_api_reference(
        openapi_url=app.openapi_url,
        title=app.title,
    )
```

For Flask/Django, use the CDN embed approach below.

## TypeScript — `@scalar/api-reference`

```bash
npm install @scalar/api-reference
```

**Express middleware:**
```typescript
import { apiReference } from "@scalar/express-api-reference";

app.use("/docs", apiReference({
  spec: { url: "/openapi.json" },
  theme: "kepler",
  darkMode: true,
}));
```

**React component:**
```tsx
import { ApiReference } from "@scalar/api-reference-react";

export default function Docs() {
  return (
    <ApiReference
      configuration={{
        spec: { url: "/openapi.json" },
        theme: "kepler",
        darkMode: true,
      }}
    />
  );
}
```

## Rust — `scalar-doc`

```toml
[dependencies]
scalar-doc = "0.1"
```

```rust
use scalar_doc::Documentation;

async fn docs_handler() -> impl IntoResponse {
    Html(Documentation::new("My API", "/openapi.json")
        .theme("kepler")
        .build())
}
```

## CDN Embed (Any Framework)

For frameworks without a dedicated Scalar package, embed via CDN:

```html
<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <meta charset="utf-8" />
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
```

## Integration Checklist

- [ ] OpenAPI spec is served at a stable URL (e.g., `/openapi.json`)
- [ ] Scalar docs endpoint is excluded from the OpenAPI spec itself (`include_in_schema=False`)
- [ ] Auth credentials are not embedded in the spec
- [ ] Spec validates without errors (run `spectral lint` or `redocly lint` first)
