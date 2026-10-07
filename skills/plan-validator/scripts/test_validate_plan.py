"""Tests for validate_plan.py: PR-size and Brief checks, frontmatter parsing,
schema dispatch (v3 vs legacy), issue audience tags, placeholder rejection,
PLAN v2 step parsing, Traceability rows and the v3 approval-card checks.

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
from conftest import v3_plan

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
        # The aligned form PLAN-TEMPLATE.md ships: many spaces before the '#'. Only the
        # trailing-whitespace trim keeps those spaces out of the value.
        "aligned: draft            # draft | approved\n"
        "delivery:\n"
        "  - repo: /work/a\n"
        "    branch: feat/a # note\n"
        "    mode: pr            # pr | stack | local-only\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert data["status"] == "draft"
    assert data["hash_inside"] == "c#-port"
    assert data["quoted"] == "keep # this"
    assert data["flow"] == ["a", "b"]
    assert data["aligned"] == "draft"
    assert data["delivery"] == [{"repo": "/work/a", "branch": "feat/a", "mode": "pr"}]
    assert [(p.code, p.line) for p in problems] == [
        ("inline-comment", 2),
        ("inline-comment", 5),
        ("inline-comment", 6),
        ("inline-comment", 9),
        ("inline-comment", 10),
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


def test_frontmatter_blank_block_list_values_are_none_never_a_sentinel():
    # A blank value after the dash key, a blank continuation key and a bare `-` all read
    # as None. The parser's private "no text" marker is truthy, so if it leaked into data
    # a consumer that tests `if value` would treat an empty `remote:` as set.
    text = (
        "---\n"
        "delivery:\n"
        "  - repo:\n"
        "    mode:\n"
        "  -\n"
        "slug: s\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert problems == []
    assert data["delivery"] == [{"repo": None, "mode": None}, None]
    assert data["slug"] == "s"


def test_frontmatter_comment_only_value_still_opens_block_list():
    text = (
        "---\n"
        "delivery: # one entry per repo\n"
        "  - repo: /work/a\n"
        "    mode: pr\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert data["delivery"] == [{"repo": "/work/a", "mode": "pr"}]
    assert [(p.code, p.line) for p in problems] == [("inline-comment", 2)]


@pytest.mark.parametrize("dash", [" - repo: /work/b", "    - repo: /work/b"])
def test_frontmatter_block_list_dash_at_other_indent_is_one_syntax_problem(dash):
    text = "---\ndelivery:\n  - repo: /work/a\n" + dash + "\nslug: s\n---\n"
    data, _, problems = vp.parse_frontmatter(text)
    assert [(p.code, p.line) for p in problems] == [("syntax", 4)]
    assert data["delivery"] == [{"repo": "/work/a"}]
    assert data["slug"] == "s"


def test_frontmatter_comment_lines_inside_block_list_are_skipped():
    # An indented note, a column-zero note and a blank line between items are not
    # content, and the column-zero note must not end the list early.
    text = (
        "---\n"
        "delivery:\n"
        "  - repo: /work/a\n"
        "    # indented note\n"
        "    mode: pr\n"
        "# note at column zero\n"
        "\n"
        "  - repo: /work/b\n"
        "slug: s\n"
        "---\n"
    )
    data, _, problems = vp.parse_frontmatter(text)
    assert problems == []
    assert data["delivery"] == [{"repo": "/work/a", "mode": "pr"}, {"repo": "/work/b"}]
    assert data["slug"] == "s"


def test_frontmatter_block_list_item_keys_align_with_the_first_key():
    # The first key's column is wherever it sits after the dash, not a fixed offset.
    wide = "---\ndelivery:\n  -   repo: /work/a\n      mode: pr\n---\n"
    data, _, problems = vp.parse_frontmatter(wide)
    assert problems == []
    assert data["delivery"] == [{"repo": "/work/a", "mode": "pr"}]
    # Deeper or shallower than the first key is not a sibling key.
    for key_line in ("      mode: pr", "   mode: pr"):
        text = "---\ndelivery:\n  - repo: /work/a\n" + key_line + "\n---\n"
        data, _, problems = vp.parse_frontmatter(text)
        assert [(p.code, p.line) for p in problems] == [("syntax", 4)], key_line
        assert data["delivery"] == [{"repo": "/work/a"}], key_line
    # A key under a scalar item has no item to join, even when it lines up with the
    # previous dict item's keys (the parser must report it, not crash on a missing item).
    text = "---\ndelivery:\n  - repo: /work/a\n  - plain\n    mode: pr\n---\n"
    data, _, problems = vp.parse_frontmatter(text)
    assert [(p.code, p.line) for p in problems] == [("syntax", 5)]
    assert data["delivery"] == [{"repo": "/work/a"}, "plain"]


@pytest.mark.parametrize(
    "commented_status",
    [
        "draft # x",
        # the aligned form PLAN-TEMPLATE.md ships (12 spaces before the '#')
        "draft            # draft | awaiting-approval | approved | in-progress | complete",
    ],
    ids=["one-space", "aligned-template"],
)
def test_v3_inline_comment_is_error(tmp_path, commented_status):
    commented = _validate(tmp_path, V3_FM.format(status=commented_status) + PLAN_BODY)
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


# ---------------------------------------------------------------------------
# Placeholder rejection, PLAN v2 step parsing, Traceability rows
# ---------------------------------------------------------------------------

V3_HEAD = V3_FM.format(status="draft")
LEGACY_HEAD = LEGACY_FM.format(status="draft")


def _line_of(text: str, needle: str) -> int:
    """1-indexed line number of the first line containing needle."""
    return next(n for n, line in enumerate(text.splitlines(), 1) if needle in line)


def _in_category(report: "vp.ValidationReport", category: str) -> list["vp.Issue"]:
    return [i for i in report.issues if i.category == category]


def _run_check(check, text: str) -> "vp.ValidationReport":
    """Run one check function on text, as validate_plan would."""
    report = vp.ValidationReport(path="p")
    check(text.splitlines(), report)
    return report


PLACEHOLDER_BODY = (
    "\n# PLAN — demo\n\n"
    "## Target repo & files\n"
    "Edit {{DATE}} in `a.py`.\n"
    "Owner: <name>\n"
    "Decide later: TBD\n"
    "Remember to TODO this.\n"
)
PLACEHOLDER_FIXED = (
    PLACEHOLDER_BODY.replace("{{DATE}}", "the date")
    .replace("<name>", "Ann")
    .replace("TBD", "the cache")
    .replace("TODO", "do")
)


def test_v3_placeholders_are_errors(tmp_path):
    text = V3_HEAD + PLACEHOLDER_BODY
    report = _validate(tmp_path, text)
    errs = _in_category(report, "placeholder")
    assert [(i.severity, i.line) for i in errs] == [
        ("error", _line_of(text, "{{DATE}}")),
        ("error", _line_of(text, "<name>")),
        ("error", _line_of(text, "TBD")),
        ("error", _line_of(text, "TODO")),
    ]
    for issue, snippet in zip(errs, ["{{DATE}}", "<name>", "TBD", "TODO"]):
        assert snippet in issue.message
    assert not report.passed
    # v3 errors block through severity alone: the score is untouched
    assert report.score == _validate(tmp_path, V3_HEAD + PLACEHOLDER_FIXED).score


def test_v3_placeholder_cli_prints_error_and_exits_1(tmp_path):
    plan = tmp_path / "PLAN.md"
    plan.write_text(V3_HEAD + PLACEHOLDER_BODY, encoding="utf-8")
    proc = _run_cli(plan)
    assert proc.returncode == 1
    assert f"[ERROR] [placeholder] (agent) [line {_line_of(V3_HEAD + PLACEHOLDER_BODY, 'TBD')}]" in proc.stdout


def test_legacy_placeholders_are_warnings(tmp_path):
    text = LEGACY_HEAD + PLACEHOLDER_BODY
    report = _validate(tmp_path, text)
    found = _in_category(report, "placeholder")
    assert [(i.severity, i.line) for i in found] == [
        ("warning", _line_of(text, "{{DATE}}")),
        ("warning", _line_of(text, "<name>")),
        ("warning", _line_of(text, "TBD")),
        ("warning", _line_of(text, "TODO")),
    ]
    assert not any(i.category == "placeholder" for i in report.errors)
    fixed = _validate(tmp_path, LEGACY_HEAD + PLACEHOLDER_FIXED)
    assert report.score == fixed.score
    assert report.passed == fixed.passed


def test_frontmatter_placeholders_are_scanned():
    text = "---\nschema: plan/v3\ndate: {{DATE}}\nrepo: <path-or-name>\n---\n"
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [3, 4]


def test_placeholder_in_code_ignored():
    text = (
        "# PLAN — demo\n"
        "Run `card.py render <PLAN>` and `{{x}}` then `TBD`.\n"
        "Wrapped: ``a ` <b> ``.\n"
        "\n"
        "```bash\n"
        "card.py render <PLAN> {{DATE}} TBD TODO\n"
        "| | |\n"
        "...\n"
        "> Template: x\n"
        "```\n"
        "\n"
        "~~~\n"
        "<PLAN> TBD\n"
        "~~~\n"
        "````md\n"
        "```\n"  # a shorter fence inside a four-backtick fence does not close it
        "<PLAN>\n"
        "```\n"
        "````\n"
        "Real <PLAN> here.\n"
    )
    report = _run_check(vp.check_placeholders, text)
    # Only the line outside every code region: proves the scan ran at all
    assert [i.line for i in report.issues] == [_line_of(text, "Real <PLAN>")]


def test_placeholder_in_wrapped_code_span_ignored():
    # An inline code span can run across a line break; nothing inside it is a placeholder.
    text = (
        "Use `Promise<Foo>\n"
        "returns <bar> and TBD` here.\n"
        "\n"
        "- Call ``List<Item>\n"
        "  with {{x}}`` first.\n"
        "\n"
        "| Col | Notes |\n"
        "|---|---|\n"
        "| a | `<id>` |\n"
    )
    assert _run_check(vp.check_placeholders, text).issues == []


def test_placeholder_after_wrapped_code_span_still_flagged():
    text = (
        "Use `Promise<Foo>\n"  # 1: opens a span
        "returns` and <real> slot\n"  # 2: span closes, then a real placeholder
        "TBD on this line\n"  # 3: same paragraph, outside the span
        "\n"
        "Next paragraph has `Promise<Bar>\n"  # 5: unclosed in its paragraph, so no span at all
        "\n"
        "closing` after a blank line\n"  # 7
    )
    report = _run_check(vp.check_placeholders, text)
    assert [(i.line, i.message) for i in report.issues] == [
        (2, "Unfilled placeholder (<real>). Fill it in or delete it."),
        (3, "Unfilled placeholder (TBD). Fill it in or delete it."),
        (5, "Unfilled placeholder (<Bar>). Fill it in or delete it."),
    ]


def test_wrapped_code_span_does_not_cross_a_fence():
    text = (
        "Open `span <c>\n"  # 1: flagged, its span is never closed in this paragraph
        "```\n"
        "close` here\n"
        "```\n"
        "Plain <b> text\n"  # 5
    )
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [1, 5]


def test_html_autolink_email_not_placeholder():
    text = (
        "See <https://example.com/a?b=1> and <mailto:ops@example.com> and <ops@example.com>.\n"
        "Use <details><summary>x</summary></details> and a<br>b, <kbd>Ctrl</kbd>, <sub>1</sub>.\n"
        "<!-- a comment -->\n"
        '<a href="https://x.y">x</a> <img src="a.png">\n'
        "Real <PLAN> here.\n"
        "Also <name: value> here.\n"
    )
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [_line_of(text, "Real <PLAN>"), _line_of(text, "Also <name")]


def test_empty_table_row_flagged():
    text = (
        "| Area | Added | Removed |\n"
        "|---|---|---|\n"
        "| core | 100 | 20 |\n"
        "| | | |\n"
        "| **Total** | | |\n"
        "| **Total** | 120 | 20 |\n"
        "|  |  |  |\n"
        "| `a.py` | | |\n"
    )
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [4, 5, 7]
    assert all("empty table row" in i.message.lower() for i in report.issues)


def test_table_separator_not_flagged():
    text = (
        "| A | B |\n"
        "|---|---|\n"
        "| --- | :---: |\n"
        "|:--|--:|\n"
        "| a | b |\n"
    )
    assert _run_check(vp.check_placeholders, text).issues == []


def test_template_guidance_line_flagged():
    text = (
        "> Template: replace this block with the real text.\n"
        "  > Template: indented too.\n"
        "> Templates are fine to mention.\n"
        "> A quote about a Template: not at the start.\n"
    )
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [1, 2]


def test_ellipsis_line_flagged():
    text = (
        "...\n"
        "**Critical path:** ...\n"
        "**Delivers:**   ...  \n"
        "Wait for it... then go.\n"
        "**Delivers:** Faster builds...\n"
        "1. **(1.1)** ... Verify: ...\n"
    )
    report = _run_check(vp.check_placeholders, text)
    assert [i.line for i in report.issues] == [1, 2, 3]


def test_placeholder_report_is_capped_at_ten():
    text = "".join(f"Line {n}: TBD\n" for n in range(1, 14))
    report = _run_check(vp.check_placeholders, text)
    assert len(report.issues) == 11
    assert [i.line for i in report.issues[:10]] == list(range(1, 11))
    assert report.issues[10].message.startswith("+3 more")
    assert {i.severity for i in report.issues} == {"warning"}


def test_one_issue_per_line_names_every_placeholder():
    report = _run_check(vp.check_placeholders, "Fill {{DATE}} and <name> and TBD.\n")
    assert len(report.issues) == 1
    for snippet in ("{{DATE}}", "<name>", "TBD"):
        assert snippet in report.issues[0].message


STEPS_PLAN = """# PLAN — demo

