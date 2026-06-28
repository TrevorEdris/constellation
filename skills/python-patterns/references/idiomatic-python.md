# Idiomatic Python

Core language idioms and design patterns for Python 3.11+.

---

## EAFP (Easier to Ask Forgiveness than Permission)

Try the operation; handle the exception if it fails. Do not pre-check.

```python
# Good — EAFP
def get_value(d: dict[str, int], key: str) -> int | None:
    try:
        return d[key]
    except KeyError:
        return None

# Bad — LBYL (two lookups, race-prone with mutable state)
def get_value(d: dict[str, int], key: str) -> int | None:
    if key in d:
        return d[key]
    return None
```

---

## Comprehensions

Use for straightforward transforms; switch to a loop when logic grows complex.

```python
# List comprehension
squares = [x ** 2 for x in range(10) if x % 2 == 0]

# Dict comprehension
word_lengths = {word: len(word) for word in words}

# Set comprehension
unique_domains = {email.split("@")[1] for email in emails}

# Generator (lazy — use when not all values are needed)
total = sum(x ** 2 for x in range(1_000_000))
```

Avoid comprehensions with side effects or complex branching — use explicit loops instead.

---

## Context Managers

Use `with` for any resource that needs cleanup. Never rely on `__del__` for cleanup.

```python
# Built-in: files, locks, DB connections
with open("data.txt") as f:
    content = f.read()

# Custom context manager via contextlib
from contextlib import contextmanager

@contextmanager
def timer(label: str):
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        print(f"{label}: {elapsed:.3f}s")

with timer("processing"):
    process_data()

# Class-based
class ManagedTransaction:
    def __enter__(self) -> "ManagedTransaction":
        self.conn.begin()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        return False  # do not suppress exceptions
```

---

## Protocols (Structural Subtyping)

`Protocol` defines an interface without requiring inheritance. The type checker validates conformance structurally.

```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class Closeable(Protocol):
    def close(self) -> None: ...

class FileHandler:
    def close(self) -> None:
        self.file.close()

def shutdown(resource: Closeable) -> None:
    resource.close()

shutdown(FileHandler())  # mypy accepts this without explicit inheritance
```

---

## Dataclasses

Prefer `dataclasses` over plain classes for data-holding objects.

```python
from dataclasses import dataclass, field

@dataclass(frozen=True)  # immutable
class Point:
    x: float
    y: float

    def distance_to(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

@dataclass
class Config:
    host: str
    port: int = 8080
    tags: list[str] = field(default_factory=list)
```

Use `frozen=True` for value objects; mutable dataclasses for mutable state containers.

---

## Descriptors and Properties

```python
class Temperature:
    def __init__(self, celsius: float = 0.0) -> None:
        self._celsius = celsius

    @property
    def celsius(self) -> float:
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        if value < -273.15:
            raise ValueError(f"Temperature {value}°C is below absolute zero")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:
        return self._celsius * 9 / 5 + 32
```

---

## Walrus Operator (`:=`)

Assign and test in one expression — useful in `while` loops and comprehensions.

```python
# Read until empty
while chunk := f.read(8192):
    process(chunk)

# Filter and transform in one pass
valid = [result for raw in data if (result := parse(raw)) is not None]
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Mutable default argument | Shared state across calls | Use `None` + `if arg is None: arg = []` |
| `from module import *` | Namespace pollution, hidden deps | Always explicit imports |
| `isinstance` cascades | Fragile, not extensible | Use `Protocol`, `singledispatch`, or polymorphism |
| Magic number literals | Unreadable | Named constants or `enum.Enum` |
| `print` for debugging | Left in production | Use `logging` module |
| String concatenation in loops | O(n²) | `"".join(parts)` |
