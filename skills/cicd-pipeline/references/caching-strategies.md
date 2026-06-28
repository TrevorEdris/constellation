# Caching Strategies

Per-language and per-package-manager cache configurations for GitHub Actions and GitLab CI.

---

## Core Concepts

**Cache key:** A string that identifies a cache. Cache is only reused when the key matches exactly. Always include a hash of the lockfile -- if the lockfile changes, the key changes, and the cache is regenerated.

**Restore keys:** Fallback keys tried in order when the exact key doesn't match. Use restore keys to get a partial cache hit (faster than downloading everything from scratch, even if stale).

**Cache invalidation:** Change the cache key to force regeneration. Common patterns: `${{ runner.os }}` prefix for OS-specific caches, `${{ hashFiles('lockfile') }}` for dependency-specific caches.

---

## Node.js (npm)

```yaml
- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-

- run: npm ci  # Uses the cache populated above
```

**Why `~/.npm` and not `node_modules`?**
`npm ci` deletes and recreates `node_modules` every time. Caching `~/.npm` (npm's internal cache) is the correct layer -- `npm ci` populates `node_modules` from `~/.npm` without making network requests.

---

## Node.js (pnpm)

```yaml
- uses: pnpm/action-setup@a7487ba4f4f5e0a6b19d8d5b20c4c0eba041f3c0  # v4.1.0
  with:
    version: 9

- name: Get pnpm store path
  id: pnpm-cache
  run: echo "store=$(pnpm store path --silent)" >> $GITHUB_OUTPUT

- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: ${{ steps.pnpm-cache.outputs.store }}
    key: pnpm-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      pnpm-${{ runner.os }}-

- run: pnpm install --frozen-lockfile
```

pnpm's content-addressable store is the correct cache target. Do not cache `node_modules` for pnpm -- it manages symlinks that don't restore well from cache.

---

## Node.js (yarn v3+)

```yaml
- name: Get Yarn cache directory
  id: yarn-cache-dir
  run: echo "dir=$(yarn config get cacheFolder)" >> $GITHUB_OUTPUT

- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: ${{ steps.yarn-cache-dir.outputs.dir }}
    key: yarn-${{ runner.os }}-${{ hashFiles('**/yarn.lock') }}
    restore-keys: |
      yarn-${{ runner.os }}-

- run: yarn install --immutable
```

---

## Go

```yaml
- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: |
      ~/go/pkg/mod        # Downloaded module cache
      ~/.cache/go-build   # Build artifact cache
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      go-${{ runner.os }}-
```

**Two cache paths:**
- `~/go/pkg/mod`: Downloaded module source. Changes when `go.sum` changes.
- `~/.cache/go-build`: Compiled build artifacts. Speeds up incremental builds even when modules haven't changed.

**Alternative:** `actions/setup-go` with `cache: true` (v5+) handles this automatically:
```yaml
- uses: actions/setup-go@d60b41a563a35a8c32d69f5d4f82aab80ae4af30  # v5.5.0
  with:
    go-version-file: go.mod
    cache: true             # Automatically caches ~/go/pkg/mod and ~/.cache/go-build
```

---

## Python (pip)

```yaml
- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: ~/.cache/pip
    key: pip-${{ runner.os }}-${{ hashFiles('**/requirements*.txt') }}
    restore-keys: |
      pip-${{ runner.os }}-

- run: pip install -r requirements.txt
```

**Alternative:** `actions/setup-python` with `cache: pip` handles this automatically:
```yaml
- uses: actions/setup-python@a26af69be951a213d495a4f99b4a7e1547b2428c  # v5.6.0
  with:
    python-version: '3.12'
    cache: pip
    cache-dependency-path: requirements.txt
```

---

## Python (poetry)

```yaml
- name: Get poetry cache dir
  id: poetry-cache
  run: echo "dir=$(poetry config cache-dir)" >> $GITHUB_OUTPUT

- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: ${{ steps.poetry-cache.outputs.dir }}
    key: poetry-${{ runner.os }}-${{ hashFiles('poetry.lock') }}
    restore-keys: |
      poetry-${{ runner.os }}-

- run: poetry install --no-interaction
```

---

## Rust (Cargo)

```yaml
- uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684  # v4.2.3
  with:
    path: |
      ~/.cargo/registry/index/   # Registry index
      ~/.cargo/registry/cache/   # Downloaded crate source
      ~/.cargo/git/db/           # Git dependencies
      target/                    # Build artifacts
    key: cargo-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}
    restore-keys: |
      cargo-${{ runner.os }}-
```

**Warning:** `target/` can be very large (1-5+ GB). GitHub Actions cache has a 10 GB per-repo limit. For large projects, cache only `~/.cargo/registry` and skip `target/`.

**Alternative:** `Swatinem/rust-cache` action handles Rust caching with smarter invalidation:
```yaml
- uses: Swatinem/rust-cache@98c8021b550208c8a2f8f5b5d2b7c4d3e6f0a9b  # v2.8.0
```

---

## Docker (Layer Caching)

### GitHub Actions Cache Backend

```yaml
- uses: docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c2  # v6.18.0
  with:
    context: .
    push: true
    tags: ${{ env.IMAGE_TAG }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

`mode=max` caches every layer, not just the final one. Use `mode=min` for smaller cache size at the cost of cache hit rate.

### Registry-Based Layer Caching

```yaml
- uses: docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c2  # v6.18.0
  with:
    cache-from: type=registry,ref=ghcr.io/org/app:cache
    cache-to: type=registry,ref=ghcr.io/org/app:cache,mode=max
```

Registry-based caching persists across workflow runs and works across different machines.

---

## GitLab CI Cache Patterns

### Node.js (pnpm)

```yaml
.cache-pnpm:
  cache:
    key:
      files:
        - pnpm-lock.yaml
    paths:
      - .pnpm-store/
    policy: pull-push

install:
  extends: .cache-pnpm
  script:
    - pnpm config set store-dir .pnpm-store
    - pnpm install --frozen-lockfile
```

### Go

```yaml
.cache-go:
  cache:
    key:
      files:
        - go.sum
    paths:
      - .cache/go/
    policy: pull-push
  variables:
    GOPATH: $CI_PROJECT_DIR/.cache/go
    GOMODCACHE: $CI_PROJECT_DIR/.cache/go/pkg/mod
    GOCACHE: $CI_PROJECT_DIR/.cache/go/build
```

**Important for GitLab CI:** Cache paths must be relative to `$CI_PROJECT_DIR`. Set `GOPATH` to a local directory so Go uses project-relative paths that GitLab CI can cache.

---

## Cache Key Patterns

| Pattern | Use When | Example |
|---------|---------|---------|
| `${{ runner.os }}-lockfile-hash` | OS-specific, lockfile-driven deps | `npm-Linux-abc123` |
| `${{ runner.os }}-${{ matrix.node-version }}-hash` | Matrix builds | `npm-Linux-20-abc123` |
| `${{ runner.os }}-weekly` | Large caches that rarely change | `cargo-Linux-2026-08` |
| `${{ github.sha }}` | Per-commit artifacts | `dist-abc1234` |

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Caching `node_modules` with npm | npm ci deletes it; cache is stale instantly | Cache `~/.npm` instead |
| No lockfile in cache key | Cache may contain wrong dependency versions | Always hash the lockfile |
| Single cache key, no restore-keys | Zero-hit cache on first run after lockfile change | Add restore-keys as fallback |
| Caching everything including build artifacts | Cache grows unbounded, pollutes CI | Cache only downloaded dependencies |
| Not using OS in cache key | Linux cache used on macOS (incompatible binaries) | Always prefix with `${{ runner.os }}` |
| `policy: pull-push` on every job | Every job writes cache, last write wins | Set `policy: pull` on consumer jobs, `policy: push` on the install job |