## Ordered steps

### Phase 1 — one
1. **(1.1)** Edit `a.py`. Verify: `pytest a` passes.
2. **(1.2)** Edit `b.py` to add the flag.
3. **(1.3)** Edit `c.py` to read it.
   - note on how
4. **(1.4)** Edit `d.py`. Expected: PASS

### Phase 2 — two
5. **(2.1)** Edit `e.py`.
   - Verify (ACs): the run prints ok.
"""


def test_v2_steps_without_verify_warn_per_step():
    report = _run_check(vp.check_v2_steps, STEPS_PLAN)
    assert len(report.issues) == 2
    assert "Step 1.2" in report.issues[0].message and "Step 1.3" in report.issues[1].message
    assert [i.line for i in report.issues] == [_line_of(STEPS_PLAN, "(1.2)"), _line_of(STEPS_PLAN, "(1.3)")]
    assert {(i.severity, i.category) for i in report.issues} == {("warning", "verification")}


def test_v2_step_without_file_path_warns():
    text = (
        "## Ordered steps\n"
        "1. **(1.1)** Update the config. Verify: run the tests.\n"
        "2. **(1.2)** Edit `b.py`. Verify: run the tests.\n"
        "3. **(1.3)** Edit the loader.\n"
    )
    report = _run_check(vp.check_v2_steps, text)
    assert [(i.category, i.line) for i in report.issues] == [
        ("specificity", 2),
        ("verification", 4),
        ("specificity", 4),
    ]
    assert "Step 1.1" in report.issues[0].message
    assert "Step 1.3" in report.issues[1].message and "Step 1.3" in report.issues[2].message
    assert {i.severity for i in report.issues} == {"warning"}


def test_v2_step_body_ends_at_next_step_or_heading():
    text = (
        "## Ordered steps\n"
        "1. **(1.1)** Edit `a.py`.\n"
        "2. **(1.2)** Edit `b.py`. Verify: ok.\n"
        "3. **(1.3)** Edit `c.py`.\n"
        "### Phase 2\n"
        "Verify: phase prose belongs to no step.\n"
        "4. **(2.1)** Edit `d.py`.\n"
        "```\n"
        "# a shell comment is not a heading\n"
        "Verify: it\n"
        "```\n"
        "## Risks\n"
        "5. **(9.9)** Edit `z.py` outside the steps section.\n"
    )
    report = _run_check(vp.check_v2_steps, text)
    # 1.1 gets nothing from 1.2's Verify; 1.3 gets nothing from the prose under the next
    # heading; 2.1 keeps the Verify inside its fenced block; 9.9 is outside the section.
    assert [i.message.split()[1] for i in report.issues] == ["1.1", "1.3"]


def test_v2_steps_in_code_fences_are_examples():
    text = (
        "## Ordered steps\n"
        "```markdown\n"
        "1. **(1.1)** An example step with no file and no check.\n"
        "```\n"
        "1. **(1.2)** Edit `b.py`. Verify: ok.\n"
    )
    assert _run_check(vp.check_v2_steps, text).issues == []


def test_v2_verify_must_be_a_label():
    def flagged(step_text: str) -> bool:
        return bool(_run_check(vp.check_v2_steps, f"## Ordered steps\n1. **(1.1)** Edit `a.py`. {step_text}\n").issues)

    assert not flagged("Verify: ok")
    assert not flagged("**Verify:** ok")
    assert not flagged("Verify (ACs): ok")
    assert not flagged("Verify each run: ok")
    # Prose that merely contains the word, with the colon far away, is not a label
    assert flagged("Verify the parser rejects an empty string: ok")
    assert flagged("We verify: ok")  # case matters: the label is `Verify`


def test_v3_unverified_step_is_error(tmp_path):
    plan = V3_HEAD + "\n# PLAN — demo\n\n" + STEPS_PLAN.split("\n", 2)[2]
    clean = plan.replace("Edit `b.py` to add the flag.", "Edit `b.py`. Verify: ok.").replace(
        "Edit `c.py` to read it.", "Edit `c.py`. Verify: ok."
    )
    report = _validate(tmp_path, plan)
    errs = [i for i in report.errors if i.category == "verification"]
    assert [i.line for i in errs] == [_line_of(plan, "(1.2)"), _line_of(plan, "(1.3)")]
    assert not report.passed
    assert report.score == _validate(tmp_path, clean).score


def test_traceability_without_rows_flagged(tmp_path):
    def trace(*rows: str) -> str:
        return "\n".join(["# PLAN — demo", "", "## Traceability", "| Finding | Step |", "|---|---|", *rows, "", "## Out of scope", "x"])

    for rows in ((), ("| | |",)):
        legacy = _run_check(vp.check_traceability_rows, trace(*rows))
        assert [(i.severity, i.category, i.line) for i in legacy.issues] == [("warning", "traceability", 3)]
    assert _run_check(vp.check_traceability_rows, trace("| A-1 | 1.1 |")).issues == []
    # A table inside a fenced block is an example, not a row of this section
    fenced = "# PLAN — demo\n\n## Traceability\n```\n| A | B |\n|---|---|\n| x | y |\n```\n"
    assert [i.line for i in _run_check(vp.check_traceability_rows, fenced).issues] == [3]
    # A missing section is the existing check's job, not a second finding here
    assert _run_check(vp.check_traceability_rows, "# PLAN — demo\n\n## Out of scope\nx\n").issues == []
    # Through validate_plan: error on v3, warning on legacy
    v3 = _validate(tmp_path, V3_HEAD + "\n" + trace())
    assert [i.line for i in v3.errors if i.category == "traceability"] == [_line_of(V3_HEAD + "\n" + trace(), "## Traceability")]
    assert not any(i.category == "traceability" for i in _validate(tmp_path, LEGACY_HEAD + "\n" + trace("| A-1 | 1.1 |")).issues)


LEGACY_72 = (
    LEGACY_HEAD
    + """
