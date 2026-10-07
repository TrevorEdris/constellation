"""Tests for validate_plan.py: PR-size and Brief checks, frontmatter parsing,
schema dispatch (v3 vs legacy) and issue audience tags.

Run from the repo root:
    PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider skills/plan-validator/scripts
"""

import inspect
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

import validate_plan as vp

SCRIPT = Path(vp.__file__).resolve()


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


# ---------------------------------------------------------------------------
# Frontmatter parsing, schema dispatch, audience tags
# ---------------------------------------------------------------------------

FM_STACK = """---
schema: plan/v3
date: 2026-10-07
slug: demo
status: draft
delivery:
  - repo: /work/a
    mode: stack
    branch: feat/a
    base: main
    remote: origin
    prs: 2
  - repo: /work/b
    mode: local-only
    branch: n/a
    base: main
    remote: none
tags: [x, y]
---
"""

V3_FM = """---
schema: plan/v3
date: 2026-10-07
slug: demo
status: {status}
delivery:
  - repo: /work/a
    mode: pr
    branch: feat/a
    base: main
    remote: origin
tags: []
---
"""

LEGACY_FM = """---
schema: plan/v2
date: 2026-10-07
slug: demo
status: {status}
plan_validator_score: null
---
"""

PLAN_BODY = "\n# PLAN — demo\n\n## Ordered steps\n1. Edit `a.py` and run the tests.\n"


def _validate(tmp_path: Path, text: str) -> "vp.ValidationReport":
    path = tmp_path / "PLAN.md"
    path.write_text(text, encoding="utf-8")
    return vp.validate_plan(path)


def _categories(report: "vp.ValidationReport") -> list[str]:
    return [i.category for i in report.issues]


def test_frontmatter_block_list_parses_delivery():
    text = FM_STACK + PLAN_BODY
    data, end_line, problems = vp.parse_frontmatter(text)
    assert problems == []
    assert data["schema"] == "plan/v3"
    assert data["status"] == "draft"
    assert data["delivery"] == [
        {"repo": "/work/a", "mode": "stack", "branch": "feat/a", "base": "main", "remote": "origin", "prs": "2"},
        {"repo": "/work/b", "mode": "local-only", "branch": "n/a", "base": "main", "remote": "none"},
    ]
    assert data["tags"] == ["x", "y"]
    # end_line is the 1-indexed closing fence, so lines[end_line:] is the body
    lines = text.splitlines()
    assert lines[end_line - 1] == "---"
    assert lines[end_line:][1] == "# PLAN — demo"


def test_frontmatter_block_scalar_list_and_dash_at_key_indent():
    text = "---\nschema: plan/v3\ntags:\n- one\n- two words\nslug: s\n---\n"
    data, _, problems = vp.parse_frontmatter(text)
    assert problems == []
    assert data["tags"] == ["one", "two words"]
    assert data["slug"] == "s"


