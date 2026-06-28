---
name: python-patterns
description: "Use when writing, reviewing, or refactoring Python code -- error handling, async, the type system, testing, and project structure."
tags: [python]
---

# Python Patterns

Authoritative reference for idiomatic Python (3.11+). Each reference file is self-contained and can be loaded independently.

---

## When to Use

- Writing new Python packages, services, or scripts
- Reviewing Python PRs for correctness and idioms
- Refactoring existing Python code toward idiomatic style
- Setting up a new Python project (pyproject.toml, src layout)
- Debugging Python-specific issues (async, type checking, import cycles)

---

## Quick Reference

| Topic | Reference File | Contents |
|-------|---------------|---------|
| Core idioms | `references/idiomatic-python.md` | EAFP, comprehensions, context managers, protocols |
| Error handling | `references/error-handling.md` | Exception hierarchy, chaining, custom exceptions |
| Async patterns | `references/async-patterns.md` | asyncio, TaskGroup, async context managers |
| Type system | `references/type-system.md` | Type hints, Protocols, TypedDict, mypy strict |
| Testing | `references/testing.md` | pytest, fixtures, parametrize, property-based |
| Project structure | `references/project-structure.md` | src layout, pyproject.toml, imports |

---

## Limited Context Strategy

When context is tight, load only what you need:
- **Most tasks:** `idiomatic-python.md` + `error-handling.md`
- **Async services:** add `async-patterns.md`
- **Type checking work:** add `type-system.md`
- **Test writing:** `testing.md` only
- **New project setup:** `project-structure.md` only

---

## Overview

Python 3.11+ offers a mature type system, performant async primitives, and `pyproject.toml`-based tooling. Modern idiomatic Python means:
- Type hints on all public APIs (enforced by `mypy --strict`)
- Async-first for I/O-bound services (`asyncio`, not threads)
- `ruff` for linting and formatting (replaces `flake8`, `isort`, `black`)
- `pytest` with fixtures for all testing

---

## Tooling Quick Reference

| Tool | Command | Purpose |
|------|---------|---------|
| `ruff` | `ruff check . && ruff format .` | Lint + format (fast, comprehensive) |
| `mypy` | `mypy --strict src/` | Static type checking |
| `pytest` | `pytest -x -q` | Test runner |
| `pytest-cov` | `pytest --cov=src --cov-report=term-missing` | Coverage |
| `uv` | `uv sync` | Fast dependency management |

---

## Triggers

| Trigger | Example |
|---------|---------|
| Writing Python code | "implement a retry decorator in Python" |
| Reviewing Python PRs | "review this Python service" |
| Error handling questions | "how should I chain this exception?" |
| Async design | "design an async HTTP client with retries" |
| Type system questions | "how do I type a callable with overloads?" |
| Project setup | "set up a new Python service with src layout" |

---

## Key Terms

| Term | Definition |
|------|------------|
| **EAFP** | Easier to Ask Forgiveness than Permission — try the operation, handle the exception |
| **LBYL** | Look Before You Leap — check preconditions before acting (less Pythonic) |
| **Protocol** | Structural subtyping — defines interface via method signatures without inheritance |
| **TypedDict** | Dict type with specific key/value types, checked statically |
| **`__slots__`** | Class attribute to restrict instance dict and reduce memory |
| **TaskGroup** | `asyncio.TaskGroup` (3.11+) — manages a group of concurrent async tasks |
