#!/usr/bin/env python3
"""Tests for validate_plan.py — focused on check_pr_size_estimate.

Run: python3 test_validate_plan.py
Exit 0 on all-pass, 1 on any failure. No external deps.
"""

import tempfile
from pathlib import Path

import validate_plan as vp


def _messages(plan_text: str) -> list[str]:
    """Validate plan_text from a temp file and return all issue messages."""
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as fh:
        fh.write(plan_text)
        path = Path(fh.name)
    try:
        report = vp.validate_plan(path)
        return [i.message for i in report.issues]
    finally:
        path.unlink(missing_ok=True)


def _has_size_missing(msgs: list[str]) -> bool:
    return any("Estimated PR size" in m and "No" in m for m in msgs)


def _has_large_warning(msgs: list[str]) -> bool:
    return any("exceeds 1000" in m for m in msgs)


SECTION_SMALL = """## Estimated PR size
Per-area breakdown.

| Area | Added | Removed |
|---|---|---|
| core | 100 | 20 |

**Estimated PR size: 156 lines.**
"""

SECTION_LARGE_NO_SPLIT = """## Estimated PR size
Per-area breakdown.

**Estimated PR size: 1500 lines.**
"""

SECTION_LARGE_WITH_SPLIT = """## Estimated PR size
Per-area breakdown.

**Estimated PR size: 1500 lines.**

> ⚠️ Large PR warning: 1500 exceeds the 1,000-line threshold.

Proposed split: two independent PRs by subsystem.
"""


def test_missing_section_warns():
    msgs = _messages("# PLAN — x\n\n## Ordered steps\n1. do a thing\n")
    assert _has_size_missing(msgs), "expected missing-size warning"


def test_small_estimate_no_size_warning():
    msgs = _messages("# PLAN — x\n\n" + SECTION_SMALL)
    assert not _has_size_missing(msgs), "small plan should not warn missing"
    assert not _has_large_warning(msgs), "156 lines must not trip the large warning"


def test_large_estimate_without_split_warns():
    msgs = _messages("# PLAN — x\n\n" + SECTION_LARGE_NO_SPLIT)
    assert _has_large_warning(msgs), "1500 lines w/o split must warn"


def test_large_estimate_with_split_ok():
    msgs = _messages("# PLAN — x\n\n" + SECTION_LARGE_WITH_SPLIT)
    assert not _has_large_warning(msgs), "1500 lines w/ split analysis must not warn"


def main() -> int:
    tests = [
        test_missing_section_warns,
        test_small_estimate_no_size_warning,
        test_large_estimate_without_split_warns,
        test_large_estimate_with_split_ok,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {t.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
