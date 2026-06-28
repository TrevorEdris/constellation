---
name: go-patterns
description: "Use when writing, reviewing, or refactoring Go code -- error handling, concurrency, testing, and project structure."
tags: [go]
---

# Go Patterns

Authoritative reference for idiomatic Go (1.21+). Each reference file is self-contained and can be loaded independently.

---

## When to Use

- Writing new Go packages or services
- Reviewing Go PRs for correctness and idioms
- Refactoring existing Go code toward idiomatic style
- Setting up a new Go module or project layout
- Debugging Go-specific issues (goroutine leaks, race conditions, error chain)

---

## Quick Reference

| Topic | Reference File | Contents |
|-------|---------------|---------|
| Core idioms | `references/idiomatic-go.md` | Interfaces, zero values, composition, generics |
| Error handling | `references/error-handling.md` | Wrapping, sentinel errors, custom types, `errors.Is`/`As` |
| Concurrency | `references/concurrency.md` | Goroutines, channels, `errgroup`, `context`, race detection |
| Testing | `references/testing.md` | Table-driven tests, `testify`, race detector, mocks |
| Project structure | `references/project-structure.md` | Module layout, `internal/`, package naming |

---

## Limited Context Strategy

When context is tight, load only what you need:
- **Most tasks:** `idiomatic-go.md` + `error-handling.md`
- **Concurrent code:** add `concurrency.md`
- **Test writing/review:** add `testing.md`
- **New project setup:** `project-structure.md` only

---

## Overview

Go prioritizes simplicity, readability, and explicit behavior. The language design discourages clever abstractions and encourages:
- Small, composable interfaces
- Errors as values, not exceptions
- Concurrency via communicating sequential processes (CSP)
- A single idiomatic way to do most things (`gofmt`, standard project layout)

The compiler and toolchain enforce many conventions. Treat `go vet`, `golangci-lint`, and the race detector as authoritative.

---

## Tooling Quick Reference

| Tool | Command | Purpose |
|------|---------|---------|
| `gofmt` | `gofmt -w .` | Format (no configuration) |
| `goimports` | `goimports -w .` | Format + organize imports |
| `go vet` | `go vet ./...` | Catch common mistakes |
| `golangci-lint` | `golangci-lint run ./...` | Aggregated linters |
| `go test` | `go test -race -count=1 ./...` | Tests with race detection |
| `go build` | `go build ./...` | Compile-check all packages |
| `go mod tidy` | `go mod tidy` | Sync `go.mod` and `go.sum` |

---

## Triggers

| Trigger | Example |
|---------|---------|
| Writing Go code | "implement a worker pool in Go" |
| Reviewing Go PRs | "review this Go handler" |
| Error handling questions | "how should I wrap this error?" |
| Concurrency design | "design a pipeline with context cancellation" |
| Project setup | "structure a new Go service" |

---

## Key Terms

| Term | Definition |
|------|------------|
| **Interface satisfaction** | Implicit in Go — any type with the right methods satisfies an interface |
| **Zero value** | Default value for a type when declared without initialization |
| **Goroutine** | Lightweight concurrent execution unit managed by the Go runtime |
| **Channel** | Typed conduit for communicating between goroutines |
| **errgroup** | `golang.org/x/sync/errgroup` — manages a group of goroutines with error propagation |
| **Sentinel error** | A package-level `var ErrX = errors.New("x")` used for error identity checks |
| **`%w` verb** | Wraps an error so `errors.Is`/`errors.As` can unwrap the chain |