def test_frontmatter_inline_list_and_null():
    text = (
        "---\n"
        "tags: [a, \"b c\", 'd']\n"
        "empty_list: []\n"
        "explicit: null\n"
        "tilde: ~\n"
        "bare:\n"
        "slug: s\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert problems == []
    assert data["tags"] == ["a", "b c", "d"]
    assert data["empty_list"] == []
    assert data["explicit"] is None
    assert data["tilde"] is None
    assert data["bare"] is None
    assert data["slug"] == "s"


def test_frontmatter_strips_inline_comment():
    text = (
        "---\n"
        "status: draft # x\n"
        "hash_inside: c#-port\n"
        "quoted: \"keep # this\"\n"
        "flow: [a, b] # note\n"
        "delivery:\n"
        "  - repo: /work/a\n"
        "    branch: feat/a # note\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert data["status"] == "draft"
    assert data["hash_inside"] == "c#-port"
    assert data["quoted"] == "keep # this"
    assert data["flow"] == ["a", "b"]
    assert data["delivery"] == [{"repo": "/work/a", "branch": "feat/a"}]
    assert [(p.code, p.line) for p in problems] == [
        ("inline-comment", 2),
        ("inline-comment", 5),
        ("inline-comment", 8),
    ]


def test_frontmatter_absent_or_unterminated():
    assert vp.parse_frontmatter("# PLAN — x\n\n## Brief\n") == ({}, 0, [])
    assert vp.parse_frontmatter("") == ({}, 0, [])
    data, end_line, problems = vp.parse_frontmatter("---\nschema: plan/v3\n# PLAN — x\n")
    assert (data, end_line) == ({}, 0)
    assert [p.code for p in problems] == ["unterminated"]


def test_frontmatter_unparseable_line_is_a_problem():
    text = "---\nschema: plan/v3\nthis is not a key\nstatus: draft\n---\n"
    data, _, problems = vp.parse_frontmatter(text)
    assert data == {"schema": "plan/v3", "status": "draft"}
    assert [(p.code, p.line) for p in problems] == [("syntax", 3)]


def test_v3_inline_comment_is_error(tmp_path):
    commented = _validate(tmp_path, V3_FM.format(status="draft # x") + PLAN_BODY)
    clean = _validate(tmp_path, V3_FM.format(status="draft") + PLAN_BODY)
    errs = [i for i in commented.errors if i.category == "schema"]
    assert len(errs) == 1
    assert errs[0].line == 5 and "status" in errs[0].message
    assert not commented.passed
    assert "schema" not in _categories(clean)
    # v3 errors block through severity alone: the score is untouched
    assert commented.score == clean.score


def test_legacy_inline_comment_tolerated(tmp_path):
    commented = _validate(tmp_path, LEGACY_FM.format(status="draft # x") + PLAN_BODY)
    clean = _validate(tmp_path, LEGACY_FM.format(status="draft") + PLAN_BODY)
    assert [i.severity for i in commented.issues if i.category in ("schema", "legacy")] == ["warning"]
    assert "schema" not in _categories(commented)
    assert commented.score == clean.score
    assert commented.passed == clean.passed


def test_v3_unparseable_frontmatter_is_error(tmp_path):
    text = V3_FM.format(status="draft").replace("tags: []", "tags: []\nnot a key") + PLAN_BODY
    report = _validate(tmp_path, text)
    errs = [i for i in report.errors if i.category == "schema"]
    assert [i.line for i in errs] == [13]


@pytest.mark.parametrize("token", ["draft", "awaiting-approval", "approved", "in-progress", "complete"])
def test_check_schema_v3_accepts_each_status_token(token):
    report = vp.ValidationReport(path="p")
    vp.check_schema(vp.parse_frontmatter(V3_FM.format(status=token)), report)
    assert report.issues == []
    assert report.score == 100


@pytest.mark.parametrize("status", ["planning", "Draft", "in progress", "done"])
def test_check_schema_v3_rejects_unknown_status(status):
    report = vp.ValidationReport(path="p")
    vp.check_schema(vp.parse_frontmatter(V3_FM.format(status=status)), report)
    assert [(i.severity, i.category) for i in report.issues] == [("error", "schema")]
    assert status in report.issues[0].message
    assert report.score == 100


def test_check_schema_v3_rejects_missing_status():
    text = V3_FM.format(status="draft").replace("status: draft\n", "")
    report = vp.ValidationReport(path="p")
    vp.check_schema(vp.parse_frontmatter(text), report)
    assert [(i.severity, i.category) for i in report.issues] == [("error", "schema")]


@pytest.mark.parametrize(
    "frontmatter",
    [
        LEGACY_FM.format(status="draft"),
        LEGACY_FM.format(status="whatever-legacy-says"),
        "---\nschema: plan/v3.1\nstatus: draft\n---\n",
        "---\nschema: plan/v3-draft\nstatus: draft\n---\n",
        "---\nschema: PLAN/V3\nstatus: draft\n---\n",
        "---\nslug: no-schema\n---\n",
        "",
    ],
    ids=["v2", "v2-odd-status", "v3.1", "v3-suffix", "v3-case", "no-schema", "no-frontmatter"],
)
def test_check_schema_legacy_one_warning_no_deduction(frontmatter):
    report = vp.ValidationReport(path="p")
    vp.check_schema(vp.parse_frontmatter(frontmatter + PLAN_BODY), report)
    assert _categories(report) == ["legacy"]
    assert report.issues[0].severity == "warning"
    assert report.score == 100
    assert report.passed


def test_check_schema_is_wired_into_validate_plan(tmp_path):
    legacy = _validate(tmp_path, LEGACY_FM.format(status="draft") + PLAN_BODY)
    v3 = _validate(tmp_path, V3_FM.format(status="draft") + PLAN_BODY)
    assert _categories(legacy).count("legacy") == 1
    assert "legacy" not in _categories(v3)


def test_validate_plan_probe_flag_defaults_on(tmp_path):
    assert inspect.signature(vp.validate_plan).parameters["probe"].default is True
    path = tmp_path / "PLAN.md"
    path.write_text(LEGACY_FM.format(status="draft") + PLAN_BODY, encoding="utf-8")
    off = vp.validate_plan(path, probe=False)
    on = vp.validate_plan(path)
    assert [(i.category, i.message) for i in off.issues] == [(i.category, i.message) for i in on.issues]


def test_issue_audience_from_category():
    assert vp.HUMAN_CATEGORIES == {"git", "brief", "card", "delivery"}
    for cat in vp.HUMAN_CATEGORIES:
        assert vp.Issue("warning", cat, "m").audience == "human"
    for cat in ("vagueness", "structure", "specificity", "code-size", "legacy", "schema", "scope"):
        assert vp.Issue("warning", cat, "m").audience == "agent"


def _run_cli(path: Path, *flags: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(path), *flags],
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"},
    )


def test_json_audience_tags(tmp_path):
    plan = tmp_path / "PLAN.md"
    plan.write_text("# PLAN — x\n\n## Ordered steps\n1. probably do a thing\n", encoding="utf-8")
    proc = _run_cli(plan, "--json")
    issues = json.loads(proc.stdout)["issues"]
    audience_by_category = {i["category"]: i["audience"] for i in issues}
    assert audience_by_category["git"] == "human"
    assert audience_by_category["brief"] == "human"
    assert audience_by_category["vagueness"] == "agent"
    assert audience_by_category["structure"] == "agent"
    assert all(set(i) >= {"severity", "category", "audience", "message", "line"} for i in issues)


def test_text_output_shows_audience(tmp_path):
    plan = tmp_path / "PLAN.md"
    plan.write_text("# PLAN — x\n\n## Ordered steps\n1. probably do a thing\n", encoding="utf-8")
    out = _run_cli(plan).stdout
    assert "[WARN]  [git] (human) No branch name found" in out
    assert '[WARN]  [vagueness] (agent) [line 4] Vague language: "probably"' in out
    assert "[ERROR] [specificity] (agent) Only" in out


def test_oversized_code_block_is_agent():
    lines = ["```"] + ["x = 1"] * 16 + ["```"]
    report = vp.ValidationReport(path="p")
    vp.check_oversized_code_blocks(lines, report)
    assert [(i.severity, i.category, i.audience) for i in report.issues] == [("warning", "code-size", "agent")]
    assert report.score == 97
