#!/usr/bin/env python3
"""Tests for scripts/check.sh.

check.sh runs every repo check (node syntax, node tests, pytest, the two
generators, the version files, bash tests), reports each as PASS, FAIL or
SKIP, and exits 1 if any step failed. What these tests cover is that
aggregation: every step runs even after an earlier one fails, a failure in
any file or any directory depth is caught, and a step with nothing to run is
skipped, not failed.

Every test copies the real check.sh into a throwaway tree and runs it there,
never against this repo. The tree holds stub generators and a stub
bump-version.sh that always pass: the stubs are not under test, the
aggregation is.

Run: PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider scripts/test_check.py
"""

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "check.sh"

# Stub generators and bump-version.sh pass only when invoked with the exact
# argument check.sh is specified to give them, so a wrong invocation shows up.
GEN_STUB = (
    "import sys\n"
    "sys.exit(0 if sys.argv[1:] == ['--check'] else 2)\n"
)
BUMP_STUB = '#!/usr/bin/env bash\n[ "$*" = "--check" ] || exit 2\nexit 0\n'

HOOK_OK = "'use strict';\nmodule.exports = 1;\n"
HOOK_BROKEN = "const = ;\n"
NODE_TEST_OK = (
    "const test = require('node:test');\n"
    "const assert = require('node:assert');\n"
    "test('ok', () => assert.strictEqual(1, 1));\n"
)
NODE_TEST_BOOM = (
    "const test = require('node:test');\n"
    "test('boom', () => { throw new Error('boom'); });\n"
)
PY_TEST_OK = "def test_ok():\n    assert True\n"
PY_TEST_BAD = "def test_bad():\n    assert False\n"
SH_OK = "#!/usr/bin/env bash\nexit 0\n"
SH_BAD = "#!/usr/bin/env bash\necho 'bash test failed' >&2\nexit 1\n"

STATUS_LINE = re.compile(r"^(PASS|FAIL|SKIP) ")
STEPS = [
    "node-syntax",
    "node-tests",
    "pytest",
    "gen-catalog",
    "gen-bootstrap",
    "version-files",
    "bash-tests",
]


def write(tree, rel, text):
    path = tree / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def make_tree(tree):
    """Build a tree where every step passes, with the real check.sh copied in."""
    (tree / "scripts").mkdir(parents=True)
    shutil.copy(SCRIPT, tree / "scripts" / "check.sh")
    write(tree, "scripts/gen-catalog.py", GEN_STUB)
    write(tree, "scripts/gen-bootstrap.py", GEN_STUB)
    write(tree, "scripts/bump-version.sh", BUMP_STUB)
    write(tree, "hooks/a.js", HOOK_OK)
    write(tree, "hooks/test/ok.test.js", NODE_TEST_OK)
    write(tree, "test_ok.py", PY_TEST_OK)
    write(tree, "skills/x/scripts/test-ok.sh", SH_OK)
    return tree


def run_check(tree):
    """Run the tree's check.sh from an unrelated cwd, so only its own cd finds the tree."""
    elsewhere = tree.parent / "elsewhere"
    elsewhere.mkdir(exist_ok=True)
    return subprocess.run(
        ["bash", str(tree / "scripts" / "check.sh")],
        cwd=elsewhere, capture_output=True, text=True, timeout=180,
    )


def status_lines(res):
    """The PASS/FAIL/SKIP lines, in order. Step output is indented, so it never matches."""
    return [ln for ln in res.stdout.splitlines() if STATUS_LINE.match(ln)]


def status_of(res, step):
    """The one status line for `step`, or None."""
    found = [ln for ln in status_lines(res) if ln.split(":")[0].split(" ", 1)[1] == step]
    assert len(found) <= 1, found
    return found[0] if found else None


@pytest.fixture
def tree():
    root = Path(os.path.realpath(tempfile.mkdtemp(prefix="check-test-")))
    try:
        yield make_tree(root / "repo")
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_all_green_exits_zero(tree):
    # Decoys in directories the finds must prune: if check.sh looked inside
    # node_modules it would fail on these.
    write(tree, "hooks/node_modules/dep/broken.js", HOOK_BROKEN)
    write(tree, "skills/x/node_modules/dep/scripts/test-decoy.sh", SH_BAD)

    res = run_check(tree)

    assert res.returncode == 0, res.stdout + res.stderr
    assert status_lines(res) == [f"PASS {step}" for step in STEPS], res.stdout
    assert res.stdout.splitlines()[-1] == "ALL CHECKS PASSED"


def test_syntax_error_in_second_hook_fails(tree):
    # a.js is valid and sorts first: a single `node --check a.js b.js` would
    # check only a.js and pass. b.js sits one level down, like the real
    # hooks/lib/session.js, so a search limited to hooks/*.js would miss it.
    write(tree, "hooks/lib/b.js", HOOK_BROKEN)

    res = run_check(tree)

    assert res.returncode == 1, res.stdout + res.stderr
    line = status_of(res, "node-syntax")
    assert line is not None and line.startswith("FAIL node-syntax"), res.stdout
    assert "b.js" in line, line
    # The later steps still ran.
    assert status_of(res, "gen-catalog") == "PASS gen-catalog", res.stdout
    assert res.stdout.splitlines()[-1] == "CHECKS FAILED: 1"


def test_failing_node_test_fails_but_later_steps_run(tree):
    write(tree, "hooks/test/boom.test.js", NODE_TEST_BOOM)

    res = run_check(tree)

    assert res.returncode == 1, res.stdout + res.stderr
    line = status_of(res, "node-tests")
    assert line is not None and line.startswith("FAIL node-tests"), res.stdout
    assert status_of(res, "node-syntax") == "PASS node-syntax", res.stdout
    assert status_of(res, "gen-catalog") == "PASS gen-catalog", res.stdout
    assert status_of(res, "bash-tests") == "PASS bash-tests", res.stdout
    assert res.stdout.splitlines()[-1] == "CHECKS FAILED: 1"


def test_failing_pytest_and_nested_bash_test_are_reported(tree):
    write(tree, "test_bad.py", PY_TEST_BAD)
    nested = "skills/x/references/y/scripts/test-bad.sh"
    write(tree, nested, SH_BAD)

    res = run_check(tree)

    assert res.returncode == 1, res.stdout + res.stderr
    line = status_of(res, "pytest")
    assert line is not None and line.startswith("FAIL pytest"), res.stdout
    line = status_of(res, "bash-tests")
    assert line is not None and line.startswith("FAIL bash-tests"), res.stdout
    assert nested in line, line
    assert res.stdout.splitlines()[-1] == "CHECKS FAILED: 2"


def test_missing_tests_skip_not_fail(tree):
    # Remove the files but leave their directories: an unexpanded glob such as
    # hooks/test/*.test.js must not be handed to node as a literal name.
    (tree / "hooks/test/ok.test.js").unlink()
    (tree / "test_ok.py").unlink()
    (tree / "skills/x/scripts/test-ok.sh").unlink()

    res = run_check(tree)

    assert res.returncode == 0, res.stdout + res.stderr
    assert status_of(res, "node-tests") == "SKIP node-tests: no files", res.stdout
    line = status_of(res, "pytest")
    assert line is not None and line.startswith("SKIP pytest"), res.stdout
    assert status_of(res, "bash-tests") == "SKIP bash-tests: no files", res.stdout
    assert not [ln for ln in status_lines(res) if ln.startswith("FAIL")], res.stdout
    assert res.stdout.splitlines()[-1] == "ALL CHECKS PASSED"
