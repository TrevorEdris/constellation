"""pytest configuration for the plan-validator scripts.

Puts this directory on sys.path so `import validate_plan` resolves under every
pytest import mode (prepend does it implicitly; importlib does not) and from
any working directory.

Also holds `v3_plan`, the factory that tests use to get a valid `plan/v3` plan
on disk, backed by real git repos.
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import pytest

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

# The second delivery that `second_repo=` appends; its keys can be overridden one by one.
SECOND_DELIVERY = {"mode": "pr", "branch": "feat/second", "base": "main", "remote": "origin", "prs": "1"}


@pytest.fixture(autouse=True)
def _isolated_git_config(monkeypatch):
    """Every git a test runs, the validator's probe included, ignores the machine's git config (C7)."""
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "/dev/null")
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")


def git_env() -> dict:
    """The environment for a child git in a temp repo: nothing from the caller's repo or config leaks in."""
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE")}
    env["GIT_CONFIG_GLOBAL"] = "/dev/null"
    return env


def make_repo(path: Path, remote_url: str = REMOTE_URL, remote: Optional[str] = "origin", subjects=()) -> Path:
    """Create a git repo at path and return the realpath. No network is used.

    remote: the name of the one remote to add; None adds no remote.
    subjects: one empty commit per subject, oldest first. The default makes no commit.
    """
    path.mkdir(parents=True, exist_ok=True)
    path = path.resolve()
    steps = [["init", "-q"]]
    if remote:
        steps.append(["remote", "add", remote, remote_url])
    steps += [["commit", "-q", "--allow-empty", "-m", subject] for subject in subjects]
    for args in steps:
        subprocess.run(["git", *_GIT_IDENTITY, "-C", str(path), *args], check=True, capture_output=True, env=git_env())
    return path


def v3_plan(tmp_path, *, remote: Optional[str] = "origin", subjects=(), second_repo=None, git: bool = True, **replace) -> Path:
    """Write the valid v3 fixture to tmp_path/PLAN.md and return its path.

    The repo at tmp_path/repo fills the fixture's `{repo}` token. By default it
    is a real git repo with an `origin` remote and no commits. Options:

    - remote: the name of the repo's remote; None gives a repo with no remote.
    - subjects: commit subjects to give the repo, oldest first (`feat: x (#12)`).
    - git: False makes tmp_path/repo a plain directory.
    - second_repo: None, True or a dict. Adds a second real git repo at
      tmp_path/repo2 and a second delivery for it (SECOND_DELIVERY, with the
      dict's keys on top). The repo gets a remote named after the delivery's
      `remote`, unless that is `none`.

    Each other keyword is one `str.replace(old, new)` on the fixture text (pass
    `**{"old text": "new text"}`), applied before `{repo}` is filled and before
    the second delivery is added. An `old` that is not in the fixture raises, so
    a stale edit in a test fails loudly instead of testing nothing.
    """
    text = (FIXTURES / "v3-valid-PLAN.md").read_text(encoding="utf-8")
    for old, new in replace.items():
        if old not in text:
            raise AssertionError(f"v3_plan: {old!r} is not in the fixture")
        text = text.replace(old, new)

    root = Path(tmp_path)
    if git:
        repo = make_repo(root / "repo", remote=remote, subjects=subjects)
    else:
        (root / "repo").mkdir(parents=True, exist_ok=True)
        repo = (root / "repo").resolve()

    if second_repo is not None and second_repo is not False:
        fields = {**SECOND_DELIVERY, **({} if second_repo is True else second_repo)}
        repo2 = make_repo(root / "repo2", remote=None if fields["remote"] == "none" else fields["remote"])
        item = f"  - repo: {repo2}\n" + "".join(f"    {key}: {value}\n" for key, value in fields.items())
        text = text.replace("tags: [wishlist, sharing]", item + "tags: [wishlist, sharing]")

    plan = repo.parent / "PLAN.md"
    plan.write_text(text.replace("{repo}", str(repo)), encoding="utf-8")
    return plan
