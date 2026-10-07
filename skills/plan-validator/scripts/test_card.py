"""Tests for card.py render: the approval card printed for a plan/v3 PLAN.md.

Every test drives the real render path on a real plan file, with real git repos
under tmp_path for the delivery probe. The golden card is
fixtures/v3-valid.card.txt: the card the valid v3 fixture must render to, with
`{plan}` standing for the plan's path and the check time masked.

Run from the repo root:
    PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider skills/plan-validator/scripts
"""

import hashlib
import os
import re
import stat
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import pytest

import card
import validate_plan as vp
from conftest import FIXTURES, git_env, v3_plan

SCRIPT = Path(card.__file__).resolve()
GOLDEN = FIXTURES / "v3-valid.card.txt"

TIME_RE = re.compile(r"\(remote checked \d\d-\d\d \d\d:\d\d\)")
MASKED_TIME = "(remote checked MM-DD HH:MM)"
TITLE = "Wishlist: share a list by link"
COMMIT_WARNING = "No commit messages found. Plans should include commit checkpoints with conventional commit messages."
PR_WARNING = "No PR title or description found. Plans should include an anticipated PR title and description."

# Fixture lines that, once removed, make the validator warn (audience human, category git)
_COMMITS_LINE = "- Commits: `feat(share): add token and expiry`, then `feat(share): add share endpoint and viewer page`.\n"
_PR_TITLE_LINE = "- PR title: `feat: share a wishlist by link`. The repo PR template sets the PR description.\n"


def _golden(plan) -> str:
    return GOLDEN.read_text(encoding="utf-8").replace("{plan}", str(plan))


def _mask_time(text: str) -> str:
    return TIME_RE.sub(MASKED_TIME, text)


def _footer_sha(stdout: str) -> str:
    match = re.fullmatch(r"Plan: .+ · validator \d+ PASS · card ([0-9a-f]{7})", stdout.splitlines()[-1])
    assert match, stdout.splitlines()[-1]
    return match.group(1)


def _run_cli(*args, cwd=None):
    env = {**git_env(), "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
        capture_output=True,
        encoding="utf-8",
        env=env,
        cwd=cwd,
        check=False,
    )


# ---------------------------------------------------------------------------
# The card: golden text, word budgets, check time, footer
# ---------------------------------------------------------------------------


def test_render_golden_card(tmp_path):
    plan = v3_plan(tmp_path)
    out, err, code = card.render(plan)
    assert (err, code) == ("", 0)
    assert TIME_RE.search(out), "the Ships-as line carries a check time"
    assert _mask_time(out) == _golden(plan)


def test_card_word_stats_golden_counts():
    # 118 and 58 are the DESIGN 3.2 hand count (ask line 17 words, the three questions end at word 58,
    # the 4-word check time included). They are literals, so a counter bug cannot pass its own budget test.
    assert card.card_word_stats(GOLDEN.read_text(encoding="utf-8")) == (118, 58)


def test_card_word_stats_skips_footer_and_warnings():
    golden = GOLDEN.read_text(encoding="utf-8")
    warned = golden.replace("**Flags:** none\n", "**Flags:** none\n**Warnings for you:** one two three four five six seven\n")
    assert card.card_word_stats(warned) == (118, 58)
    assert card.card_word_stats(golden.replace("Plan: {plan} · validator 100", "Plan: a b c d e f g h")) == (118, 58)


def test_render_within_120_and_questions_by_60(tmp_path):
    out, _, code = card.render(v3_plan(tmp_path))
    assert code == 0
    words, last_question_end = card.card_word_stats(out)
    assert words <= 120
    assert last_question_end <= 60
    # The check time is counted as printed; without its 4 words the card would be 114
    assert (words, last_question_end) == (118, 58)


def test_ships_as_has_live_check_time(tmp_path):
    plan = v3_plan(tmp_path)
    before = datetime.now()
    out, _, _ = card.render(plan, write=False)
    after = datetime.now()
    ships = next(line for line in out.splitlines() if line.startswith("**Ships as:**"))
    match = re.fullmatch(
        r"\*\*Ships as:\*\* 1 PR, feat/share-link → origin/main \(remote checked (\d\d-\d\d \d\d:\d\d)\)", ships
    )
    assert match, ships
    assert match.group(1) in {before.strftime("%m-%d %H:%M"), after.strftime("%m-%d %H:%M")}