# PLAN — demo

## Target repo & files
Repo `/work/demo`. Modified: `a.py`, `b.py`. Owner: {{OWNER}}

## Structure (phased)
Phase 1 only.

## Ordered steps

### Phase 1 — core
1. **(1.1)** Edit `a.py` to add the flag.
2. **(1.2)** Edit `b.py` to read the flag.
3. **(1.3)** Edit `c.py` to log the flag.
4. **(1.4)** Edit `d.py` to test the flag.
5. **(1.5)** Document the flag for users.

## Verification (aggregate)
Run the test suite and the lint.

## Traceability
| Discovery finding | Plan step |
|---|---|

## Out of scope
Nothing else will change.
"""
)


def test_legacy_pass_status_unchanged_by_new_checks(tmp_path):
    # C13. Without the new checks this plan scores 72 and passes (no Brief, PR-size, risks or
    # git sections cost 28). It also carries 5 unverified v2 steps (one without a file path), a
    # placeholder and an empty Traceability table. The new checks must see all of them and still
    # leave 72 and PASS.
    report = _validate(tmp_path, LEGACY_72)
    assert len([i for i in report.issues if i.category == "verification" and "Step 1." in i.message]) == 5
    assert [i.severity for i in report.issues if i.category == "specificity" and "Step 1.5" in i.message] == ["warning"]
    assert [i.severity for i in report.issues if i.category == "placeholder"] == ["warning"]
    assert [i.severity for i in report.issues if i.category == "traceability" and i.line] == ["warning"]
    assert not report.errors
    assert report.score == 72
    assert report.passed


# ---------------------------------------------------------------------------
# v3 approval card: parse_card, parse_dlines and check_card
#
# Each rule test edits the valid fixture with str.replace (the v3_plan factory
# raises when the text to replace is not there) and asserts that exactly that
# rule fires. The fixture is 118 words with the questions ending at word 58, so
# a test that adds words to the questions takes the same number out elsewhere.
# ---------------------------------------------------------------------------

Q1 = "1. Share links expire? \u2192 **after 30 days** (limits leaked links; if wrong: one config value)"
Q2 = "2. Link viewers see claimed items? \u2192 **no** (protects the surprise invariant; if wrong: one flag)"
Q3 = "3. Run \u2192 **subagent-driven** (5 independent tasks; or inline)"
SHIPS = "**Ships as:** 1 PR, feat/share-link \u2192 origin/main"
DELIVERS = "**Delivers:** A signed-in user can share a read-only wishlist link with anyone."
SIZE = "**Size:** ~430 lines \u00b7 9 files \u00b7 5 tasks \u00b7 1 endpoint \u00b7 1 PR"
SIZE_SHORT = "**Size:** ~430 lines \u00b7 9 files \u00b7 1 PR"  # 4 words shorter
MADE_D4 = "- D4 Token is 128-bit random, stored hashed (if wrong: rotate all tokens)"
MADE_D5 = "- D5 Viewer reuses the list component (if wrong: one file)"
MADE_ITEMS = MADE_D4 + "\n" + MADE_D5 + "\n"
FLAGS = "**Flags:** none"
D1 = "- D1 [ask] Share links expire? Default: after 30 days. Why: limits leaked links. If wrong: one config value."
D2 = "- D2 [ask] Link viewers see claimed items? Default: no. Why: protects the surprise invariant. If wrong: one flag."
Q_BLOCK = "\n".join((Q1, Q2, Q3))

CARD_RULES = (
    "missing_label label_order card_over_120_words questions_after_word_60 question_over_20_words "
    "four_questions run_not_last delivers_not_user_action size_without_counts unknown_flag "
    "made_for_you_unknown_did ask_without_question question_without_ask one_way_made conflicts_made "
    "backticks_in_brief remote_checked_in_brief dline_default_mismatch"
).split()


def _v3(tmp_path, **replace) -> "vp.ValidationReport":
    return vp.validate_plan(v3_plan(tmp_path, **replace))


def _fires_only(report: "vp.ValidationReport", rule: str) -> list["vp.Issue"]:
    """Assert `rule` is the one error id in the report, as a human-audience card error that costs no score."""
    got = [(i.rule, i.category, i.message) for i in report.errors]
    assert {r for r, _, _ in got} == {rule}, got
    assert all(i.category == "card" and i.audience == "human" for i in report.errors), got
    assert not report.passed
    assert report.score == 100, "v3 errors block through severity alone"
    return report.errors


def _plan_lines(tmp_path, **replace) -> list[str]:
    return v3_plan(tmp_path, **replace).read_text(encoding="utf-8").splitlines()


def test_fixture_is_118_words_with_questions_ending_at_word_58():
    # An independent count (whitespace tokens that contain a word character), so the
    # budget tests below cannot pass on a miscounting validator.
    text = (Path(vp.__file__).parent / "fixtures" / "v3-valid-PLAN.md").read_text(encoding="utf-8").splitlines()
    start = text.index("## Brief")
    brief = [ln for ln in text[start + 1 : text.index("---", start)] if ln.strip()]

    def words(line: str) -> int:
        return sum(1 for token in line.split() if any(c.isalnum() or c == "_" for c in token))

    ask = words('**Approve "Wishlist: share a list by link"?** Reply go to take every default, or answer by number.')
    position, last_numbered = ask, 0
    for line in brief:
        position += words(line)
        if line[:1].isdigit():
            last_numbered = position
    assert (position + 4, last_numbered) == (118, 58)


def test_issue_rule_defaults_to_empty():
    assert vp.Issue("error", "card", "m").rule == ""
    assert vp.Issue("error", "card", "m", 3, "missing_label").rule == "missing_label"


def test_valid_v3_has_no_card_errors(tmp_path):
    report = _v3(tmp_path)
    assert [i for i in report.issues if i.category in ("card", "brief")] == []
    assert report.errors == []
    assert report.passed
    assert report.score == 100


def test_v3_plan_factory_makes_a_real_repo_and_rejects_stale_edits(tmp_path):
    plan = v3_plan(tmp_path)
    repo = vp.parse_frontmatter(plan.read_text(encoding="utf-8")).data["delivery"][0]["repo"]
    assert repo == str((tmp_path / "repo").resolve()) and Path(repo, ".git").is_dir()
    with pytest.raises(AssertionError):
        v3_plan(tmp_path / "other", **{"text that is not in the fixture": "x"})


def test_answered_you_counts_as_counterpart(tmp_path):
    answered_question = {"\u2192 **after 30 days**": "\u2192 **you: after 30 days**"}
    answered_dline = {"- D2 [ask]": "- D2 [you: no]"}
    for n, replace in enumerate((answered_question, answered_dline, {**answered_question, **answered_dline})):
        report = _v3(tmp_path / str(n), **replace)
        assert [i for i in report.issues if i.category == "card"] == [], replace


@pytest.mark.parametrize(
    "replace",
    [
        {D1: D1.replace("after 30 days", "after 7 days").replace("[ask]", "[you: after 7 days]")},
        {Q2: Q2.replace("**no**", "**you: no**"), D2: D2.replace("Default: no", "Default: yes")},
    ],
    ids=["you-dline", "you-question"],
)
def test_answered_question_skips_default_check(tmp_path, replace):
    report = _v3(tmp_path, **replace)
    assert [i for i in report.issues if i.category == "card"] == []


def test_card_budget_boundaries_are_inclusive(tmp_path):
    # Exactly 120 words in total, and the last question ending at exactly word 60, are fine ...
    total_120 = _v3(tmp_path / "a", **{"with anyone.": "with anyone now today."})
    last_question_at_60 = _v3(tmp_path / "b", **{"invariant;": "invariant for viewers;"})
    for report in (total_120, last_question_at_60):
        assert [i for i in report.issues if i.category == "card"] == []
    # ... one more word in either is not
    total_121 = _v3(tmp_path / "c", **{"with anyone.": "with anyone now today soon."})
    last_question_at_61 = _v3(tmp_path / "d", **{"invariant;": "invariant for every viewer;", SIZE: SIZE_SHORT})
    assert {i.rule for i in total_121.errors} == {"card_over_120_words"}
    assert {i.rule for i in last_question_at_61.errors} == {"questions_after_word_60"}


@pytest.mark.parametrize(
    "removed",
    [SHIPS + "\n", DELIVERS + "\n", SIZE + "\n", "**Made for you:**\n", FLAGS + "\n"],
    ids=["ships-as", "delivers", "size", "made-for-you", "flags"],
)
def test_missing_label_error(tmp_path, removed):
    errors = _fires_only(_v3(tmp_path, **{removed: ""}), "missing_label")
    assert removed.split("**")[1] in errors[0].message


def test_missing_needs_your_call_label_is_an_error(tmp_path):
    report = _v3(tmp_path, **{"**Needs your call:**": "**Questions:**"})
    assert "missing_label" in {i.rule for i in report.errors}
    assert not report.passed


def test_label_order_error(tmp_path):
    report = _v3(tmp_path, **{DELIVERS + "\n" + SIZE: SIZE + "\n" + DELIVERS})
    errors = _fires_only(report, "label_order")
    assert "**Size:**" in errors[0].message and "**Delivers:**" in errors[0].message


def test_card_over_120_words_error(tmp_path):
    report = _v3(tmp_path, **{"with anyone.": "with anyone they choose today."})
    errors = _fires_only(report, "card_over_120_words")
    assert "121" in errors[0].message


def test_questions_after_word_60_error(tmp_path):
    # +3 words in question 2 push the last numbered line to word 61; Size gives 4 back to stay under 120
    report = _v3(tmp_path, **{"invariant;": "invariant for every viewer;", SIZE: SIZE_SHORT})
    errors = _fires_only(report, "questions_after_word_60")
    assert "61" in errors[0].message


def test_question_over_20_words_error(tmp_path):
    long_question = "Should shared wishlist links stop working after a while?"
    plan = v3_plan(
        tmp_path,
        **{
            "Share links expire?": long_question,  # question 1 grows to 21 words (+6)
            "(protects the surprise invariant;": "(protects invariant;",  # -2
            "(5 independent tasks;": "(tasks;",  # -2, so the questions still end by word 60
        },
    )
    errors = _fires_only(vp.validate_plan(plan), "question_over_20_words")
    assert errors[0].line == _line_of(plan.read_text(encoding="utf-8"), "1. Should shared")
    assert "21 words" in errors[0].message


def _terse_questions(n_questions: int, first_dline: int = 6) -> dict[str, str]:
    """Replace the fixture's three questions and their [ask] lines with n terse ones plus Run.

    The terse card is short, so only the question count is in play. The new [ask]
    lines use ids from D6 up, because D3 to D5 belong to the made-for-you items.
    """
    questions = "\n".join(f"{n}. Q{n}? \u2192 **x** (r; if wrong: c)" for n in range(1, n_questions + 1))
    questions += f"\n{n_questions + 1}. Run \u2192 **inline** (r; or subagent-driven)"
    asks = "\n".join(f"- D{first_dline + n} [ask] Q{n + 1}? Default: x. Why: r. If wrong: c." for n in range(n_questions))
    return {Q_BLOCK: questions, D1: asks, D2 + "\n": ""}


def test_four_questions_error(tmp_path):
    errors = _fires_only(_v3(tmp_path, **_terse_questions(4)), "four_questions")
    assert "4 questions" in errors[0].message


def test_three_questions_plus_run_is_allowed(tmp_path):
    report = _v3(tmp_path, **_terse_questions(3))
    assert [i for i in report.issues if i.category == "card"] == []


def test_run_not_last_error(tmp_path):
    swapped = Q_BLOCK.replace(Q2 + "\n" + Q3, "2. Run \u2192 **subagent-driven** (5 independent tasks; or inline)\n3." + Q2[2:])
    report = _v3(tmp_path, **{Q_BLOCK: swapped})
    _fires_only(report, "run_not_last")


@pytest.mark.parametrize("delivers", ["Sharing by link.", "A user shares lists.", "A user can", "Share a list."])
def test_delivers_not_user_action_error(tmp_path, delivers):
    report = _v3(tmp_path, **{DELIVERS: "**Delivers:** " + delivers})
    _fires_only(report, "delivers_not_user_action")


@pytest.mark.parametrize(
    "delivers",
    ["An admin can export every list.", "None user-visible: foundation for link sharing."],
)
def test_delivers_accepts_user_action_and_foundation(tmp_path, delivers):
    report = _v3(tmp_path, **{DELIVERS: "**Delivers:** " + delivers})
    assert [i for i in report.issues if i.category == "card"] == []


@pytest.mark.parametrize("n_words, rules", [(25, set()), (26, {"delivers_over_25_words"})])
def test_delivers_is_at_most_25_words(tmp_path, n_words, rules):
    delivers = "A user can " + " ".join(f"w{i}" for i in range(n_words - 3)) + "."
    # The made-for-you items give 21 words back so only the Delivers cap is in play
    report = _v3(tmp_path, **{DELIVERS: "**Delivers:** " + delivers, MADE_ITEMS: "None.\n"})
    assert {i.rule for i in report.errors} == rules


@pytest.mark.parametrize(
    "replace",
    [{"~430 lines \u00b7 ": ""}, {"9 files \u00b7 ": ""}, {"1 endpoint \u00b7 1 PR": "1 endpoint"}],
    ids=["no-lines", "no-files", "no-prs"],
)
def test_size_without_counts_error(tmp_path, replace):
    _fires_only(_v3(tmp_path, **replace), "size_without_counts")


@pytest.mark.parametrize("size", ["~1,200 lines \u00b7 1 file \u00b7 2 PRs", "430 lines \u00b7 9 files \u00b7 1 PR"])
def test_size_accepts_comma_tilde_and_plurals(tmp_path, size):
    report = _v3(tmp_path, **{SIZE: "**Size:** " + size})
    assert [i for i in report.issues if i.category == "card"] == []


def test_unknown_flag_error(tmp_path):
    report = _v3(tmp_path, **{FLAGS: "**Flags:** auth, banana"})
    errors = _fires_only(report, "unknown_flag")
    assert "banana" in errors[0].message
    # "none" is a whole-field value, not a list member
    _fires_only(_v3(tmp_path / "b", **{FLAGS: "**Flags:** auth, none"}), "unknown_flag")
    _fires_only(_v3(tmp_path / "c", **{FLAGS: "**Flags:**"}), "unknown_flag")


@pytest.mark.parametrize(
    "flags", ["none", "auth", "payments", "migration", "delete", "external-contract", "prod-infra", "auth, payments"]
)
def test_flags_accepts_each_documented_flag(tmp_path, flags):
    report = _v3(tmp_path, **{FLAGS: "**Flags:** " + flags})
    assert [i for i in report.issues if i.category == "card"] == []


@pytest.mark.parametrize(
    "replace",
    [{"- D5 Viewer": "- D9 Viewer"}, {"- D4 Token": "- D1 Token"}],
    ids=["no-such-dline", "dline-is-ask"],
)
def test_made_for_you_unknown_did_error(tmp_path, replace):
    errors = _fires_only(_v3(tmp_path, **replace), "made_for_you_unknown_did")
    assert any(did in errors[0].message for did in ("D9", "D1"))


def test_ask_without_question_error(tmp_path):
    extra = "- D6 [ask] Notify the owner? Default: no. Why: quiet. If wrong: one flag.\n- Do not change:"
    errors = _fires_only(_v3(tmp_path, **{"- Do not change:": extra}), "ask_without_question")
    assert "D6" in errors[0].message


def test_question_without_ask_error(tmp_path):
    errors = _fires_only(_v3(tmp_path, **{D2 + "\n": ""}), "question_without_ask")
    assert "Link viewers see claimed items?" in errors[0].message


def test_one_way_made_error(tmp_path):
    errors = _fires_only(_v3(tmp_path, **{"- D3 [made]": "- D3 [made, one-way]"}), "one_way_made")
    assert "D3" in errors[0].message


def test_conflicts_made_error(tmp_path):
    report = _v3(tmp_path, **{"add a role column.": "add a role column. Conflicts: CLAUDE.md Terraform default."})
    errors = _fires_only(report, "conflicts_made")
    assert "D3" in errors[0].message


def test_backticks_in_brief_error(tmp_path):
    _fires_only(_v3(tmp_path, **{"a read-only wishlist": "a `read-only` wishlist"}), "backticks_in_brief")


@pytest.mark.parametrize("ref", ["anyone (2.1).", "step 2.", "step 2.1."])
def test_step_ref_in_brief_error(tmp_path, ref):
    _fires_only(_v3(tmp_path, **{"anyone.": ref}), "step_ref_in_brief")


def test_remote_checked_in_brief_error(tmp_path):
    # The renderer adds the check time; an author-written one would print twice. Size gives 4 words back.
    report = _v3(tmp_path, **{SHIPS: SHIPS + " (remote checked 10-07 09:12)", SIZE: SIZE_SHORT})
    _fires_only(report, "remote_checked_in_brief")


def test_dline_default_mismatch_error(tmp_path):
    errors = _fires_only(_v3(tmp_path, **{"Default: after 30 days.": "Default: after 7 days."}), "dline_default_mismatch")
    assert "D1" in errors[0].message and "after 7 days" in errors[0].message


@pytest.mark.parametrize("n_words, rules", [(20, set()), (21, {"made_over_20_words"})])
def test_made_for_you_item_is_at_most_20_words(tmp_path, n_words, rules):
    filler = ["tests,", "styles,", "loading", "states,", "error", "states,", "empty", "states", "too", "again"]
    item = "- D5 Viewer reuses the list component and its " + " ".join(filler[: n_words - 12]) + " (if wrong: one file)"
    report = _v3(tmp_path, **{MADE_ITEMS: item + "\n"})
    assert {i.rule for i in report.errors} == rules


def test_four_made_for_you_items_error(tmp_path):
    items = "- D3 Read-only (if wrong: roles)\n- D4 Hashed (if wrong: rotate)\n- D5 Reused (if wrong: one file)\n- D6 Counted (if wrong: one flag)\n"
    extra = "- D6 [made] Owner sees view counts. Why: cheap. If wrong: one flag.\n- Do not change:"
    report = _v3(tmp_path, **{MADE_ITEMS: items, "- Do not change:": extra})
    _fires_only(report, "four_made")


def test_made_for_you_none_is_valid(tmp_path):
    report = _v3(tmp_path, **{MADE_ITEMS: "None.\n"})
    assert [i for i in report.issues if i.category == "card"] == []


def test_made_for_you_format_error(tmp_path):
    _fires_only(_v3(tmp_path, **{"(if wrong: one file)": "(one file)"}), "made_for_you_format")
    # a label with neither items nor "None." is unfilled
    _fires_only(_v3(tmp_path / "b", **{MADE_ITEMS: ""}), "made_for_you_format")


def test_question_format_error(tmp_path):
    plan = v3_plan(tmp_path, **{"\u2192 **no**": "**no**"})
    errors = [i for i in vp.validate_plan(plan).errors if i.rule == "question_format"]
    assert [i.line for i in errors] == [_line_of(plan.read_text(encoding="utf-8"), "2. Link viewers")]


def test_ascii_arrow_is_normalized(tmp_path):
    ascii_card = {Q1: Q1.replace("\u2192", "->"), Q3: Q3.replace("\u2192", "->"), SHIPS: SHIPS.replace("\u2192", "->")}
    plan = v3_plan(tmp_path, **ascii_card)
    assert [i for i in vp.validate_plan(plan).issues if i.category == "card"] == []
    card = vp.parse_card(plan.read_text(encoding="utf-8").splitlines())
    # parsed text reads the arrow; brief_text stays verbatim for the renderer
    assert card.fields["**Ships as:**"].text == "1 PR, feat/share-link \u2192 origin/main"
    assert card.questions[0].text == "Share links expire?"
    assert "feat/share-link -> origin/main" in card.brief_text


def test_question_must_end_in_a_question_mark_and_run_must_offer_the_other_option(tmp_path):
    no_mark = _v3(tmp_path / "a", **{"Share links expire? \u2192": "Share links expire \u2192"})
    assert "question_format" in {i.rule for i in no_mark.errors}
    bad_other = _v3(tmp_path / "b", **{"or inline)": "or banana)"})
    assert "question_format" in {i.rule for i in bad_other.errors}


def test_three_made_for_you_items_are_allowed(tmp_path):
    items = "- D3 Read-only (if wrong: roles)\n- D4 Hashed (if wrong: rotate)\n- D5 Reused (if wrong: one file)\n"
    assert [i for i in _v3(tmp_path, **{MADE_ITEMS: items}).issues if i.category == "card"] == []


def test_made_for_you_none_may_follow_the_label_on_the_same_line(tmp_path):
    report = _v3(tmp_path, **{"**Made for you:**\n" + MADE_ITEMS: "**Made for you:** None.\n"})
    assert [i for i in report.issues if i.category == "card"] == []


def test_one_way_and_conflicts_both_fire_on_one_line(tmp_path):
    both = {"- D3 [made]": "- D3 [made, one-way]", "add a role column.": "add a role column. Conflicts: CLAUDE.md."}
    assert {i.rule for i in _v3(tmp_path, **both).errors} == {"one_way_made", "conflicts_made"}


def test_brief_missing_error(tmp_path):
    errors = _fires_only(_v3(tmp_path, **{"## Brief": "## Summary"}), "brief_missing")
    assert errors[0].line == 0


def test_brief_not_first_error(tmp_path):
    _fires_only(_v3(tmp_path, **{"## Brief\n": "## Overview\nShare links.\n\n## Brief\n"}), "brief_not_first")


def test_global_constraints_missing_error(tmp_path):
    report = _v3(tmp_path, **{"## Global Constraints": "## Constraints"})
    assert "global_constraints_missing" in {i.rule for i in report.errors}


def test_title_missing_error(tmp_path):
    _fires_only(_v3(tmp_path, **{"# PLAN: Wishlist: share a list by link": "# Wishlist plan"}), "title_missing")


def test_dline_format_error(tmp_path):
    _fires_only(_v3(tmp_path, **{"- D3 [made]": "- D3 [mde]"}), "dline_format")
    # an [ask] body must read "<question>? Default: <d>. Why: <w>. If wrong: <c>."
    report = _v3(tmp_path / "b", **{" Why: protects the surprise invariant.": ""})
    assert "dline_format" in {i.rule for i in report.errors}


def test_card_errors_carry_the_line_of_their_cause(tmp_path):
    plan = v3_plan(tmp_path, **{"Default: after 30 days.": "Default: after 7 days."})
    text = plan.read_text(encoding="utf-8")
    report = vp.validate_plan(plan)
    assert [i.line for i in report.errors] == [_line_of(text, "- D1 [ask]")]


def test_every_card_rule_has_a_test():
    names = {n for n in globals() if n.startswith("test_") and n.endswith("_error")}
    assert [r for r in CARD_RULES if f"test_{r}_error" not in names] == []


def test_two_run_items_error(tmp_path):
    # Two terse Run items cost 4 words; question 2's reason gives 2 back so the budgets stay quiet
    two_runs = {
        Q3: "3. Run \u2192 **inline** (r; or subagent-driven)\n4. Run \u2192 **inline** (r; or subagent-driven)",
        "(protects the surprise invariant;": "(protects invariant;",
    }
    _fires_only(_v3(tmp_path, **two_runs), "run_not_last")


def test_one_way_made_item_on_the_card_is_reported_once(tmp_path):
    # D4 is listed under Made for you; being one-way is the only thing wrong with it
    _fires_only(_v3(tmp_path, **{"- D4 [made]": "- D4 [made, one-way]"}), "one_way_made")


def test_conflicts_marker_is_only_an_error_on_made_lines(tmp_path):
    ask = {" If wrong: one flag.": " If wrong: one flag. Conflicts: CLAUDE.md Terraform default."}
    assert [i for i in _v3(tmp_path, **ask).issues if i.category == "card"] == []


def test_answered_dline_needs_no_question(tmp_path):
    # An approved plan may keep a [you: ...] line for a question that left the card
    extra = "- D6 [you: 7 days] Retain views? Default: 30 days. Why: cheap. If wrong: one flag.\n- Do not change:"
    assert [i for i in _v3(tmp_path, **{"- Do not change:": extra}).issues if i.category == "card"] == []


@pytest.mark.parametrize(
    "heading, title",
    [
        ("# PLAN: Wishlist: share", "Wishlist: share"),
        ("# PLAN \u2014 Dash title", "Dash title"),
        ("# PLAN - Hyphen title  ", "Hyphen title"),
        ("#   PLAN:Tight", "Tight"),
        ("# PLANNING: x", None),
        ("## PLAN: x", None),
        ("# Plan: x", None),
    ],
)
def test_plan_title(heading, title):
    assert vp.plan_title(["---", "slug: s", "---", "", heading, "body"]) == title


def test_plan_title_skips_fenced_code_and_frontmatter():
    assert vp.plan_title(["---", "# PLAN: in frontmatter", "---", "```", "# PLAN: in fence", "```"]) is None
    assert vp.plan_title(["```", "# PLAN: in fence", "```", "# PLAN: real"]) == "real"


def test_ask_line_is_the_gc9_text():
    assert vp.ask_line("Wishlist: share") == '**Approve "Wishlist: share"?** Reply go to take every default, or answer by number.'


# parse_card and parse_dlines


def test_parse_card_reads_the_fixture(tmp_path):
    plan = v3_plan(tmp_path)
    text = plan.read_text(encoding="utf-8")
    card = vp.parse_card(text.splitlines())
    assert card.questions == [
        vp.Question(1, "Share links expire?", "after 30 days", "limits leaked links", "one config value", False, False, _line_of(text, "1. Share")),
        vp.Question(2, "Link viewers see claimed items?", "no", "protects the surprise invariant", "one flag", False, False, _line_of(text, "2. Link")),
        vp.Question(3, "Run", "subagent-driven", "5 independent tasks", "inline", True, False, _line_of(text, "3. Run")),
    ]
    assert card.made == [
        ("D4", "Token is 128-bit random, stored hashed", "rotate all tokens"),
        ("D5", "Viewer reuses the list component", "one file"),
    ]
    assert list(card.fields) == list(vp.CARD_LABELS)
    assert card.fields["**Ships as:**"].text == "1 PR, feat/share-link \u2192 origin/main"
    assert card.fields["**Delivers:**"].text == "A signed-in user can share a read-only wishlist link with anyone."
    assert card.fields["**Flags:**"].text == "none"
    assert card.fields["**Flags:**"].line == _line_of(text, "**Flags:**")
    assert card.brief_start == _line_of(text, "## Brief")
    brief = card.brief_text.splitlines()
    assert brief[0] == "**Needs your call:**" and brief[-1] == "**Flags:** none" and len(brief) == 11


def test_parse_card_brief_stops_at_rule_and_skips_blank_and_quote_lines(tmp_path):
    lines = [
        "# PLAN: x", "", "## Brief", "> guidance", "", "**Flags:** none", "", "---", "**Size:** after the rule", "## Next", "**Delivers:** no",
    ]
    card = vp.parse_card(lines)
    assert card.brief_text == "**Flags:** none"
    assert card.brief_start == 3
    assert list(card.fields) == ["**Flags:**"]
    # without a rule line, the next level-2 heading ends the Brief
    assert vp.parse_card(["## Brief", "**Flags:** none", "## Next", "**Size:** later"]).brief_text == "**Flags:** none"
    # a plan with no Brief parses to an empty card
    empty = vp.parse_card(["# PLAN: x", "", "## Notes", "text"])
    assert (empty.questions, empty.made, empty.fields, empty.brief_text, empty.brief_start) == ([], [], {}, "", 0)


def test_parse_card_ignores_a_brief_heading_inside_a_fence_or_frontmatter():
    lines = ["---", "## Brief", "---", "# PLAN: x", "```", "## Brief", "**Flags:** none", "```", "## Brief", "**Flags:** auth"]
    card = vp.parse_card(lines)
    assert card.fields["**Flags:**"].text == "auth" and card.brief_start == 9


def test_parse_card_marks_answered_questions(tmp_path):
    lines = _plan_lines(tmp_path, **{"\u2192 **no**": "\u2192 **you: no**", "\u2192 **subagent-driven**": "\u2192 **you: inline**"})
    q = vp.parse_card(lines).questions
    assert [(x.answered, x.default) for x in q] == [(False, "after 30 days"), (True, "no"), (True, "inline")]


def test_parse_dlines_reads_every_tag(tmp_path):
    lines = _plan_lines(
        tmp_path,
        **{"- D3 [made]": "- D3 [made, one-way]", "- D2 [ask]": "- D2 [you: no, never]", "- Do not change:": "- D6 [you: 7 days] Q? Default: x. Why: y. If wrong: z.\n- Do not change:"},
    )
    dlines = vp.parse_dlines(lines)
    assert list(dlines) == ["D1", "D2", "D3", "D4", "D5", "D6"]
    assert [d.tag for d in dlines.values()] == ["ask", "you: no, never", "made, one-way", "made", "made", "you: 7 days"]
    assert dlines["D1"].default == "after 30 days"
    assert dlines["D1"].text.startswith("Share links expire? Default:")
    assert dlines["D3"].default == "" and dlines["D3"].text.startswith("A share link grants read access only.")
    assert dlines["D6"].default == "x"
    assert dlines["D1"].line == _line_of("\n".join(lines), "- D1 [ask]")


def test_parse_dlines_is_scoped_to_global_constraints_and_skips_fences():
    lines = [
        "## Notes", "- D9 [ask] Q? Default: a. Why: b. If wrong: c.", "## Global Constraints", "```", "- D8 [made] fenced. Why: a. If wrong: b.", "```",
        "- D1 [made] real. Why: a. If wrong: b.", "### Sub", "- D2 [made] still inside. Why: a. If wrong: b.", "## Next", "- D7 [made] outside. Why: a. If wrong: b.",
    ]
    assert list(vp.parse_dlines(lines)) == ["D1", "D2"]
    assert vp.parse_dlines(["# PLAN: x"]) == {}


# dispatch


def test_legacy_plan_gets_no_card_checks_and_keeps_check_brief(tmp_path):
    bad = {"schema: plan/v3": "schema: plan/v2", "**Flags:** none": "**Flags:** banana"}
    legacy = _v3(tmp_path, **bad)
    assert not [i for i in legacy.issues if i.category == "card"]
    assert [i.category for i in legacy.issues].count("legacy") == 1
    # check_brief ran: the card has none of its three labels
    assert any(i.category == "brief" and "**Changes:**" in i.message for i in legacy.issues)


def test_v3_plan_does_not_run_check_brief(tmp_path):
    assert not [i for i in _v3(tmp_path).issues if i.category == "brief"]
