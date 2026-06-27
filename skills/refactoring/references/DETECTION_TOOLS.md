# Detection Tools

Language-specific tooling for automated code smell and dead code detection. Run these during Phase 1 (Reconnaissance) to generate an initial findings list before manual analysis.

---

## JavaScript / TypeScript

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **knip** | Unused files, unused exports, unused dependencies — the most comprehensive TS dead code finder | `npx knip` |
| **depcheck** | Unused npm dependencies (in package.json but never imported) | `npx depcheck` |
| **ts-prune** | Unused TypeScript exports across the project | `npx ts-prune` |
| **ESLint** | Unused variables, unused imports, unused disable directives | `npx eslint . --report-unused-disable-directives` |
| **jscpd** | Copy-paste duplication detection | `npx jscpd --min-lines 5 src/` |

**Recommended starting point:** `npx knip` — covers the most ground with a single command.

**Complexity analysis:**
```bash
# Cyclomatic complexity via ESLint
npx eslint . --rule '{"complexity": ["warn", 10]}'
```

**Finding large functions:**
```bash
# Functions over 40 lines (adjust threshold as needed)
npx eslint . --rule '{"max-lines-per-function": ["warn", {"max": 40}]}'
```

---

## Python

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **vulture** | Unused code — functions, variables, imports, classes | `vulture src/` |
| **pylint** | Code smells, complexity, design issues | `pylint --disable=all --enable=R src/` |
| **radon** | Cyclomatic complexity per function | `radon cc src/ -a -nc` |
| **flake8** | Complexity (C901), line length (E501), and style | `flake8 --select=C901,E501 src/` |
| **jscpd** | Cross-language copy-paste detection | `jscpd --min-lines 5 src/` |

**Recommended starting point:** `vulture src/ && radon cc src/ -a -nc`

**Radon complexity thresholds:**
- A (1-5): Low — acceptable
- B (6-10): Medium — monitor
- C (11-15): High — refactor soon
- D/E/F (16+): Very high — refactor immediately

---

## Go

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **deadcode** | Unreachable functions and methods | `deadcode ./...` |
| **staticcheck** | Unused parameters, dead code, style issues, bugs | `staticcheck ./...` |
| **golangci-lint** | Composite linter — runs multiple linters in one pass | `golangci-lint run` |

**Recommended starting point:** `staticcheck ./...`

**Cyclomatic complexity:**
```bash
# gocyclo: flag functions with complexity > 10
go install github.com/fzipp/gocyclo/cmd/gocyclo@latest
gocyclo -over 10 .
```

**Unused code:**
```bash
# Find unexported identifiers that are never used
deadcode -test ./...
```

---

## Rust

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **clippy** | Code smells, complexity, style, common mistakes | `cargo clippy -- -W clippy::complexity` |
| **cargo-udeps** | Unused dependencies in Cargo.toml | `cargo +nightly udeps` |

**Recommended starting point:** `cargo clippy`

**Useful clippy lints for refactoring:**
```bash
cargo clippy -- \
  -W clippy::complexity \
  -W clippy::cognitive_complexity \
  -W clippy::too_many_arguments \
  -W clippy::too_many_lines
```

---

## Java / Kotlin

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **PMD** | Code smells, complexity, design issues | `pmd check -d src -R category/java/design.xml` |
| **SpotBugs** | Bug patterns, potential defects | `spotbugs` |
| **Checkstyle** | Style and complexity violations | `checkstyle -c /google_checks.xml src/` |

**PMD rulesets for refactoring:**
```bash
# Design rules (god objects, coupling, complexity)
pmd check -d src -R category/java/design.xml

# Code size rules (long methods, large classes)
pmd check -d src -R category/java/codesize.xml
```

---

## Generic / Multi-Language

| Tool | What It Detects | Command |
|------|-----------------|---------|
| **lizard** | Cyclomatic complexity for most languages | `lizard src/` |
| **SonarQube** | Comprehensive — smells, duplication, complexity, coverage | `sonar-scanner` |
| **jscpd** | Copy-paste duplication, cross-language | `jscpd --min-lines 5 src/` |

**lizard thresholds:**
```bash
# Flag functions with cyclomatic complexity > 10 or > 50 lines
lizard src/ --CCN 10 --length 50
```

---

## Manual / Grep-Based Detection

When automated tooling is unavailable, these patterns surface common smells quickly.

### Long functions (bash)

```bash
# Find functions over 40 lines — adjust pattern for your language
awk '/^(def |func |function |void |public |private )/{start=NR} start && NR-start > 40{print FILENAME ":" start " (" NR-start " lines)"; start=0}' **/*.py
```

### Duplicate strings (potential magic value smell)

```bash
# Strings repeated more than 3 times in source
grep -rh '"[^"]\{5,\}"' src/ | sort | uniq -c | sort -rn | head -20
```

### Unused exports in TypeScript (without knip)

```bash
# Find exported symbols and check if they are imported anywhere
grep -rn "^export " --include="*.ts" src/ | while IFS=: read -r file line content; do
  symbol=$(echo "$content" | grep -oP '(?<=export (const|function|class|type|interface) )\w+')
  [ -n "$symbol" ] && count=$(grep -rn "$symbol" --include="*.ts" src/ | wc -l) && [ "$count" -le 1 ] && echo "$file:$line — $symbol (only 1 reference)"
done
```

### TODO/FIXME comments (technical debt markers)

```bash
grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP" src/ --include="*.{ts,js,py,go,rs,java}"
```

### Large files (candidates for Extract Class)

```bash
# Files over 300 lines
wc -l $(find src/ -name "*.py" -o -name "*.ts" -o -name "*.go") | sort -rn | head -20
```

### Functions with many parameters

```bash
# Python: functions with 5+ parameters
grep -rn "^def .*(.*, .*, .*, .*, " src/ --include="*.py"

# TypeScript: functions with 5+ parameters
grep -rn "function.*(.*, .*, .*, .*, " src/ --include="*.ts"
```

### Commented-out code blocks

```bash
# Lines that look like commented-out code (not documentation)
grep -rn "^[[:space:]]*#[[:space:]]*[a-z_].*(" src/ --include="*.py" | grep -v "# type:" | head -30
```

---

## Tooling Decision Guide

| Situation | Recommended approach |
|-----------|----------------------|
| TypeScript project with npm | Start with `npx knip` |
| Python project | Start with `vulture src/ && radon cc src/ -a -nc` |
| Go project | Start with `staticcheck ./...` |
| Rust project | Start with `cargo clippy` |
| No tooling available | Use grep-based patterns above |
| CI environment | Add lizard or jscpd as a generic baseline |
| Large/unknown codebase | Use SonarQube for comprehensive baseline |

---

## Graceful Degradation

If a tool is not installed:
1. Note the missing tool in the Reconnaissance output
2. Fall back to grep-based detection for the same smell category
3. Do not skip the detection step — manual grep catches most high-severity smells
4. Recommend installing the tool as a Quick Fix in the Refactoring Plan