@pytest.fixture
def local_tz(monkeypatch):
    """Set the process time zone; the original is restored after the test."""

    def use(name: str) -> None:
        monkeypatch.setenv("TZ", name)
        time.tzset()

    yield use
    monkeypatch.undo()
    time.tzset()


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="needs time.tzset")
@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])
def test_check_time_is_local_time(tmp_path, local_tz, zone):
    # The two zones are 25 hours apart, so UTC cannot match both
    local_tz(zone)
    plan = v3_plan(tmp_path)
    before = datetime.now()
    out, _, _ = card.render(plan, write=False)
    after = datetime.now()
    shown = TIME_RE.search(out).group()
    assert shown in {f"(remote checked {t.strftime('%m-%d %H:%M')})" for t in (before, after)}


def test_check_time_not_stored(tmp_path):
    plan = v3_plan(tmp_path)
    _, _, code = card.render(plan)
    assert code == 0
    assert b"remote checked" not in plan.read_bytes()


def test_render_footer_sha_is_brief_sha256(tmp_path):
    plan = v3_plan(tmp_path)
    text = plan.read_text(encoding="utf-8")
    # The Brief's card lines, found by hand: from the heading to the `---` rule, none blank or quoted
    start = text.index("## Brief\n") + len("## Brief\n")
    body = "\n".join(line for line in text[start : text.index("\n---\n", start)].splitlines() if line.strip() and not line.startswith(">"))
    expected = hashlib.sha256(body.encode("utf-8")).hexdigest()[:7]
    assert expected == "37e114a"

    out, _, _ = card.render(plan, write=False)
    assert _footer_sha(out) == expected


def test_render_footer_sha_follows_the_brief_only(tmp_path):
    base = _footer_sha(card.render(v3_plan(tmp_path / "a"), write=False)[0])
    # A change outside the Brief leaves the sha alone
    outside = v3_plan(tmp_path / "b", **{"Add the expiry setting": "Add the expiry option"})
    assert _footer_sha(card.render(outside, write=False)[0]) == base
    # So does the status line, which render itself rewrites
    drafted = v3_plan(tmp_path / "c")
    card.render(drafted)
    assert _footer_sha(card.render(drafted, write=False)[0]) == base
    # A change in the Brief moves it
    inside = v3_plan(tmp_path / "d", **{"after 30 days": "after 60 days"})
    assert _footer_sha(card.render(inside, write=False)[0]) != base


def test_render_footer_names_absolute_plan_and_score(tmp_path, monkeypatch):
    plan = v3_plan(tmp_path)
    monkeypatch.chdir(tmp_path)
    out, _, _ = card.render("PLAN.md", write=False)
    assert out.splitlines()[-1] == f"Plan: {plan} · validator 100 PASS · card 37e114a"


# ---------------------------------------------------------------------------
# Status: what render writes, and when it writes nothing
# ---------------------------------------------------------------------------


def test_render_draft_changes_only_status_line(tmp_path):
    plan = v3_plan(tmp_path)
    plan.chmod(0o640)
    before = plan.read_bytes().splitlines(keepends=True)
    inode = plan.stat().st_ino
    out, err, code = card.render(plan)
    assert (err, code) == ("", 0) and out
    after = plan.read_bytes().splitlines(keepends=True)
    assert plan.stat().st_ino != inode, "the file is replaced whole (os.replace), not rewritten in place"

    assert len(after) == len(before)
    changed = [(n, was, now) for n, (was, now) in enumerate(zip(before, after)) if was != now]
    assert changed == [(4, b"status: draft\n", b"status: awaiting-approval\n")]
    assert stat.S_IMODE(plan.stat().st_mode) == 0o640
    assert sorted(os.listdir(tmp_path)) == ["PLAN.md", "repo"], "no temp file is left behind"
    assert vp.validate_plan(plan).passed, "the plan still validates once its status is set"


