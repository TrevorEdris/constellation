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


BRIEF_OK = """## Brief
> For the human reviewer. Max 120 words.

**Delivers:** Owners can hide gifts on a list.

**Changes:**
- New toggle on the list page.

**Decisions made for you:**
- Toggle defaults off — matches current behavior.
"""


def _brief_msgs(msgs: list[str]) -> list[str]:
    return [m for m in msgs if "Brief" in m]


def test_missing_brief_warns():
    msgs = _messages("# PLAN — x\n\n## Ordered steps\n1. do a thing\n")
    assert any("No Brief section" in m for m in msgs), "expected missing-Brief warning"


def test_valid_brief_no_brief_warnings():
    msgs = _messages("# PLAN — x\n\n" + BRIEF_OK + "\n## Ordered steps\n1. do a thing\n")
    assert not _brief_msgs(msgs), f"valid Brief must not warn: {_brief_msgs(msgs)}"


def test_brief_not_first_section_warns():
    msgs = _messages("# PLAN — x\n\n## Ordered steps\n1. do a thing\n\n" + BRIEF_OK)
    assert any("first section" in m for m in msgs), "Brief after another section must warn"


def test_brief_over_budget_warns():
    long_brief = BRIEF_OK.replace("Owners can hide gifts on a list.", "word " * 130)
    msgs = _messages("# PLAN — x\n\n" + long_brief)
    assert any("120" in m and "Brief" in m for m in msgs), "130+ word Brief must warn"


def test_brief_missing_label_warns():
    no_decisions = BRIEF_OK.replace("**Decisions made for you:**", "**Other:**")
    msgs = _messages("# PLAN — x\n\n" + no_decisions)
    assert any("Decisions made for you" in m for m in msgs), "missing label must warn"


def test_brief_with_code_or_step_ref_warns():
    coded = BRIEF_OK.replace("New toggle on the list page.", "Edit `toggle.go` in step 2.1.")
    msgs = _messages("# PLAN — x\n\n" + coded)
    assert any("plain language" in m for m in msgs), "code/step refs in Brief must warn"


def main() -> int:
    tests = [
        test_missing_section_warns,
        test_small_estimate_no_size_warning,
        test_large_estimate_without_split_warns,
        test_large_estimate_with_split_ok,
        test_missing_brief_warns,
        test_valid_brief_no_brief_warnings,
        test_brief_not_first_section_warns,
        test_brief_over_budget_warns,
        test_brief_missing_label_warns,
        test_brief_with_code_or_step_ref_warns,
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
