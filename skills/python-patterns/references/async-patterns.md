# Python Async Patterns

asyncio, TaskGroup, async context managers, and structured concurrency for Python 3.11+.

---

## Basics

```python
import asyncio

async def fetch(url: str) -> bytes:
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content

async def main() -> None:
    data = await fetch("https://example.com")
    print(len(data))

asyncio.run(main())
```

Key rules:
- `async def` functions are coroutines — call with `await` or schedule as tasks
- Only one coroutine runs at a time; `await` yields control back to the event loop
- Blocking I/O (`open`, `requests`, `time.sleep`) blocks the entire event loop — use async alternatives

---

## TaskGroup (Python 3.11+)

`asyncio.TaskGroup` is the structured concurrency primitive. It cancels all sibling tasks if one raises.

```python
async def process_items(items: list[Item]) -> list[Result]:
    results: list[Result] = []

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(process_one(item)) for item in items]

    # All tasks have completed (or TaskGroup raised ExceptionGroup)
    return [t.result() for t in tasks]
```

**Do not** use `asyncio.gather` with `return_exceptions=False` as a replacement for structured concurrency — it leaks tasks on cancellation.

---

## Bounded Concurrency

Limit concurrent tasks with a semaphore to avoid overwhelming downstream services.

```python
async def fetch_all(urls: list[str], *, concurrency: int = 10) -> list[bytes]:
    sem = asyncio.Semaphore(concurrency)

    async def fetch_one(url: str) -> bytes:
        async with sem:
            return await fetch(url)

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch_one(url)) for url in urls]

    return [t.result() for t in tasks]
```

---

## Async Context Managers

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator

@asynccontextmanager
async def managed_connection(dsn: str) -> AsyncIterator[Connection]:
    conn = await connect(dsn)
    try:
        yield conn
    finally:
        await conn.close()

async def main() -> None:
    async with managed_connection(DSN) as conn:
        result = await conn.fetch("SELECT 1")
```

---

## Async Generators

```python
async def read_lines(path: str) -> AsyncIterator[str]:
    async with aiofiles.open(path) as f:
        async for line in f:
            yield line.rstrip()

async def process_file(path: str) -> None:
    async for line in read_lines(path):
        await handle_line(line)
```

---

## Timeouts

```python
import asyncio

# Per-operation timeout
async def fetch_with_timeout(url: str) -> bytes:
    async with asyncio.timeout(5.0):  # Python 3.11+
        return await fetch(url)

# Adjust timeout dynamically
async def fetch_adaptive(url: str, deadline: float) -> bytes:
    remaining = deadline - asyncio.get_event_loop().time()
    async with asyncio.timeout(max(remaining, 0)):
        return await fetch(url)
```

---

## Running Blocking Code

Never call blocking functions directly in async code — offload to a thread pool.

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

_executor = ThreadPoolExecutor(max_workers=4)

async def read_file(path: str) -> bytes:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, Path(path).read_bytes)
```

For CPU-bound work, use `ProcessPoolExecutor` or `run_in_executor` with separate processes.

---

## Async Queue Pattern (Producer/Consumer)

```python
async def producer(queue: asyncio.Queue[Item], items: list[Item]) -> None:
    for item in items:
        await queue.put(item)
    await queue.put(None)  # sentinel

async def consumer(queue: asyncio.Queue[Item | None]) -> list[Result]:
    results = []
    while True:
        item = await queue.get()
        if item is None:
            break
        results.append(await process(item))
        queue.task_done()
    return results

async def run_pipeline(items: list[Item]) -> list[Result]:
    queue: asyncio.Queue[Item | None] = asyncio.Queue(maxsize=100)
    async with asyncio.TaskGroup() as tg:
        tg.create_task(producer(queue, items))
        consumer_task = tg.create_task(consumer(queue))
    return consumer_task.result()
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `time.sleep()` in async code | Blocks event loop | Use `await asyncio.sleep()` |
| `requests` in async code | Blocking HTTP | Use `httpx` or `aiohttp` |
| Bare `asyncio.gather(*tasks)` without error handling | Task leaks on exception | Use `TaskGroup` |
| Fire-and-forget tasks without tracking | Silent failures | Always `await` or track via `TaskGroup` |
| Creating event loop manually | API deprecated in 3.10+ | Use `asyncio.run()` |
