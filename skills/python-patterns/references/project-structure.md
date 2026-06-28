# Python Project Structure

Package layout, pyproject.toml, imports, and tooling configuration for Python 3.11+.

---

## Src Layout (Recommended)

The `src/` layout prevents accidental imports of the package from the project root and forces installation for tests.

```
myservice/
├── src/
│   └── myservice/
│       ├── __init__.py
│       ├── api/
│       │   ├── __init__.py
│       │   ├── routes.py
│       │   └── schemas.py
│       ├── domain/
│       │   ├── __init__.py
│       │   └── user.py
│       ├── store/
│       │   ├── __init__.py
│       │   ├── base.py         # Protocol/ABC definitions
│       │   ├── postgres.py     # Postgres implementation
│       │   └── fake.py         # In-memory fake for tests
│       ├── exceptions.py       # All domain exceptions
│       └── config.py           # Settings (pydantic-settings or similar)
├── tests/
│   ├── conftest.py
│   ├── unit/
│   │   └── test_user_service.py
│   └── integration/
│       └── test_store_postgres.py
├── pyproject.toml
└── README.md
```

---

## pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "myservice"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.7",
    "sqlalchemy>=2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5",
    "mypy>=1.10",
    "ruff>=0.4",
    "hypothesis>=6",
]

[tool.hatch.build.targets.wheel]
packages = ["src/myservice"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "UP", "B", "C4", "PTH", "SIM"]
ignore = ["E501"]  # line length handled by formatter

[tool.mypy]
strict = true
python_version = "3.11"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.coverage.run]
source = ["src"]
branch = true
```

---

## Flat Layout (Simple Scripts/Libraries)

For small libraries without service infrastructure:

```
mylib/
├── mylib/
│   ├── __init__.py
│   └── core.py
├── tests/
│   └── test_core.py
└── pyproject.toml
```

---

## Import Organization

```python
# Standard library first
import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING

# Third-party next
import httpx
from pydantic import BaseModel

# Local last
from myservice.domain.user import User
from myservice.exceptions import NotFoundError

# TYPE_CHECKING imports — only needed for type hints, not at runtime
if TYPE_CHECKING:
    from myservice.store.base import UserStore
```

`ruff` with the `I` ruleset enforces this order automatically.

---

## Package Boundaries

- `domain/` — pure business logic, no external dependencies (no ORM, no HTTP clients)
- `store/` — data access; depends on domain types; exposes a `Protocol` that business logic depends on
- `api/` — transport layer; depends on domain services; no direct DB access
- `config.py` — loads and validates all configuration; imported by `main` only

```python
# domain/user.py — no imports from store, api, or external libs
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str

# store/base.py — protocol, no concrete implementations
from typing import Protocol
from myservice.domain.user import User

class UserStore(Protocol):
    def get(self, user_id: str) -> User: ...
    def save(self, user: User) -> None: ...
```

---

## Environment and Configuration

```python
# config.py — using pydantic-settings
from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MYSERVICE_", env_file=".env")

    database_url: PostgresDsn
    api_port: int = Field(default=8080)
    debug: bool = False
    log_level: str = "INFO"

# Usage — call once at startup, pass as dependency
settings = Settings()
```

---

## Dependency Management with uv

```bash
uv init myservice          # create project
uv add httpx pydantic      # add runtime dependencies
uv add --dev pytest mypy   # add dev dependencies
uv sync                    # install all deps from lockfile
uv run pytest              # run in project environment
uv run mypy src/           # type check
```

`uv` is significantly faster than `pip` + `pip-tools` and compatible with `pyproject.toml`.
