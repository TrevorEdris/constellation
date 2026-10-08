#!/usr/bin/env python3
"""Tests for scripts/bump-version.sh.

The script bumps the plugin version in .claude-plugin/plugin.json and
.claude-plugin/marketplace.json, dates a CHANGELOG.md entry, and checks the
three files agree. Every test builds a throwaway git repo with
make_repo() and runs the real script against it. The live version of this
repo is never read, because the stack's bumps keep changing it.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider scripts/test_bump_version.py
"""

import json
import os
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "bump-version.sh"
REPO_ROOT = SCRIPT.parent.parent

PLUGIN = ".claude-plugin/plugin.json"
MARKET = ".claude-plugin/marketplace.json"
CHANGELOG = "CHANGELOG.md"
VERSIONED_FILES = (PLUGIN, MARKET, CHANGELOG)

# Contract C7: identity and signing are pinned on every git call.
GIT_CONFIG = [
    "-c", "user.name=test",
    "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false",
    "-c", "init.defaultBranch=main",
]

PLUGIN_JSON = """{
  "name": "constellation",
  "description": "Curated skills that work together for a complete dev workflow",
  "version": "@V@",
  "author": {
    "name": "Test Author",
    "email": "test@example.com"
  },
  "license": "MIT",
  "keywords": ["skills", "tdd", "planning"]
}
"""

MARKETPLACE_JSON = """{
  "name": "constellation",
  "description": "Marketplace for the constellation plugin",
  "owner": {
    "name": "Test Author",
    "email": "test@example.com"
  },
  "plugins": [
    {
      "name": "constellation",
      "description": "Curated skills that work together for a complete dev workflow",
      "version": "@V@",
      "source": "./",
      "author": {
        "name": "Test Author",
        "email": "test@example.com"
      }
    }
  ]
}
"""

CHANGELOG_MD = """# Changelog

## @V@ (unreleased)

Initial release.

- first seeded entry
- second seeded entry
"""


def _env():
    """Child env without the git variables that would redirect it to another repo."""
    drop = ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE")
    return {k: v for k, v in os.environ.items() if k not in drop}


def git(repo, *args):
    return subprocess.run(
        ["git", *GIT_CONFIG, *args],
        cwd=repo, env=_env(), check=True, capture_output=True, text=True,
    )


def _write_files(repo, version):
    (repo / ".claude-plugin").mkdir(exist_ok=True)
    (repo / PLUGIN).write_text(PLUGIN_JSON.replace("@V@", version), encoding="utf-8")
    (repo / MARKET).write_text(MARKETPLACE_JSON.replace("@V@", version), encoding="utf-8")
    (repo / CHANGELOG).write_text(CHANGELOG_MD.replace("@V@", version), encoding="utf-8")


def _commit_files(repo, version, message):
    _write_files(repo, version)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--allow-empty", "-m", message)


def make_repo(path, version, refs=None):
    """Create a git repo at path whose tree carries `version`.

    refs maps a ref name to the plugin version committed at that ref:
    "origin/main" becomes refs/remotes/origin/main, anything else becomes a
    local branch. Refs are set with `git update-ref`, so no remote exists and
    nothing can be fetched.
    """
    path.mkdir(parents=True, exist_ok=True)
    git(path, "init", "-q")
    for ref, ref_version in (refs or {}).items():
        _commit_files(path, ref_version, f"tree at {ref_version} for {ref}")
        full = f"refs/remotes/{ref}" if ref.startswith("origin/") else f"refs/heads/{ref}"
        git(path, "update-ref", full, "HEAD")
    _commit_files(path, version, f"tree at {version}")
    return path


def run_bump(repo, *args):
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=repo, env=_env(), capture_output=True, text=True,
    )


def snapshot(repo):
    return {name: (repo / name).read_bytes() for name in VERSIONED_FILES}


def plugin_version(repo):
    return json.loads((repo / PLUGIN).read_text(encoding="utf-8"))["version"]


def market_version(repo):
    data = json.loads((repo / MARKET).read_text(encoding="utf-8"))
    return next(p for p in data["plugins"] if p["name"] == "constellation")["version"]