def test_render_preserves_crlf_line_endings(tmp_path):
    plan = v3_plan(tmp_path)
    plan.write_bytes(plan.read_bytes().replace(b"\n", b"\r\n"))
    before = plan.read_bytes().splitlines(keepends=True)
    _, err, code = card.render(plan)
    assert (err, code) == ("", 0)
    after = plan.read_bytes().splitlines(keepends=True)
    assert [(was, now) for was, now in zip(before, after) if was != now] == [
        (b"status: draft\r\n", b"status: awaiting-approval\r\n")
    ]
    assert len(after) == len(before)


def test_render_sets_the_status_line_the_parser_reads(tmp_path):
    # With a repeated key the parser keeps the last, so that is the line render must set
    plan = v3_plan(tmp_path)
    plan.write_text(plan.read_text(encoding="utf-8").replace("status: draft\n", "status: complete\nslug: Again\nstatus: draft\n"), encoding="utf-8")
    assert vp.parse_frontmatter(plan.read_text(encoding="utf-8")).data["status"] == "draft"
    _, err, code = card.render(plan)
    assert (err, code) == ("", 0)
    assert vp.parse_frontmatter(plan.read_text(encoding="utf-8")).data["status"] == "awaiting-approval"


def test_render_writes_through_a_symlink(tmp_path):
    plan = v3_plan(tmp_path)
    link = tmp_path / "link.md"
    link.symlink_to(plan)
    _, _, code = card.render(link)
    assert code == 0
    assert link.is_symlink(), "the link is not replaced by a regular file"
    assert b"status: awaiting-approval\n" in plan.read_bytes()


def test_render_awaiting_approval_reprints_without_writing(tmp_path):
    plan = v3_plan(tmp_path, **{"status: draft": "status: awaiting-approval"})
    before = plan.read_bytes()
    out, err, code = card.render(plan)
    assert (err, code) == ("", 0)
    assert _mask_time(out) == _golden(plan)
    assert plan.read_bytes() == before


def test_render_no_write_leaves_bytes(tmp_path):
    plan = v3_plan(tmp_path)
    before = plan.read_bytes()
    shown, err, code = card.render(plan, write=False)
    assert (err, code) == ("", 0)
    assert plan.read_bytes() == before
    assert b"status: draft\n" in before
    # --no-write prints the same card that a writing render prints
    written, _, _ = card.render(plan)
    assert _mask_time(shown) == _mask_time(written)


@pytest.mark.parametrize("status", ["approved", "in-progress", "complete"])
def test_render_approved_plan_writes_nothing(tmp_path, status):
    plan = v3_plan(tmp_path, **{"status: draft": f"status: {status}"})
    before = plan.read_bytes()
    out, err, code = card.render(plan)
    assert (out, err, code) == (f'"{TITLE}" is {status}; no approval needed.\n', "", 0)
    assert plan.read_bytes() == before


def test_render_unwritable_plan_dir_prints_no_card(tmp_path):
    plan = v3_plan(tmp_path)
    before = plan.read_bytes()
    tmp_path.chmod(0o555)
    try:
        if os.access(tmp_path, os.W_OK):
            pytest.skip("this user can write to a read-only directory")
        out, err, code = card.render(plan)
    finally:
        tmp_path.chmod(0o755)
    assert out == "", "a card is not posted for a plan whose status could not be set"
    assert code == 1
    assert re.fullmatch(rf"ERROR \[io\] Cannot write {re.escape(str(plan))}: .+\n", err), err
    assert plan.read_bytes() == before


def test_write_atomic_failure_leaves_the_file_and_no_temp(tmp_path, monkeypatch):
    # A failure after the temp file exists (a full disk, say) cannot be provoked portably, so make the
    # replace step fail; the point is what is left behind
    plan = v3_plan(tmp_path)
    before = plan.read_bytes()

    def fail(src, dst):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(card.os, "replace", fail)
    with pytest.raises(OSError, match="No space"):
        card.write_atomic(str(plan), "new text")
    assert plan.read_bytes() == before
    assert sorted(os.listdir(tmp_path)) == ["PLAN.md", "repo"]


