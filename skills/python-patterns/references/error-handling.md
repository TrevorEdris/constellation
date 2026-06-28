# Python Error Handling

Exception hierarchy, chaining, custom exceptions, and best practices for Python 3.11+.

---

## Core Rules

- Always catch specific exceptions — never bare `except:` or `except Exception:` without re-raising
- Preserve the cause chain with `raise ... from ...`
- Define domain exceptions in a dedicated `exceptions.py`

---

## Exception Hierarchy Design

```python
# exceptions.py
class AppError(Exception):
    """Base exception for all application errors."""

class NotFoundError(AppError):
    def __init__(self, resource: str, identifier: str) -> None:
        super().__init__(f"{resource} {identifier!r} not found")
        self.resource = resource
        self.identifier = identifier

class ConflictError(AppError):
    def __init__(self, resource: str, detail: str) -> None:
        super().__init__(f"{resource} conflict: {detail}")
        self.resource = resource

class ValidationError(AppError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"validation error on {field!r}: {message}")
        self.field = field
```

**Rule:** Catch `AppError` at service boundaries; let subclasses propagate through business logic.

---

## Exception Chaining

Always chain exceptions to preserve the original cause:

```python
def load_config(path: str) -> dict[str, str]:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError as e:
        raise ConfigError(f"config file not found: {path}") from e
    except json.JSONDecodeError as e:
        raise ConfigError(f"invalid JSON in config {path}: {e}") from e
```

`raise X from Y` sets `X.__cause__ = Y`, making traceback chains readable:
```
ConfigError: config file not found: /etc/app/config.json
  Caused by: FileNotFoundError: [Errno 2] No such file or directory
```

---

## contextlib.suppress

Only use when the exception is genuinely ignorable (not an error — an expected condition):

```python
from contextlib import suppress

with suppress(FileNotFoundError):
    os.unlink(tmp_path)  # OK to ignore — file may already be gone
```

Do not use `suppress` to hide errors silently.

---

## Exception Groups (Python 3.11+)

`ExceptionGroup` allows multiple unrelated exceptions to propagate together, typically from concurrent code.

```python
async def run_all(tasks: list[Coroutine]) -> None:
    async with asyncio.TaskGroup() as tg:
        for coro in tasks:
            tg.create_task(coro)
    # TaskGroup raises ExceptionGroup if any tasks failed

try:
    await run_all(tasks)
except* ValueError as eg:
    for exc in eg.exceptions:
        log.warning("validation error: %s", exc)
except* NetworkError as eg:
    log.error("network failures: %d", len(eg.exceptions))
```

---

## Logging Exceptions

```python
import logging
log = logging.getLogger(__name__)

def process(item: Item) -> Result | None:
    try:
        return _do_process(item)
    except ValidationError as e:
        log.warning("skipping invalid item %s: %s", item.id, e)
        return None
    except Exception:
        log.exception("unexpected error processing item %s", item.id)
        raise  # re-raise after logging; do not swallow
```

`log.exception()` automatically includes the current exception traceback. Use it in `except` blocks to log + re-raise.

---

## Retrying with Exponential Backoff

```python
import time
import random
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

def retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    retryable: type[Exception] | tuple[type[Exception], ...] = Exception,
) -> T:
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except retryable as e:
            if attempt == max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.1)
            time.sleep(delay)
    raise AssertionError("unreachable")
```

---

## What Not to Do

```python
# WRONG — swallows all errors silently
try:
    result = compute()
except Exception:
    pass

# WRONG — bare except catches SystemExit, KeyboardInterrupt
try:
    ...
except:
    ...

# WRONG — loses original cause
try:
    db.execute(sql)
except DBError as e:
    raise AppError("db failed") # original traceback lost

# CORRECT
try:
    db.execute(sql)
except DBError as e:
    raise AppError("db failed") from e  # chain preserved
```
