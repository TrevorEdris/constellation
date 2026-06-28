# TypeScript Project Structure

tsconfig, module resolution, tooling, and monorepo patterns for TypeScript 5.x.

---

## Standard Node.js Service Layout

```
myservice/
├── src/
│   ├── index.ts               # Entrypoint — wires deps, starts server
│   ├── api/
│   │   ├── router.ts
│   │   ├── handlers/
│   │   │   └── users.ts
│   │   └── middleware/
│   │       └── auth.ts
│   ├── domain/
│   │   └── user.ts            # Domain types, no infrastructure deps
│   ├── store/
│   │   ├── index.ts           # Re-exports interface
│   │   ├── user-store.ts      # Interface definition
│   │   └── postgres/
│   │       └── postgres-user-store.ts
│   ├── config.ts              # Config loading + validation (Zod)
│   └── errors.ts              # Domain error classes
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── vitest.config.ts
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Key settings:**
- `"module": "NodeNext"` — enables proper ESM/CJS interop for Node 18+
- `"moduleResolution": "NodeNext"` — requires `.js` extensions in import paths
- `"exactOptionalPropertyTypes"` — `{ a?: string }` does not accept `{ a: undefined }`
- `"noUncheckedIndexedAccess"` — array/object access returns `T | undefined`

---

## tsconfig for Build (Separate from Dev)

```json
// tsconfig.build.json — excludes tests from compilation
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*.test.ts", "tests"]
}
```

---

## package.json (ESM)

```json
{
  "name": "myservice",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/index.ts"
  }
}
```

---

## ESLint Configuration

```javascript
// eslint.config.js (flat config)
import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
```

---

## Monorepo with pnpm Workspaces

```
monorepo/
├── packages/
│   ├── core/           # Shared domain types and utils
│   │   ├── src/
│   │   └── package.json
│   ├── api/            # HTTP service
│   │   ├── src/
│   │   └── package.json
│   └── worker/         # Background processor
│       ├── src/
│       └── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json  # Base TS config extended by packages
└── package.json
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

Package inter-dependency:
```json
// packages/api/package.json
{
  "dependencies": {
    "@myorg/core": "workspace:*"
  }
}
```

---

## Module Aliases (Path Mapping)

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@app/*": ["./src/*"]
    }
  }
}
```

For Node.js runtime resolution, pair with `tsconfig-paths` or configure the bundler.

---

## Import Style

```typescript
// Type-only imports — erased at compile time, no runtime cost
import type { User } from "./domain/user.js";

// Regular imports — values needed at runtime
import { UserService } from "./services/user.js";

// Extension required with NodeNext moduleResolution
import { config } from "./config.js"; // even though file is config.ts
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `skipLibCheck: false` disabled globally | Slows type checking | Keep `true`; only disable for specific libs |
| No `tsconfig.build.json` | Tests compiled into dist | Separate build config excluding tests |
| Circular imports | Runtime errors, hard to debug | Reorganize to layered architecture |
| `require()` in ESM modules | Runtime error | Use `import` or add `"type": "module"` |
| Importing without `.js` extension in NodeNext | Module not found at runtime | Always include `.js` extension |