# ---------------------------------------------------------------------------
# Refusals: invalid, legacy, below PASS, unreadable
# ---------------------------------------------------------------------------


def test_render_invalid_exits_1_stderr(tmp_path):
    plan = v3_plan(tmp_path, **{"**Flags:** none\n": ""})
    before = plan.read_bytes()
    brief_line = plan.read_text(encoding="utf-8").splitlines().index("## Brief") + 1

    out, err, code = card.render(plan)

    assert (out, code) == ("", 1)
    assert err.endswith("\n")
    for line in err.splitlines():
        assert re.fullmatch(r"ERROR \[[\w-]+\] (line \d+: )?.+", line), line
    assert f"ERROR [card] line {brief_line}: Brief is missing the label **Flags:**" in err.splitlines()
    assert plan.read_bytes() == before, "an invalid plan stays a draft"


def test_render_reprobes_remote(tmp_path):
    plan = v3_plan(tmp_path)
    assert card.render(plan, write=False)[2] == 0
    subprocess.run(["git", "-C", str(tmp_path / "repo"), "remote", "remove", "origin"], check=True, capture_output=True, env=git_env())

    out, err, code = card.render(plan)

    assert (out, code) == ("", 1)
    errors = [line for line in err.splitlines() if line.startswith("ERROR [delivery] line 7: ")]
    assert len(errors) == 1 and "no remote named 'origin'" in errors[0], err
    assert b"status: draft\n" in plan.read_bytes()


def test_render_missing_file_exits_1(tmp_path):
    out, err, code = card.render(tmp_path / "nope.md")
    assert (out, code) == ("", 1)
    assert err == f"ERROR [io] File not found: {tmp_path / 'nope.md'}\n"


@pytest.mark.parametrize(
    ("schema_line", "shown"),
    [("schema: plan/v2", "plan/v2"), (None, "none")],
    ids=["v2", "no-frontmatter"],
)
def test_render_legacy_exits_1(tmp_path, schema_line, shown):
    if schema_line:
        plan = v3_plan(tmp_path, **{"schema: plan/v3": schema_line})
    else:
        plan = tmp_path / "PLAN.md"
        plan.write_text("# PLAN: Old plan\n\n## Brief\n**Delivers:** Owners can hide gifts.\n", encoding="utf-8")
    before = plan.read_bytes()

    out, err, code = card.render(plan)

    assert out == ""
    assert err == f"card.py render needs schema: plan/v3 (this plan: {shown}); present legacy plans as before\n"
    assert code == 1
    assert plan.read_bytes() == before


def test_render_refuses_a_plan_that_does_not_pass(tmp_path):
    # Dropping every section from Estimated PR size on, and padding what is left with vague words,
    # leaves no error but a score under 70, so the footer's "PASS" would be untrue
    fixture = (FIXTURES / "v3-valid-PLAN.md").read_text(encoding="utf-8")
    stub = "## Ordered steps\n1. Do it somehow, as needed, probably, maybe, etc.\n"
    plan = v3_plan(tmp_path, **{fixture[fixture.index("## Estimated PR size") :]: stub})
    report = vp.validate_plan(plan)
    assert not report.errors and report.score < 70, "the scenario no longer reaches NEEDS WORK without errors"
    before = plan.read_bytes()

    out, err, code = card.render(plan)

    assert (out, code) == ("", 1)
    lines = err.splitlines()
    assert lines[0].startswith(f"ERROR [score] validator score {report.score}/100 is below 70")
    assert "WARN [git] No commit messages found." in err
    assert "WARN [structure] No risks or assumptions section found." in lines, "agent warnings are listed too: the agent fixes them"
    assert plan.read_bytes() == before


# ---------------------------------------------------------------------------
# Warnings: only the ones a human should see, on a line outside the word cap
# ---------------------------------------------------------------------------


