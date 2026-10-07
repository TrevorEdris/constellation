"""pytest configuration for the plan-validator scripts.

Puts this directory on sys.path so `import validate_plan` resolves under every
pytest import mode (prepend does it implicitly; importlib does not) and from
any working directory.

Also holds `v3_plan`, the factory that tests use to get a valid `plan/v3` plan
on disk, backed by a real git repo.
"""

import os
import subprocess
import sys
from pathlib import Path

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

FIXTURES = Path(_HERE) / "fixtures"
REMOTE_URL = "https://example.invalid/r.git"

_GIT_IDENTITY = [
    "-c", "user.name=test",
    "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false",
    "-c", "init.defaultBranch=main",
]


def git_env() -> dict:
    """The environment for a child git in a temp repo: nothing from the caller's repo or config leaks in."""
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE")}
    env["GIT_CONFIG_GLOBAL"] = "/dev/null"
    return env


def make_repo(path: Path, remote_url: str = REMOTE_URL) -> Path:
    """Create a git repo at path with an `origin` remote and no network use; returns the realpath."""
    path.mkdir(parents=True, exist_ok=True)
    path = path.resolve()
    for args in (["init", "-q"], ["remote", "add", "origin", remote_url]):
        subprocess.run(["git", *_GIT_IDENTITY, "-C", str(path), *args], check=True, capture_output=True, env=git_env())
    return path


def v3_plan(tmp_path, **replace) -> Path:
    """Write the valid v3 fixture to tmp_path/PLAN.md and return its path.

    A real git repo with an `origin` remote is created at tmp_path/repo and fills
    the fixture's `{repo}` token. Each keyword is one `str.replace(old, new)` on
    the fixture text (pass `**{"old text": "new text"}`), applied before `{repo}`
    is filled. An `old` that is not in the fixture raises, so a stale edit in a
    test fails loudly instead of testing nothing.
    """
    text = (FIXTURES / "v3-valid-PLAN.md").read_text(encoding="utf-8")
    for old, new in replace.items():
        if old not in text:
            raise AssertionError(f"v3_plan: {old!r} is not in the fixture")
        text = text.replace(old, new)
    repo = make_repo(Path(tmp_path) / "repo")
    plan = repo.parent / "PLAN.md"
    plan.write_text(text.replace("{repo}", str(repo)), encoding="utf-8")
    return plan
