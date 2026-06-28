---
description: Python idioms, type hints, and tooling conventions.
paths:
- '**/**/*.py'
- '**/**/pyproject.toml'
- '**/**/requirements*.txt'
---

## Python Patterns

### Core Principles

- **Explicit is better than implicit** — type hints on all public functions and class attributes
- **EAFP over LBYL** — try/except around the operation, not `if hasattr(...)` guards
- **Comprehensions for simple transforms** — list/dict/set comprehensions over `map`/`filter` with lambdas
- **Context managers for resources** — `with` blocks for files, locks, DB connections; never manual `finally` cleanup
- **Protocols over ABCs** — use `typing.Protocol` for structural subtyping; avoid mandatory inheritance

### Error Handling

- Raise specific exceptions, never bare `except:` or `except Exception:` without re-raising
- Chain exceptions with `raise NewError("context") from original_error` to preserve root cause
- Define domain exceptions in a dedicated `exceptions.py`; inherit from a base app exception:

```python
class AppError(Exception): ...
class NotFoundError(AppError):
    def __init__(self, resource: str, id: str) -> None:
        super().__init__(f"{resource} {id!r} not found")
        self.resource, self.id = resource, id
```

- Use `contextlib.suppress(SpecificError)` only when the exception is genuinely ignorable

### Tooling

| Tool | Command | Purpose |
|------|---------|---------|
| `ruff` | `ruff check . && ruff format .` | Lint + format (replaces flake8/isort/black) |
| `mypy` | `mypy --strict src/` | Static type checking |
| `pytest` | `pytest -x -q` | Test runner |
| `pytest-cov` | `pytest --cov=src --cov-report=term-missing` | Coverage |

### Anti-Patterns

- **Mutable default arguments** — `def fn(items=[])` creates shared state; use `None` + `if items is None`
- **`from module import *`** — pollutes namespace and hides dependencies; always explicit imports
- **Bare `except:`** — catches `SystemExit`, `KeyboardInterrupt`; use `except Exception:` at minimum
- **`type: ignore` without comment** — always annotate why: `type: ignore[assignment]  # upstream stub missing`
- **Unchecked `Optional`** — mypy strict mode exposes these; never access `.attr` on a possibly-`None` value

### Deep Reference

For comprehensive patterns, code examples, and project structure guidance, use the `/python-patterns` skill.