def test_render_shows_only_human_warnings(tmp_path):
    plan = v3_plan(
        tmp_path,
        **{
            _COMMITS_LINE: "",
            "Assumption: the list component already renders read-only lists.": "Assumption: the list component should work as needed.",
        },
    )
    categories = {issue.category for issue in vp.validate_plan(plan).warnings}
    assert {"git", "vagueness"} <= categories, "the plan must raise one human and one agent warning"

    out, err, code = card.render(plan, write=False)

    assert (err, code) == ("", 0)
    lines = out.splitlines()
    assert lines[-2] == f"**Warnings for you:** {COMMIT_WARNING}"
    assert lines[-1].startswith("Plan: ")
    assert "Vague language" not in out and "vagueness" not in out
    assert re.search(r"· validator 9\d PASS ·", lines[-1]), lines[-1]
    assert card.card_word_stats(out) == (118, 58), "the Warnings line is outside the word cap"


def test_render_warnings_line_stops_at_15_words(tmp_path):
    plan = v3_plan(tmp_path, **{_COMMITS_LINE: "", _PR_TITLE_LINE: ""})
    messages = [issue.message for issue in vp.validate_plan(plan).warnings if issue.category == "git"]
    assert messages == [COMMIT_WARNING, PR_WARNING], "the plan must raise two git warnings"

    out, _, _ = card.render(plan, write=False)

    warnings = [line for line in out.splitlines() if line.startswith("**Warnings for you:**")]
    assert warnings == [f"**Warnings for you:** {COMMIT_WARNING}"], "the second warning would pass 15 words"


def test_warnings_line_rules():
    assert card.warnings_line([]) == ""
    assert card.warnings_line(["Two words."]) == "**Warnings for you:** Two words."
    # Whole warnings, in order, while they fit in 15 words; joined by " · "
    assert card.warnings_line(["a b c d e", "f g h i j", "k l m n o", "p"]) == "**Warnings for you:** a b c d e · f g h i j · k l m n o"
    assert card.warnings_line(["a b c d e f g h i j", "k l m n o p"]) == "**Warnings for you:** a b c d e f g h i j"
    # The first one is always shown; a first one over 15 words is cut there
    long_first = " ".join(f"w{n}" for n in range(1, 21))
    assert card.warnings_line([long_first, "later"]) == "**Warnings for you:** " + " ".join(f"w{n}" for n in range(1, 16)) + "…"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def test_render_cli_subprocess(tmp_path):
    plan = v3_plan(tmp_path)
    # A relative PLAN from another working directory, as an agent would run it
    result = _run_cli("render", "PLAN.md", cwd=tmp_path)
    assert (result.returncode, result.stderr) == (0, "")
    assert _mask_time(result.stdout) == _golden(plan)
    assert b"status: awaiting-approval\n" in plan.read_bytes()


def test_render_cli_no_write_flag(tmp_path):
    plan = v3_plan(tmp_path)
    before = plan.read_bytes()
    result = _run_cli("render", plan, "--no-write")
    assert (result.returncode, result.stderr) == (0, "")
    assert _mask_time(result.stdout) == _golden(plan)
    assert plan.read_bytes() == before


def test_render_cli_exit_1_for_legacy_and_invalid(tmp_path):
    legacy = v3_plan(tmp_path / "legacy", **{"schema: plan/v3": "schema: plan/v2"})
    result = _run_cli("render", legacy)
    assert (result.returncode, result.stdout) == (1, "")
    assert result.stderr == "card.py render needs schema: plan/v3 (this plan: plan/v2); present legacy plans as before\n"

    invalid = v3_plan(tmp_path / "invalid", **{"**Flags:** none\n": ""})
    result = _run_cli("render", invalid)
    assert (result.returncode, result.stdout) == (1, "")
    assert "ERROR [card] line " in result.stderr


@pytest.mark.parametrize(
    "args",
    [[], ["render"], ["render", "a.md", "b.md"], ["render", "a.md", "--bogus"], ["bogus"]],
    ids=["no-command", "no-plan", "two-plans", "unknown-flag", "unknown-command"],
)
def test_render_cli_usage_error_exits_64(args):
    result = _run_cli(*args)
    assert (result.returncode, result.stdout) == (64, "")
    assert "usage:" in result.stderr
