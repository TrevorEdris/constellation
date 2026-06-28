# Python Type System

Type hints, Protocols, TypedDict, generics, and mypy strict mode for Python 3.11+.

---

## Annotation Style (Python 3.11+)

Use built-in generics directly — no import from `typing` for basic types.

```python
# Python 3.11+ — no `from typing import List, Dict, Optional`
def process(items: list[str]) -> dict[str, int]:
    return {item: len(item) for item in items}

# Union with | operator
def parse(raw: str | bytes) -> str:
    return raw.decode() if isinstance(raw, bytes) else raw

# Optional is just X | None
def find(items: list[str], key: str) -> str | None:
    return next((i for i in items if key in i), None)
```

---

## Function Signatures

```python
from collections.abc import Callable, Sequence, Iterator
from typing import TypeVar, overload

T = TypeVar("T")

def first(items: Sequence[T]) -> T | None:
    return items[0] if items else None

# Callable types
Transform = Callable[[str], str]

def apply_all(s: str, transforms: list[Transform]) -> str:
    for t in transforms:
        s = t(s)
    return s
```

---

## Protocols

`Protocol` defines structural interfaces without inheritance. Preferred over `ABC` for duck typing.

```python
from typing import Protocol, runtime_checkable

class Serializable(Protocol):
    def to_dict(self) -> dict[str, object]: ...
    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "Serializable": ...

# Works with runtime isinstance checks
@runtime_checkable
class Closeable(Protocol):
    def close(self) -> None: ...

def shutdown_all(resources: list[Closeable]) -> None:
    for r in resources:
        r.close()
```

---

## TypedDict

Typed dicts for structured dict shapes (e.g., JSON payloads, config).

```python
from typing import TypedDict, NotRequired

class UserPayload(TypedDict):
    id: str
    email: str
    name: str
    avatar_url: NotRequired[str]  # optional key

def create_user(payload: UserPayload) -> User:
    return User(
        id=payload["id"],
        email=payload["email"],
        name=payload["name"],
    )
```

---

## TypeVar and Generic Classes

```python
from typing import Generic, TypeVar

T = TypeVar("T")
E = TypeVar("E", bound=Exception)

class Result(Generic[T]):
    """Simple Result type for explicit error handling."""

    def __init__(self, value: T | None, error: Exception | None) -> None:
        self._value = value
        self._error = error

    @classmethod
    def ok(cls, value: T) -> "Result[T]":
        return cls(value, None)

    @classmethod
    def err(cls, error: Exception) -> "Result[T]":
        return cls(None, error)

    @property
    def is_ok(self) -> bool:
        return self._error is None

    def unwrap(self) -> T:
        if self._error:
            raise self._error
        assert self._value is not None
        return self._value
```

---

## Literal Types

```python
from typing import Literal

Status = Literal["pending", "active", "closed"]

def update_status(entity_id: str, status: Status) -> None:
    # mypy ensures only valid values are passed
    ...
```

---

## NewType for Domain Safety

```python
from typing import NewType

UserId = NewType("UserId", str)
OrderId = NewType("OrderId", str)

def get_user(user_id: UserId) -> User: ...
def get_order(order_id: OrderId) -> Order: ...

uid = UserId("u123")
oid = OrderId("o456")
get_user(oid)  # mypy error: Expected UserId, got OrderId
```

---

## Overloads

```python
from typing import overload

@overload
def parse(raw: str) -> dict[str, object]: ...
@overload
def parse(raw: bytes) -> dict[str, object]: ...
@overload
def parse(raw: None) -> None: ...

def parse(raw: str | bytes | None) -> dict[str, object] | None:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)
```

---

## mypy Configuration (strict)

```toml
# pyproject.toml
[tool.mypy]
strict = true
python_version = "3.11"
warn_return_any = true
warn_unused_ignores = true
disallow_untyped_defs = true
```

Strict mode enables: `disallow_any_generics`, `disallow_untyped_defs`, `warn_return_any`, `no_implicit_optional`, and more.

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `Any` everywhere | Defeats type checking | Use `object`, `TypeVar`, or proper union |
| `# type: ignore` without reason | Hides real issues | Add `# type: ignore[specific-code]  # reason` |
| `cast(X, value)` without validation | Unsafe at runtime | Validate first, then cast |
| `dict[str, Any]` for structured data | Loses field-level types | Use `TypedDict` or dataclass |
| Missing return type annotation | mypy can't infer across modules | Always annotate return types on public functions |