@pytest.fixture
def tmp():
    d = Path(os.path.realpath(tempfile.mkdtemp(prefix="bump-version-test-")))
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_explicit_bump_updates_manifests_and_dates_changelog(tmp):
    repo = make_repo(tmp / "repo", "0.1.0", {"origin/main": "0.1.0"})
    before = snapshot(repo)

    day_before = date.today()
    res = run_bump(repo, "0.2.0", "--note", "n", "--note", "m")
    day_after = date.today()
    assert res.returncode == 0, res.stderr
    after = snapshot(repo)

    # The JSON files change by exactly one textual line: no re-dump.
    for name in (PLUGIN, MARKET):
        old = before[name].decode("utf-8")
        new = after[name].decode("utf-8")
        assert old.count('"version": "0.1.0"') == 1
        assert new == old.replace('"version": "0.1.0"', '"version": "0.2.0"'), name
        changed = [1 for o, n in zip(old.splitlines(), new.splitlines()) if o != n]
        assert len(changed) == 1, name
    assert plugin_version(repo) == "0.2.0"
    assert market_version(repo) == "0.2.0"

    # CHANGELOG: the new dated heading and notes sit above the old heading,
    # which loses "(unreleased)". Accept either side of a midnight rollover.
    new_log = after[CHANGELOG].decode("utf-8")
    expected = [
        "# Changelog\n\n## 0.2.0 ({day})\n\n- n\n- m\n\n## 0.1.0\n\n"
        "Initial release.\n\n- first seeded entry\n- second seeded entry\n".replace("{day}", d.isoformat())
        for d in {day_before, day_after}
    ]
    assert new_log in expected, new_log
    assert "(unreleased)" not in new_log

    # The not-above guard compares numbers, not text: "0.10.0" sorts below
    # "0.9.0" as a string, yet 0.10.0 is the valid next minor after 0.9.0.
    repo = make_repo(tmp / "ten", "0.9.0", {"origin/main": "0.9.0"})
    res = run_bump(repo, "0.10.0", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.10.0"
    assert market_version(repo) == "0.10.0"


def test_next_from_origin_main(tmp):
    repo = make_repo(tmp / "repo", "0.1.0", {"origin/main": "0.1.0"})
    res = run_bump(repo, "--next", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.2.0"
    assert market_version(repo) == "0.2.0"

    # Crossing 0.9 to 0.10: the computed 0.10.0 must pass the same numeric
    # not-above guard, which a string comparison would wrongly refuse.
    repo = make_repo(tmp / "ten", "0.9.0", {"origin/main": "0.9.0"})
    res = run_bump(repo, "--next", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.10.0"
    assert market_version(repo) == "0.10.0"


def test_next_uses_max_of_origin_main_and_base(tmp):
    # origin/main is behind `lower`: the base wins.
    repo = make_repo(tmp / "a", "0.3.0", {"origin/main": "0.1.0", "lower": "0.3.0"})
    res = run_bump(repo, "--next", "--base", "lower", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.4.0"
    assert market_version(repo) == "0.4.0"

    # origin/main is ahead of `lower`: origin/main wins.
    repo = make_repo(tmp / "b", "0.1.0", {"origin/main": "0.2.0", "lower": "0.1.0"})
    res = run_bump(repo, "--next", "--base", "lower", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.3.0"
    assert market_version(repo) == "0.3.0"

    # Versions compare as numbers, not text: 0.10.0 is above 0.9.0.
    repo = make_repo(tmp / "c", "0.10.0", {"origin/main": "0.9.0", "lower": "0.10.0"})
    res = run_bump(repo, "--next", "--base", "lower", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.11.0"
    assert market_version(repo) == "0.11.0"


def test_next_never_reuses_advanced_origin_main(tmp):
    repo = make_repo(tmp / "repo", "0.2.0", {"origin/main": "0.5.0"})
    res = run_bump(repo, "--next", "--note", "n")
    assert res.returncode == 0, res.stderr
    assert plugin_version(repo) == "0.6.0"
    assert market_version(repo) == "0.6.0"


def test_refuses_non_increasing_and_missing_note(tmp):
    repo = make_repo(tmp / "repo", "0.3.0", {"origin/main": "0.1.0"})
    pristine = snapshot(repo)

    def refused(rc, why, *args):
        """The script exits rc for `why` and leaves every version file untouched."""
        before = snapshot(repo)
        res = run_bump(repo, *args)
        assert res.returncode == rc, (args, res.stdout, res.stderr)
        assert why in res.stderr, (why, res.stderr)
        assert snapshot(repo) == before, args

    # Not above the tree's version; --next lands on 0.2.0 (origin/main + 1),
    # below the tree, and suggests --base.
    refused(1, "not above", "0.2.0", "--note", "n")
    refused(1, "not above", "0.3.0", "--note", "n")
    refused(1, "--base <parent branch>", "--next", "--note", "n")

    # The note is required.
    refused(2, "--note is required", "0.4.0")
    refused(2, "--note needs non-empty text", "0.4.0", "--note", "")
    refused(2, "--note is required", "--next")

    # The new heading already exists.
    log = repo / CHANGELOG
    log.write_text(pristine[CHANGELOG].decode("utf-8").replace(
        "## 0.3.0 (unreleased)", "## 0.4.0 (2020-01-01)\n\n- x\n\n## 0.3.0 (unreleased)"), encoding="utf-8")
    refused(1, "already has", "0.4.0", "--note", "n")

    # Nothing to add the new entry above.
    log.write_text("# Changelog\n\nNo entries yet.\n", encoding="utf-8")
    refused(1, "no '## ' heading", "0.4.0", "--note", "n")
    log.write_bytes(pristine[CHANGELOG])

    # More than one "version" key in either manifest.
    plugin = repo / PLUGIN
    plugin.write_text(pristine[PLUGIN].decode("utf-8").replace(
        '"license": "MIT",', '"license": "MIT",\n  "engines": {"version": "1"},'), encoding="utf-8")
    refused(1, '2 "version" keys', "0.4.0", "--note", "n")
    plugin.write_bytes(pristine[PLUGIN])

    market = repo / MARKET
    market.write_text(pristine[MARKET].decode("utf-8").replace(
        '"source": "./",', '"source": "./",\n      "engines": {"version": "1"},'), encoding="utf-8")
    refused(1, '2 "version" keys', "0.4.0", "--note", "n")
    market.write_bytes(pristine[MARKET])

    # With every file restored the same bump is accepted: the refusals above
    # were for the stated reasons, not for some unrelated breakage.
    assert run_bump(repo, "0.4.0", "--note", "n").returncode == 0
    assert plugin_version(repo) == "0.4.0"


def test_check_detects_drift(tmp):
    repo = make_repo(tmp / "repo", "0.1.0", {"origin/main": "0.1.0"})

    # Clean tree.
    res = run_bump(repo, "--check")
    assert res.returncode == 0, res.stderr
    clean = snapshot(repo)

    # plugin.json and marketplace.json disagree: both versions and both files are named.
    market = repo / MARKET
    market.write_text(clean[MARKET].decode("utf-8").replace('"version": "0.1.0"', '"version": "0.2.0"'), encoding="utf-8")
    res = run_bump(repo, "--check")
    assert res.returncode == 1
    out = res.stdout + res.stderr
    for needle in ("0.1.0", "0.2.0", "plugin.json", "marketplace.json"):
        assert needle in out, (needle, out)
    market.write_bytes(clean[MARKET])

    log = repo / CHANGELOG
    # No heading for the version (and 0.1.01 must not satisfy 0.1.0).
    log.write_text("# Changelog\n\n## 0.1.01\n\n- x\n", encoding="utf-8")
    assert run_bump(repo, "--check").returncode == 1

    # The heading has no "- " line before the next heading.
    log.write_text("# Changelog\n\n## 0.1.0\n\nProse only.\n\n## 0.0.9\n\n- older\n", encoding="utf-8")
    assert run_bump(repo, "--check").returncode == 1

    # A bare heading with a bullet passes.
    log.write_text("# Changelog\n\n## 0.1.0\n\n- x\n", encoding="utf-8")
    res = run_bump(repo, "--check")
    assert res.returncode == 0, res.stderr


def test_runs_against_cwd_repo_not_script_repo(tmp):
    # Snapshot this repo's version files; restore them if the script wrongly touched them.
    real = {name: (REPO_ROOT / name).read_bytes() for name in VERSIONED_FILES}
    repo = make_repo(tmp / "repo", "0.1.0", {"origin/main": "0.1.0"})
    try:
        res = run_bump(repo, "0.2.0", "--note", "n")
        touched = [n for n in VERSIONED_FILES if (REPO_ROOT / n).read_bytes() != real[n]]
    finally:
        for name, data in real.items():
            if (REPO_ROOT / name).read_bytes() != data:
                (REPO_ROOT / name).write_bytes(data)

    assert res.returncode == 0, res.stderr
    assert touched == [], f"script modified its own repo: {touched}"
    assert plugin_version(repo) == "0.2.0"
