# Matrix Testing Guide

When to use matrix testing, how to design dimensions, and how to control costs.

---

## When Matrix Testing Adds Value

**Use matrix testing when:**
- Publishing a library that must work on multiple runtime versions
- Building native binaries for multiple platforms
- Testing against multiple database versions in a managed service
- The project explicitly supports a range of language versions

**Skip matrix testing when:**
- Building an internal service with a fixed runtime version
- The deployment target is a single platform (most web services)
- Test suite takes >10 minutes -- matrix multiplies that cost
- You control the runtime environment end-to-end

**Rule of thumb:** If users of your software install it on diverse environments, matrix test. If you run it on your own infrastructure with a pinned runtime, don't.

---

## Matrix Dimensions

### Language Versions

```yaml
strategy:
  matrix:
    node-version: [18, 20, 22]      # LTS versions + current
    # go-version: [1.22, 1.23, 1.24]
    # python-version: ['3.10', '3.11', '3.12', '3.13']
    # rust: [stable, beta]           # beta catches upcoming breakage early

jobs:
  test:
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0
        with:
          node-version: ${{ matrix.node-version }}
```

**Recommended version sets:**

| Language | Minimum Set | Full Set |
|----------|------------|----------|
| Node.js | [20, 22] (active LTS + current) | [18, 20, 22] |
| Go | [latest, prev] | [1.22, 1.23, 1.24] |
| Python | [3.11, 3.12] | [3.10, 3.11, 3.12, 3.13] |
| Rust | [stable] | [stable, beta] |

### Operating Systems

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]

runs-on: ${{ matrix.os }}
```

**When OS matrix is worth it:**
- Building CLI tools that users install on multiple OSes
- Libraries with native extensions (Rust, C bindings)
- File path handling code (Windows uses `\`)

**When to skip Windows runner:**
- Web services (deploy to Linux containers)
- Go/Python code without native extensions (usually fine without matrix)

### Database Versions

```yaml
strategy:
  matrix:
    postgres-version: [14, 15, 16]

services:
  postgres:
    image: postgres:${{ matrix.postgres-version }}
    env:
      POSTGRES_PASSWORD: postgres
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
    ports:
      - 5432:5432
```

### Custom Dimensions

```yaml
strategy:
  matrix:
    build-mode: [debug, release]
    feature-flags: [minimal, full]
```

---

## `fail-fast`

Controls whether GitHub Actions cancels all in-progress matrix jobs when one fails.

```yaml
strategy:
  fail-fast: false    # Let all jobs finish even if one fails
  matrix:
    node-version: [18, 20, 22]
```

| Setting | Behavior | Use When |
|---------|---------|---------|
| `fail-fast: true` (default) | Cancel remaining jobs on first failure | Fast feedback loop, cost control, any failure blocks merge |
| `fail-fast: false` | All jobs run regardless | Need to know which combinations fail (e.g., "only fails on Node 18") |

**Recommendation:** Use `fail-fast: false` when debugging multi-version compatibility. Use `fail-fast: true` (or omit it) for normal CI where any failure is a blocker.

---

## `max-parallel`

Control how many matrix jobs run simultaneously. Useful for rate-limited external services or controlling runner cost.

```yaml
strategy:
  max-parallel: 3       # Never run more than 3 jobs at once
  matrix:
    node-version: [18, 20, 22]
    os: [ubuntu-latest, macos-latest, windows-latest]
    # 9 total combinations, but max 3 run at once
```

**Cost impact of `max-parallel`:** Without it, all 9 jobs start simultaneously. At $0.008/min for ubuntu and $0.08/min for macos, a 5-minute test suite costs ~$0.50 per run. `max-parallel: 3` reduces peak runner usage but increases total wall-clock time.

---

## `include` and `exclude`

### `include`: Add specific combinations with extra variables

```yaml
strategy:
  matrix:
    node-version: [18, 20, 22]
    include:
      - node-version: 22
        experimental: true       # Add extra variable only for Node 22
      - node-version: 20
        os: macos-latest         # Test Node 20 on macOS specifically
```

### `exclude`: Remove specific combinations

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node-version: [18, 20, 22]
    exclude:
      - os: windows-latest
        node-version: 18        # Don't test Node 18 on Windows
      - os: macos-latest
        node-version: 18        # Skip Node 18 on macOS too
```

### Practical pattern: Only test old versions on Linux

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    go-version: [1.22, 1.23, 1.24]
    exclude:
      - os: macos-latest
        go-version: 1.22
      - os: macos-latest
        go-version: 1.23
      - os: windows-latest
        go-version: 1.22
      - os: windows-latest
        go-version: 1.23
```

This tests all Go versions on Linux, but only the latest on macOS and Windows.

---

## Service Containers for Database Matrix

```yaml
jobs:
  test:
    strategy:
      matrix:
        database:
          - image: postgres:14
            version: "14"
          - image: postgres:15
            version: "15"
          - image: postgres:16
            version: "16"

    services:
      db:
        image: ${{ matrix.database.image }}
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    env:
      DATABASE_URL: postgres://testuser:testpass@localhost:5432/testdb
      PG_VERSION: ${{ matrix.database.version }}

    steps:
      - run: go test -tags integration ./...
```

---

## Estimated Cost Impact

At GitHub-hosted runner pricing (approximate, check current pricing):

| Runner | Cost/min |
|--------|---------|
| ubuntu-latest (2-core) | $0.008 |
| macos-latest | $0.08 |
| windows-latest | $0.016 |

**Example: Node.js library, 8-min test suite**

| Matrix | Total Jobs | Approx Cost/Run |
|--------|-----------|----------------|
| [20, 22] on ubuntu | 2 | $0.13 |
| [18, 20, 22] on ubuntu | 3 | $0.19 |
| [18, 20, 22] on ubuntu + macos + windows | 9 | $1.44 |
| [18, 20, 22] ubuntu + [20, 22] macos + [22] windows | 6 | $0.75 |

The reduced matrix (last row) tests all versions on Linux, recent versions on macOS, and only the latest on Windows -- good coverage at 48% of full matrix cost.

---

## Reporting Which Combination Failed

GitHub Actions automatically names matrix jobs using the matrix values. The job name becomes:
`test (18, ubuntu-latest)`, `test (20, macos-latest)`, etc.

**Custom job naming:**
```yaml
jobs:
  test:
    name: test (Node ${{ matrix.node-version }} on ${{ matrix.os }})
    strategy:
      matrix:
        node-version: [18, 20, 22]
        os: [ubuntu-latest, macos-latest]
```

**Identifying failures:** GitHub's Actions UI shows a pass/fail icon per combination. The PR check shows "test / test (18, ubuntu-latest) failed" -- no extra tooling needed.
