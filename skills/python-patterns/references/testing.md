# Python Testing

pytest, fixtures, parametrize, mocking, and property-based testing for Python 3.11+.

---

## Basic Test Structure

```python
# tests/test_user_service.py
import pytest
from myapp.services.user import UserService
from myapp.exceptions import NotFoundError

class TestUserService:
    def test_get_user_returns_user(self, user_service: UserService) -> None:
        user = user_service.get("u1")
        assert user.id == "u1"
        assert user.email == "alice@example.com"

    def test_get_user_raises_not_found(self, user_service: UserService) -> None:
        with pytest.raises(NotFoundError) as exc_info:
            user_service.get("nonexistent")
        assert exc_info.value.resource == "user"
```

---

## Fixtures

Fixtures provide reusable setup/teardown. Prefer function-scoped (default) unless sharing is intentional.

```python
# conftest.py
import pytest
from myapp.store import UserStore
from myapp.services.user import UserService

@pytest.fixture
def fake_store() -> UserStore:
    """In-memory store pre-populated with test data."""
    from myapp.store.fake import FakeUserStore
    store = FakeUserStore()
    store.add(User(id="u1", email="alice@example.com", name="Alice"))
    return store

@pytest.fixture
def user_service(fake_store: UserStore) -> UserService:
    return UserService(store=fake_store)

# Module-scoped fixture (one instance per test module)
@pytest.fixture(scope="module")
def db_connection():
    conn = create_test_db()
    yield conn
    conn.close()
```

---

## Parametrize

Run the same test with multiple input sets.

```python
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("42", 42),
        ("0", 0),
        ("-1", -1),
        ("1_000", 1000),
    ],
    ids=["positive", "zero", "negative", "underscore_sep"],
)
def test_parse_int(raw: str, expected: int) -> None:
    assert parse_int(raw) == expected

@pytest.mark.parametrize(
    "invalid",
    ["", "abc", "1.5", None],
)
def test_parse_int_invalid(invalid: str | None) -> None:
    with pytest.raises(ValueError):
        parse_int(invalid)  # type: ignore[arg-type]
```

---

## Mocking

Use `unittest.mock` or `pytest-mock` for replacing dependencies.

```python
from unittest.mock import AsyncMock, MagicMock, patch

def test_send_email_called(user_service: UserService) -> None:
    mailer = MagicMock()
    service = UserService(store=fake_store, mailer=mailer)

    service.register(email="bob@example.com")

    mailer.send.assert_called_once_with(
        to="bob@example.com",
        subject="Welcome",
    )

# Patching at the import site
def test_fetch_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    call_count = 0

    def flaky_get(url: str) -> Response:
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise NetworkError("timeout")
        return Response(200, b"ok")

    monkeypatch.setattr("myapp.http.client.get", flaky_get)
    result = fetch_with_retry("https://example.com")
    assert result == b"ok"
    assert call_count == 3
```

---

## Async Tests

```python
import pytest
import pytest_asyncio

@pytest.mark.asyncio
async def test_async_fetch() -> None:
    result = await fetch("https://example.com")
    assert len(result) > 0

# Async fixture
@pytest_asyncio.fixture
async def async_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(base_url="http://testserver") as client:
        yield client
```

Configure in `pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

---

## Property-Based Testing (Hypothesis)

Test invariants with generated inputs rather than specific examples.

```python
from hypothesis import given, settings
from hypothesis import strategies as st

@given(st.text(min_size=1, max_size=100))
def test_encode_decode_roundtrip(s: str) -> None:
    assert decode(encode(s)) == s

@given(
    st.lists(st.integers(), min_size=1),
    st.integers(min_value=0),
)
def test_nth_element_in_bounds(lst: list[int], n: int) -> None:
    n = n % len(lst)
    result = get_nth(lst, n)
    assert result == lst[n]
```

---

## Coverage Configuration

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
branch = true

[tool.coverage.report]
fail_under = 80
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
]
```

Run: `pytest --cov=src --cov-report=term-missing --cov-fail-under=80`

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Tests with `print` instead of `assert` | Always passes, no validation | Use proper assertions |
| One massive test function | Hard to debug failures | Split into focused test cases |
| Patching internal implementation | Brittle tests | Mock at dependency injection point |
| `time.sleep` in tests | Slow, flaky | Use `freezegun` or mock timers |
| Non-deterministic test order | Hidden coupling | Use `pytest-randomly` to detect |
