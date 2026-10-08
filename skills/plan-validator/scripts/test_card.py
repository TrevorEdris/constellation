"""Tests for card.py: render (the approval card printed for a plan/v3 PLAN.md), the reply
classifier, and approve (what the user's reply does to the plan and the session log).

Every test drives the real render or approve path on a real plan file, with real git
repos under tmp_path for the delivery probe. The golden card is
fixtures/v3-valid.card.txt: the card the valid v3 fixture must render to, with
`{plan}` standing for the plan's path and the check time masked.

Run from the repo root:
    PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider skills/plan-validator/scripts
"""

import hashlib
import os
import re
import shlex
import stat
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import NamedTuple

import pytest

import card
import validate_plan as vp
from conftest import FIXTURES, git_env, v3_plan

SCRIPT = Path(card.__file__).resolve()
GOLDEN = FIXTURES / "v3-valid.card.txt"
SKILL = SCRIPT.parents[2] / "writing-plans" / "SKILL.md"

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


def _skill_example_cards() -> list[str]:
    """The text of every fenced block in writing-plans/SKILL.md that opens with a card's ask line."""
    blocks, current = [], None
    for line in SKILL.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("```"):
            if current is None:
                current = []
            else:
                blocks.append(current)
                current = None
        elif current is not None:
            current.append(line.strip())
    return ["\n".join(block) + "\n" for block in blocks if block and block[0].startswith("**Approve ")]


def test_skill_example_card_within_budget():
    # The card the skill shows the agent as its model must itself fit the budget it teaches
    cards = _skill_example_cards()
    assert len(cards) == 1, "writing-plans/SKILL.md must show exactly one fenced example card"
    example = cards[0]
    positions = [example.find(label) for label in vp.CARD_LABELS]
    assert -1 not in positions and positions == sorted(positions), "the example carries every card label, in order"
    assert example.splitlines()[-1].startswith(card.FOOTER_PREFIX), "the example ends with the footer render prints"
    words, last_question_end = card.card_word_stats(example)
    assert words <= 120
    assert last_question_end <= 60


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


def test_render_joins_every_human_warning(tmp_path):
    plan = v3_plan(tmp_path, **{_COMMITS_LINE: "", _PR_TITLE_LINE: ""})
    messages = [issue.message for issue in vp.validate_plan(plan).warnings if issue.category == "git"]
    assert messages == [COMMIT_WARNING, PR_WARNING], "the plan must raise two git warnings"

    out, err, code = card.render(plan, write=False)

    assert (err, code) == ("", 0)
    warnings = [line for line in out.splitlines() if line.startswith("**Warnings for you:**")]
    assert warnings == [f"**Warnings for you:** {COMMIT_WARNING} · {PR_WARNING}"], "no human warning may be dropped"
    assert card.card_word_stats(out) == (118, 58), "the Warnings line is outside the word cap however long it is"


def test_warnings_line_rules():
    assert card.warnings_line([]) == ""
    assert card.warnings_line(["Two words."]) == "**Warnings for you:** Two words."
    # Every warning, in order, joined by " · ", however many words that makes
    long_first = " ".join(f"w{n}" for n in range(1, 21))
    assert card.warnings_line([long_first, "second one", "third"]) == f"**Warnings for you:** {long_first} · second one · third"


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


# ---------------------------------------------------------------------------
# Reply classifier: the G1 corpus, the hedge list, the reply grammar
# ---------------------------------------------------------------------------

CORPUS = FIXTURES / "g1-replies.txt"
CORPUS_QUESTIONS = 4  # three questions and Run: the most a card holds
# The dir name holds a HEDGE token (Remove): only stripping the path first lets this plan's own path approve
PLAN_DIR = "2026-10-07_Add-Remove-Button"
PLAN_PATH = f"/work/proj/.ai/sessions/{PLAN_DIR}/PLAN.md"
OTHER_PLAN_PATH = "/work/proj/.ai/sessions/2026-10-08_Other-Plan/PLAN.md"

# The 37 replies from the G1 study, and the labels they must keep (pinned here, not read from the fixture)
G1_IDS = [f"A{n}" for n in range(1, 11)] + [f"S2-{n:02d}" for n in range(1, 28)]
G1_AMBIGUOUS = {"A1", "A3", "A4", "S2-09", "S2-12", "S2-23"}
NEGATIVES = {
    **{cid: "change" for cid in ("C1", "C2", "C3", "C4", "C6", "C10", "N1", "N2", "N3")},
    "C5": "ambiguous",
}

# Literal copies of the GC11 word lists, so deleting a word from card.py fails a test.
# `won't` stands for the `\w+n't` rule.
APPROVAL = ["go ahead", "looks good", "ship it", "approved", "approve", "lgtm", "go", "yes", "implement", "execute", "proceed", "begin", "start", "embark"]
HEDGE = [
    "not", "no", "never", "dont", "don't", "do not", "won't", "wait", "hold", "stop", "pause", "but", "except", "instead",
    "rather", "however", "although", "though", "unless", "until", "yet", "actually", "nope", "nah", "why", "what", "how",
    "change", "revise", "rework", "redo", "fix", "before", "first", "later", "without", "remove", "drop",
]
FILLER = [
    "the", "a", "an", "this", "that", "it", "its", "plan", "plans", "with", "and", "then", "now", "please", "all", "every",
    "default", "defaults", "to", "on", "of", "for", "as", "is", "i", "we", "you", "lets", "let's", "ok", "okay", "sure",
    "thanks", "thank", "great", "implementation", "journey", "ahead", "rest", "everything", "else",
]
# Words that make a numbered answer ambiguous, whatever else the reply says
UNSURE = ["but", "except", "instead", "rather", "however", "unless", "until", "wait", "hold", "not sure", "unsure", "maybe", "skip"]


class _Row(NamedTuple):
    expected: str
    source: str
    reply: str
    note: str


def _corpus() -> list:
    rows = []
    for number, line in enumerate(CORPUS.read_text(encoding="utf-8").splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        columns = line.split("\t")
        assert len(columns) in (3, 4), f"{CORPUS.name} line {number}: want expected, source, reply[, note]"
        rows.append(_Row(*columns, *([""] if len(columns) == 3 else [])))
    return rows


def _classify_row(row: _Row):
    return card.classify_reply(row.reply.replace("{plan}", PLAN_PATH), CORPUS_QUESTIONS, PLAN_PATH)


def test_corpus_has_37_g1_replies():
    rows = _corpus()
    assert len({row.source for row in rows}) == len(rows) == 47, "ids are unique; 37 G1 replies and 10 negatives"
    g1 = {row.source: row.expected for row in rows if row.source in G1_IDS}
    assert sorted(g1) == sorted(G1_IDS)
    assert {source for source, expected in g1.items() if expected != "approve"} == G1_AMBIGUOUS
    assert {expected for source, expected in g1.items() if source in G1_AMBIGUOUS} == {"ambiguous"}
    assert sum(expected == "approve" for expected in g1.values()) == 31
    assert {row.source: row.expected for row in rows if row.source not in G1_IDS} == NEGATIVES


def test_corpus_zero_false_accepts():
    # No reply the user did not mean as a plain yes may approve. The 16 are every row not labelled approve.
    rows = [row for row in _corpus() if row.expected != "approve"]
    assert len(rows) == 16
    offenders = [f"{row.source}: {row.reply[:60]!r}" for row in rows if _classify_row(row).kind == "approve"]
    assert offenders == [], "false accepts"


def test_corpus_matches_expected_labels():
    wrong = []
    for row in _corpus():
        result = _classify_row(row)
        if result.kind != row.expected:
            wrong.append(f"{row.source}: want {row.expected}, got {result.kind} ({result.reason})")
    assert wrong == []


@pytest.mark.parametrize("token", HEDGE)
def test_every_hedge_token_blocks_approval(token):
    # A hedge makes the reply a change request. An unlisted word would only make it ambiguous, so the
    # kind is checked exactly: that is what fails when a token is deleted from card.py
    result = card.classify_reply(f"go, {token}", 3)
    assert result.kind == "change", result
    assert result.answers == {}


@pytest.mark.parametrize("phrase", APPROVAL)
def test_every_approval_phrase_approves(phrase):
    assert card.classify_reply(phrase, 3).kind == "approve"
    assert card.classify_reply(phrase.upper() + ".", 3).kind == "approve"


@pytest.mark.parametrize("word", FILLER)
def test_every_filler_word_is_ignored(word):
    # After a comma, so a filler word that also ends an approval phrase (go ahead) is read on its own
    assert card.classify_reply(f"go, {word}", 3).kind == "approve"


@pytest.mark.parametrize("word", UNSURE)
def test_every_unsure_word_makes_an_answer_ambiguous(word):
    result = card.classify_reply(f"2 {word}, go", 3)
    assert (result.kind, result.answers) == ("ambiguous", {}), result


@pytest.mark.parametrize("token", [token for token in HEDGE if token != "no"])
def test_every_hedge_token_blocks_a_numbered_answer(token):
    # The same words that make "go, <token>" a change make "2 <token>" no clean answer: ambiguous, since the
    # reply is not clearly a change request. Only the bare answer "no" is clean ("2 no, go" is approve).
    result = card.classify_reply(f"2 {token}, go", 3)
    assert (result.kind, result.answers) == ("ambiguous", {}), result
    assert f'"{token}"' in result.reason, result


def _separators() -> list:
    """Every character str.splitlines treats as a line break: the ones that would split a D-line or a Brief line."""
    return [chr(code) for code in range(0x2100) if len(f"a{chr(code)}b".splitlines()) > 1]


@pytest.mark.parametrize("char", list("[]*`|\\") + _separators())
def test_an_answer_the_card_cannot_carry_never_approves(char):
    # T8 splices an answer into "[you: <answer>]" (a D-line) and "**you: <answer>**" (a Brief line)
    for reply in (f"2 a{char}b, go", f"2 a{char}b"):
        result = card.classify_reply(reply, 3)
        assert result.kind != "approve", (reply, result)
        assert result.answers == {}


@pytest.mark.parametrize(
    ("reply", "questions"),
    [
        ("2 no, go", 3),
        ("3 inline", 3),
        ("2 PostgreSQL, go", 3),
        ("2 PostgreSQL with pooled connections and replicas, go", 3),
        ("1. option 3, 2. option 3, 3. ... rest looks good, 4. option 1, 5. yes, 6. option 1", 6),
    ],
)
def test_an_approved_answer_fits_the_card_grammar(reply, questions):
    # The answers of an approval go back into the plan: the card's own regexes must still read what T8 writes
    result = card.classify_reply(reply, questions)
    assert result.kind == "approve" and result.answers, result
    for answer in result.answers.values():
        dline = f"- D1 [you: {answer}] Which database?"
        match = vp._DLINE_RE.match(dline)
        assert match and match.group(2) == f"you: {answer}", dline
        question = f"1. Which database? → **you: {answer}** (Postgres; if wrong: swap it)"
        match = vp._QUESTION_RE.match(question)
        assert match and match.group(3) == f"you: {answer}", question
        assert question.count("**") == 2 and len(question.splitlines()) == 1, question


def _approve(answers=None):
    """The (kind, answers) pair of an approval, to unpack into a test_reply_grammar row."""
    return ("approve", answers or {})


@pytest.mark.parametrize(
    ("reply", "questions", "kind", "answers"),
    [
        # Numbered answers
        pytest.param("2 no, go", 3, *_approve({2: "no"}), id="answer-no"),
        pytest.param("3 inline", 3, *_approve({3: "inline"}), id="answer-alone"),
        pytest.param("2 PostgreSQL, go", 3, *_approve({2: "PostgreSQL"}), id="answer-keeps-case"),
        pytest.param("3 inline.", 3, *_approve({3: "inline"}), id="answer-trailing-period"),
        pytest.param("(2) no; 3: inline; go", 3, *_approve({2: "no", 3: "inline"}), id="leaders-and-semicolons"),
        pytest.param("2) no\n3= inline\ngo", 3, *_approve({2: "no", 3: "inline"}), id="leaders-and-newlines"),
        pytest.param(
            "1. option 3, 2. option 3, 3. ... rest looks good, 4. option 1, 5. yes, 6. option 1",
            6,
            *_approve({1: "option 3", 2: "option 3", 3: "... rest looks good", 4: "option 1", 5: "yes", 6: "option 1"}),
            id="dream-004-shape",
        ),
        pytest.param("2 PostgreSQL with pooled connections and replicas, go", 3, *_approve({2: "PostgreSQL with pooled connections and replicas"}), id="answer-of-6-words"),
        pytest.param("2 PostgreSQL with pooled connections and read replicas, go", 3, "ambiguous", {}, id="answer-of-7-words"),
        pytest.param("go 3 inline", 3, "ambiguous", {}, id="answer-after-go-is-text"),
        pytest.param("4 yes, go", 3, "ambiguous", {}, id="answer-above-count"),
        # A question numbered twice is unclear whichever answer comes last: the earlier one may hold the hedge
        pytest.param("2 stop, 2 yes, go", 3, "ambiguous", {}, id="repeated-number-hides-a-hedge"),
        pytest.param("2 yes, 2 stop, go", 3, "ambiguous", {}, id="repeated-number-hedge-last"),
        pytest.param("2 no, 2 yes", 3, "ambiguous", {}, id="repeated-number-conflicting-answers"),
        pytest.param("2 no, 2 no, go", 3, "ambiguous", {}, id="repeated-number-same-answer"),
        pytest.param("2 yes, 2 no, go, wait", 3, "change", {}, id="repeated-number-then-hedge-is-a-change"),
        pytest.param("0 yes, go", 3, "ambiguous", {}, id="answer-below-one"),
        pytest.param("2 no but only admins, go", 3, "ambiguous", {}, id="answer-with-but"),
        pytest.param("2 maybe, go", 3, "ambiguous", {}, id="answer-maybe"),
        pytest.param("2 not sure, go", 3, "ambiguous", {}, id="answer-not-sure"),
        pytest.param("2 unsure, go", 3, "ambiguous", {}, id="answer-unsure"),
        pytest.param("2 skip, go", 3, "ambiguous", {}, id="answer-skip"),
        # A negation inside an answer holds the plan back just as it does in text ("go, stop" is a change)
        pytest.param("1 stop", 3, "ambiguous", {}, id="answer-stop"),
        pytest.param("3 don't implement yet", 3, "ambiguous", {}, id="answer-dont-implement-yet"),
        pytest.param("2 not yet", 3, "ambiguous", {}, id="answer-not-yet"),
        pytest.param("2 no go", 3, "ambiguous", {}, id="answer-no-go"),
        pytest.param("1 no way", 3, "ambiguous", {}, id="answer-no-way"),
        pytest.param("1 do not proceed", 3, "ambiguous", {}, id="answer-do-not-proceed"),
        pytest.param("2 'stop', go", 3, "ambiguous", {}, id="answer-hedge-in-quotes"),
        pytest.param("2 NO, go", 3, *_approve({2: "NO"}), id="answer-no-any-case"),
        # An answer is spliced into "[you: <answer>]" and "**you: <answer>**", so it cannot carry their syntax
        pytest.param("2 **no**", 3, "ambiguous", {}, id="answer-bold"),
        pytest.param("2 foo] bar, go", 3, "ambiguous", {}, id="answer-closing-bracket"),
        pytest.param("2 [you: x]", 3, "ambiguous", {}, id="answer-you-bracket"),
        pytest.param("2 `x`, go", 3, "ambiguous", {}, id="answer-backticks"),
        # Approval words only
        pytest.param("approved, go ahead and implement", 3, *_approve(), id="approval-phrases"),
        pytest.param("Plan LGTM. Proceed with implementation.", 3, *_approve(), id="approval-sentences"),
        pytest.param("ok", 3, "ambiguous", {}, id="filler-only"),
        pytest.param("", 3, "ambiguous", {}, id="empty"),
        pytest.param("  \n ", 3, "ambiguous", {}, id="blank"),
        pytest.param("go, nothing", 3, "ambiguous", {}, id="hedge-is-a-whole-word"),
        pytest.param("go '", 3, *_approve(), id="lone-apostrophe-is-not-a-word"),
        pytest.param("ship. it", 3, "ambiguous", {}, id="phrase-is-not-joined-across-a-period"),
        # Hedges and questions
        pytest.param("go?", 3, "change", {}, id="question-mark"),
        pytest.param("GO, WAIT", 3, "change", {}, id="hedge-any-case"),
        pytest.param("go, don’t", 3, "change", {}, id="curly-apostrophe"),
        # Plan paths: stripped before the hedge scan
        pytest.param("Implement plan {plan}", 3, *_approve(), id="own-path"),
        pytest.param("Implement plan {plan}.", 3, *_approve(), id="own-path-then-period"),
        pytest.param("Implement plan {plan}, wait", 3, "change", {}, id="own-path-then-hedge"),
        pytest.param("Implement plan {dir}", 3, *_approve(), id="own-dir-name"),
        pytest.param("Implement plan {other}", 3, "ambiguous", {}, id="other-path"),
    ],
)
def test_reply_grammar(reply, questions, kind, answers):
    reply = reply.replace("{plan}", PLAN_PATH).replace("{dir}", PLAN_DIR).replace("{other}", OTHER_PLAN_PATH)
    result = card.classify_reply(reply, questions, PLAN_PATH)
    assert (result.kind, result.answers) == (kind, answers), result
    assert result.reason, "every result says why"


def test_plan_path_is_matched_whatever_the_case():
    shouted = f"IMPLEMENT PLAN {PLAN_PATH.upper()}"
    assert card.classify_reply(shouted, 3, PLAN_PATH).kind == "approve"
    assert card.classify_reply(shouted.lower(), 3, PLAN_PATH).kind == "approve"


def test_tilde_form_of_the_plan_path_is_stripped(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    plan = tmp_path / "work" / PLAN_DIR / "PLAN.md"
    assert card.classify_reply(f"Implement plan ~/work/{PLAN_DIR}/PLAN.md", 3, str(plan)).kind == "approve"
    # A plan outside the home dir has no ~/ form, and its path is not the one named
    assert card.classify_reply(f"Implement plan ~/work/{PLAN_DIR}/PLAN.md", 3, PLAN_PATH).kind == "ambiguous"


def test_plan_md_is_stripped_without_a_plan_path():
    assert card.classify_reply("Implement PLAN.md", 3).kind == "approve"


@pytest.mark.parametrize(
    ("reply", "plan_path"),
    [
        ("yesok", "/work/ok/PLAN.md"),
        ("okyes", "/work/ok/PLAN.md"),
        ("yesplan.md", None),
        ("plan.mdyes", None),
    ],
)
def test_a_name_inside_a_longer_word_is_not_stripped(reply, plan_path):
    # Cutting the dir name or plan.md out of a longer word would leave a bare "yes" to approve
    assert card.classify_reply(reply, 3, plan_path).kind == "ambiguous"


def test_answers_are_returned_only_for_an_approval():
    assert card.classify_reply("2 no, go", 3).answers == {2: "no"}
    for reply in ("2 no, go, wait", "2 maybe, go", "2 no, but go", "2 no, go 3 inline", "2 stop, 2 yes, go"):
        assert card.classify_reply(reply, 3).answers == {}, reply


def test_a_repeated_question_number_says_which_answer_was_given_twice():
    result = card.classify_reply("1 yes, 2 stop, 2 yes, go", 3)
    assert (result.kind, result.answers, result.reason) == ("ambiguous", {}, "answer 2 given twice")


# ---------------------------------------------------------------------------
# approve: the user's reply decides; the log records it; an approval rewrites the plan
# ---------------------------------------------------------------------------

SESSION = (
    "# Session: Wishlist sharing\n"
    "\n"
    "## Goal\n"
    "Let a user share a wishlist by link.\n"
    "\n"
    "## Decisions\n"
    "\n"
    "- **2026-10-06** — Chose hashed tokens.\n"
    "\n"
    "## Status\n"
    "Plan awaiting approval.\n"
)
CONFIRM = f'Not sure that approves "{TITLE}". Reply go to approve as is, or tell me what to change.\n'

# The plan lines an approval can touch, as the fixture writes them
D1_ASK = "- D1 [ask] Share links expire? Default: after 30 days. Why: limits leaked links. If wrong: one config value.\n"
D2_ASK = "- D2 [ask] Link viewers see claimed items? Default: no. Why: protects the surprise invariant. If wrong: one flag.\n"
Q2 = "2. Link viewers see claimed items? → **no** (protects the surprise invariant; if wrong: one flag)\n"
Q3 = "3. Run → **subagent-driven** (5 independent tasks; or inline)\n"
STATUS_AWAITING = "status: awaiting-approval\n"
STATUS_APPROVED = "status: approved\n"

LOGGED_RE = re.compile(r"\*\*(\d{4}-\d{2}-\d{2})\*\* — (?=Approved|Change requested|Reply needing)")


def _you(line: str, answer: str) -> str:
    """line with its [ask] tag or its **bold** default (the bold after the card's arrow) replaced by the user's answer."""
    if "[ask]" in line:
        return line.replace("[ask]", f"[you: {answer}]")
    return re.sub(r"(?<=[→>] )\*\*(.+?)\*\*", lambda m: f"**you: {answer}**", line, count=1)


def _awaiting(tmp_path, **replace) -> Path:
    """A valid v3 plan whose card has been rendered, so its status is awaiting-approval."""
    plan = v3_plan(tmp_path, **replace)
    assert card.render(plan)[2] == 0
    return plan


def _session(tmp_path, text=SESSION) -> Path:
    path = tmp_path / "SESSION.md"
    path.write_text(text, encoding="utf-8")
    return path


def _decide(plan, reply, session):
    """card.approve, with the dates on either side of the call: ((stdout, code), those dates)."""
    before = date.today().isoformat()
    result = card.approve(plan, reply, session)
    return result, {before, date.today().isoformat()}


def _masked(text: str, days: set) -> str:
    """text with the date of each entry approve wrote replaced by DATE, after checking it is today's."""
    found = set(LOGGED_RE.findall(text))
    assert found <= days, f"entry dated {found}, today is {days}"
    return LOGGED_RE.sub("**DATE** — ", text)


def _entry(head: str, plan, *reply_lines: str, suffix: str = "") -> str:
    """The log entry for a reply on the fixture card (sha 37e114a), dated DATE."""
    quoted = "".join(f"  > {line}\n" for line in reply_lines)
    return f"- **DATE** — {head} 37e114a ({plan}){suffix}\n{quoted}"


def _changed(before: bytes, after: bytes) -> list:
    """(was, now) for each line that differs; the files must have the same number of lines."""
    old, new = before.splitlines(keepends=True), after.splitlines(keepends=True)
    assert len(old) == len(new)
    return [(was.decode(), now.decode()) for was, now in zip(old, new) if was != now]


def _plan_card(plan):
    return vp.parse_card(plan.read_text(encoding="utf-8").splitlines())


# --- approve: what an approval writes ---


def test_go_approves_and_resolves_asks_to_defaults(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, "go", session)

    assert (out, code) == (f'approved: "{TITLE}" (card 37e114a); logged to {session}\n', 0)
    # Only the status and the two [ask] lines change: no Brief line, since nothing was answered
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (D1_ASK, _you(D1_ASK, "after 30 days")),
        (D2_ASK, _you(D2_ASK, "no")),
    ]
    entry = _entry("Approved card", plan, "go")
    assert _masked(session.read_text(encoding="utf-8"), days) == SESSION.replace("\n## Status\n", entry + "\n## Status\n")


def test_numbered_answer_rewrites_brief_and_dline(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, "2 no, go", session)

    assert (out, code) == (f'approved: "{TITLE}" (card 37e114a); answers: 2=no; logged to {session}\n', 0)
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (Q2, _you(Q2, "no")),
        (D1_ASK, _you(D1_ASK, "after 30 days")),
        (D2_ASK, _you(D2_ASK, "no")),
    ]
    entry = _entry("Approved card", plan, "2 no, go", suffix="; answers: 2=no")
    assert _masked(session.read_text(encoding="utf-8"), days) == SESSION.replace("\n## Status\n", entry + "\n## Status\n")


def test_run_answer_rewrites_the_run_line(tmp_path):
    plan = _awaiting(tmp_path)
    before = plan.read_bytes()

    (out, code), _ = _decide(plan, "3 Inline", _session(tmp_path))

    assert code == 0, out
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (Q3, _you(Q3, "inline")),
        (D1_ASK, _you(D1_ASK, "after 30 days")),
        (D2_ASK, _you(D2_ASK, "no")),
    ]


@pytest.mark.parametrize(
    ("reply", "written"),
    [
        ("1 after 7 days, 2 yes, 3 subagent, go", {1: "after 7 days", 2: "yes", 3: "subagent-driven"}),
        ("3 Inline", {3: "inline"}),
        ("3 subagent-driven.", {3: "subagent-driven"}),
        ("1 after 7 days; 3 INLINE", {1: "after 7 days", 3: "inline"}),
    ],
)
def test_every_answer_reaches_the_brief_and_the_dlines(tmp_path, reply, written):
    plan = _awaiting(tmp_path)
    (out, code), _ = _decide(plan, reply, _session(tmp_path))

    assert code == 0, out
    assert out.endswith(f"; logged to {tmp_path / 'SESSION.md'}\n")
    assert f"; answers: {', '.join(f'{n}={a}' for n, a in sorted(written.items()))}; " in out
    questions = {q.n: q for q in _plan_card(plan).questions}
    for n, question in questions.items():
        assert (question.answered, question.default) == (n in written, written.get(n, question.default)), n
    dlines = vp.parse_dlines(plan.read_text(encoding="utf-8").splitlines())
    assert [dlines[did].tag for did in ("D1", "D2")] == [f"you: {written.get(n, questions[n].default)}" for n in (1, 2)]
    assert [dlines[did].default for did in ("D1", "D2")] == ["after 30 days", "no"], "the D-line text after the tag is untouched"


def test_approved_plan_still_validates(tmp_path):
    # R1: the answers make the frozen Brief longer than the 120 words render allows, and it must still validate
    plan = _awaiting(tmp_path)
    reply = "1 after sixty full days of inactivity, 2 only for the list owner, 3 inline"
    (out, code), _ = _decide(plan, reply, _session(tmp_path))
    assert code == 0, out

    lines = plan.read_text(encoding="utf-8").splitlines()
    brief = vp.parse_card(lines)
    words = vp._words(vp.ask_line(TITLE)) + vp._words(brief.brief_text) + vp.CHECK_TIME_WORDS
    assert words > 120, "the scenario must push the card over the render-time budget"
    report = vp.validate_plan(plan)
    assert report.errors == [] and report.passed
    assert [q.answered for q in brief.questions] == [True, True, True]
    assert card.render(plan) == (f'"{TITLE}" is approved; no approval needed.\n', "", 0)


@pytest.mark.parametrize(
    ("reply", "category", "message", "lines"),
    [
        # Each answer is a clean numbered answer to the classifier; the plan it would leave breaks one validator rule
        ("1 see step 3, go", "card", "Brief must be plain language: no step numbers.", 1),
        ("1 remote checked, go", "card", "Brief must not contain 'remote checked'", 1),
        ("2 local only, go", "delivery", "The plan says 'local only' but no delivery has mode: local-only", 2),
    ],
)
def test_an_answer_that_leaves_an_invalid_plan_is_refused(tmp_path, reply, category, message, lines):
    # R1: whatever the user answers, the approved plan must still validate. The answers are the user's own words,
    # so a phrase the validator rejects (a step number, "remote checked", "local only") is caught here, before any write
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()
    assert card.classify_reply(reply, 3, plan).kind == "approve", "the classifier alone cannot see the problem"

    out, code = card.approve(plan, reply, session)

    assert code == 1
    header, *found = out.splitlines()
    assert header.startswith("ERROR [answer] ") and "no longer validates" in header and "nothing was written" in header, out
    assert len(found) == lines and all(f"ERROR [{category}] line " in line and message in line for line in found), out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)
    assert sorted(os.listdir(tmp_path)) == ["PLAN.md", "SESSION.md", "repo"], "no temp file is left behind"
    # A plain answer to the same question goes through
    assert card.approve(plan, "1 after 7 days, 2 yes, go", session)[1] == 0
    assert vp.validate_plan(plan).passed



def test_an_answer_that_drops_the_score_below_pass_is_refused(tmp_path):
    # "Still validates" means a pass, not just no errors: here a plan at 71 takes "as needed" twice (Brief and D-line)
    # and loses 4 points to the vague-language cap, with no error anywhere
    fixture = (FIXTURES / "v3-valid-PLAN.md").read_text(encoding="utf-8")

    def section(title):
        start = fixture.index(f"## {title}\n")
        end = fixture.find("\n## ", start)
        return fixture[start : end + 1 if end != -1 else None]

    edits = {section(title): "" for title in ("Estimated PR size", "Risks & assumptions", "Traceability", "Git strategy")}
    edits["will not be built here."] = "will not be built here, probably, somehow, etc."
    plan = _awaiting(tmp_path, **edits)
    before = vp.validate_plan(plan)
    assert (before.score, before.errors) == (71, []), "the scenario no longer sits just above the PASS line"
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    out, code = card.approve(plan, "1 as needed, go", session)

    assert code == 1
    header, score, *new = out.splitlines()
    assert header.startswith("ERROR [answer] ") and "no longer validates" in header, out
    assert score == "ERROR [score] validator score would fall from 71 to 67/100, below 70 (NEEDS WORK)"
    plan_lines = plan.read_text(encoding="utf-8").splitlines()
    answered = [next(n for n, text in enumerate(plan_lines, 1) if text.startswith(start)) for start in ("1. ", "- D1 ")]
    assert [line.split(": ")[0] for line in new] == [f"WARN [vagueness] line {n}" for n in answered], "only the new findings"
    assert all(line.endswith('Vague language: "as needed"') for line in new), out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)
    assert card.approve(plan, "1 after 7 days, go", session)[1] == 0


def test_approve_refuses_when_the_approved_plan_cannot_be_checked(tmp_path, monkeypatch):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    def no_space(*args, **kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(card.tempfile, "TemporaryDirectory", no_space)

    out, code = card.approve(plan, "go", session)

    assert (out, code) == ("ERROR [io] Cannot check the approved plan before writing it: No space left on device\n", 1)
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


@pytest.mark.parametrize(
    ("edits", "reply", "line", "answer"),
    [
        # a `->` inside the line, ahead of the bold, stays as written
        ({"(protects the surprise invariant;": "(protects a -> b invariant;"}, "2 no, go", Q2.replace("the surprise", "a -> b"), "no"),
        # a `->` after the bold stays too
        ({"(5 independent tasks;": "(5 -> independent tasks;"}, "3 inline, go", Q3.replace("5 independent", "5 -> independent"), "inline"),
        # the card's own arrow may be `->`: the validator reads it as the arrow, and approve leaves it
        ({"claimed items? → **no**": "claimed items? -> **no**"}, "2 yes, go", Q2.replace("? →", "? ->"), "yes"),
        ({"3. Run → **subagent-driven**": "3. Run -> **subagent-driven**"}, "3 subagent, go", Q3.replace("Run →", "Run ->"), "subagent-driven"),
    ],
)
def test_an_answer_rewrites_only_the_bold_not_a_nearby_arrow(tmp_path, edits, reply, line, answer):
    # GC4 reads `->` as the arrow, which is a parsing rule: only the bold becomes **you: <answer>**, and every other byte stays
    plan = _awaiting(tmp_path, **edits)
    before = plan.read_bytes()
    assert line.encode() in before, "the scenario's question line is in the plan as written"

    (out, code), _ = _decide(plan, reply, _session(tmp_path))

    assert code == 0, out
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (line, _you(line, answer)),
        (D1_ASK, _you(D1_ASK, "after 30 days")),
        (D2_ASK, _you(D2_ASK, "yes" if reply.startswith("2 yes") else "no")),
    ]
    assert "->" in _you(line, answer), "the scenario keeps its `->`"
    answered = [q for q in _plan_card(plan).questions if q.answered]
    assert [q.default for q in answered] == [answer], "the validator still reads the rewritten line as an answered question"
    assert vp.validate_plan(plan).passed


NEEDS = "**Needs your call:**"
Q1 = "1. Share links expire? → **after 30 days** (limits leaked links; if wrong: one config value)\n"


@pytest.mark.parametrize(
    ("edits", "line"),
    [
        # The validator reads a question that follows the label on its own line, and render accepts the plan,
        # so approve has to find the question there too
        ({f"{NEEDS}\n1.": f"{NEEDS} 1."}, f"{NEEDS} {Q1}"),
        # the validator skips any spaces after the label; so does approve
        ({f"{NEEDS}\n1.": f"{NEEDS}   1."}, f"{NEEDS}   {Q1}"),
        # a `->` is one character shorter in the text the validator matches than on the line, label or not
        ({f"{NEEDS}\n1. Share links expire? →": f"{NEEDS} 1. Share links expire? ->"}, f"{NEEDS} {Q1.replace('? →', '? ->')}"),
    ],
)
def test_an_answer_to_a_question_on_the_label_line_rewrites_only_its_bold(tmp_path, edits, line):
    plan = _awaiting(tmp_path, **edits)
    before = plan.read_bytes()
    assert line.encode() in before, "the scenario's question line is in the plan as written"

    (out, code), _ = _decide(plan, "1 after 7 days, go", _session(tmp_path))

    assert code == 0, out
    # The label's own bold is not the answer: only the bold after the arrow changes
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (line, _you(line, "after 7 days")),
        (D1_ASK, _you(D1_ASK, "after 7 days")),
        (D2_ASK, _you(D2_ASK, "no")),
    ]
    assert _you(line, "after 7 days").startswith(NEEDS), "the scenario keeps its label"
    answered = [(q.n, q.default) for q in _plan_card(plan).questions if q.answered]
    assert answered == [(1, "after 7 days")], "the validator still reads the rewritten line as an answered question"
    assert vp.validate_plan(plan).passed


def test_approve_sha_matches_render_footer(tmp_path):
    plan = v3_plan(tmp_path)
    rendered, _, _ = card.render(plan)
    sha = _footer_sha(rendered)
    (out, code), days = _decide(plan, "2 no, go", _session(tmp_path))

    assert code == 0 and f'(card {sha}); answers: 2=no' in out
    log = _masked((tmp_path / "SESSION.md").read_text(encoding="utf-8"), days)
    assert f"**DATE** — Approved card {sha} ({plan}); answers: 2=no\n" in log
    # The sha is of the Brief as rendered: the answer then changed the Brief, so the approved Brief hashes differently
    assert card.brief_sha7(_plan_card(plan).brief_text) != sha


def test_approve_logs_absolute_paths_for_relative_arguments(tmp_path, monkeypatch):
    # The skill prose may pass PLAN.md and SESSION.md as relative paths: the log entry and stdout must still name absolute ones
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    monkeypatch.chdir(tmp_path)

    (out, code), days = _decide("PLAN.md", "go", "SESSION.md")

    assert code == 0, out
    assert out == f'approved: "{TITLE}" (card 37e114a); logged to {session}\n'
    assert out.endswith(f"; logged to {tmp_path / 'SESSION.md'}\n")
    entry = _entry("Approved card", plan, "go")
    assert _masked(session.read_text(encoding="utf-8"), days) == SESSION.replace("\n## Status\n", entry + "\n## Status\n")
    assert f"Approved card 37e114a ({tmp_path / 'PLAN.md'})\n" in session.read_text(encoding="utf-8")


def test_approve_cli_logs_absolute_paths_for_relative_arguments(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)

    result = _run_cli("approve", "PLAN.md", "--reply", "go", "--session-md", "SESSION.md", cwd=tmp_path)

    assert (result.returncode, result.stderr) == (0, "")
    assert result.stdout == f'approved: "{TITLE}" (card 37e114a); logged to {tmp_path / "SESSION.md"}\n'
    assert f"Approved card 37e114a ({tmp_path / 'PLAN.md'})\n  > go\n" in session.read_text(encoding="utf-8")
    assert "status: approved\n" in plan.read_text(encoding="utf-8")


def test_approve_preserves_crlf_line_endings(tmp_path):
    plan = _awaiting(tmp_path)
    plan.write_bytes(plan.read_bytes().replace(b"\n", b"\r\n"))
    before = plan.read_bytes()

    (out, code), _ = _decide(plan, "2 no, go", _session(tmp_path))

    assert code == 0, out
    after = plan.read_bytes()
    assert all(line.endswith(b"\r\n") for line in after.splitlines(keepends=True)), "no line lost its CRLF"
    assert _changed(before, after) == [
        (STATUS_AWAITING.replace("\n", "\r\n"), STATUS_APPROVED.replace("\n", "\r\n")),
        (Q2.replace("\n", "\r\n"), _you(Q2, "no").replace("\n", "\r\n")),
        (D1_ASK.replace("\n", "\r\n"), _you(D1_ASK, "after 30 days").replace("\n", "\r\n")),
        (D2_ASK.replace("\n", "\r\n"), _you(D2_ASK, "no").replace("\n", "\r\n")),
    ]
    assert vp.validate_plan(plan).passed


def test_reapproval_replaces_an_earlier_answer(tmp_path):
    # A Brief edit sends an approved plan back to the card; the new answer must replace the old one everywhere
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    assert card.approve(plan, "2 yes, go", session)[1] == 0
    plan.write_text(plan.read_text(encoding="utf-8").replace(STATUS_APPROVED, STATUS_AWAITING), encoding="utf-8")
    before = plan.read_bytes()

    out, code = card.approve(plan, "2 no, go", session)

    assert code == 0, out
    assert _changed(before, plan.read_bytes()) == [
        (STATUS_AWAITING, STATUS_APPROVED),
        (_you(Q2, "yes"), _you(Q2, "no")),
        (_you(D2_ASK, "yes"), _you(D2_ASK, "no")),
    ]


def test_a_default_a_you_tag_cannot_hold_is_refused(tmp_path):
    # "[you: after [30] days]" does not parse as a D-line, so the approved plan would stop validating
    plan = _awaiting(tmp_path, **{"Default: after 30 days.": "Default: after [30] days.", "**after 30 days**": "**after [30] days**"})
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()
    assert vp.validate_plan(plan).passed

    out, code = card.approve(plan, "go", session)

    assert code == 1
    assert out.startswith("ERROR [card] line ") and "D1" in out and "after [30] days" in out and "Answer question 1" in out, out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)
    # Answering the question by number sidesteps the default
    assert card.approve(plan, "1 after 7 days, go", session)[1] == 0
    assert vp.validate_plan(plan).passed


# --- approve: the log ---


def test_log_is_verbatim_multiline(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    reply = 'go, "ok"\n  thanks  '

    (_, code), _ = _decide(plan, reply, session)

    assert code == 0
    assert b'  > go, "ok"\n  >   thanks  \n' in session.read_bytes(), "quotes, the newline and both lines' spaces are as typed"


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="needs time.tzset")
@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Pacific/Pago_Pago"])
def test_log_date_is_local_date(tmp_path, local_tz, zone):
    # The two zones are 25 hours apart, so UTC cannot match both: a UTC date fails in at least one of them, at any hour
    local_tz(zone)
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)

    (out, code), days = _decide(plan, "go", session)

    assert code == 0, out
    logged = set(LOGGED_RE.findall(session.read_text(encoding="utf-8")))
    assert logged, "the approval is logged with a date"
    assert logged <= days, f"entry dated {logged}; the local date in {zone} is {days}"


def test_reply_via_quoted_heredoc_is_verbatim(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    reply = "go \"ok\" it's $(x)\nthen `date` \\ $HOME"
    command = (
        f"{shlex.quote(sys.executable)} {shlex.quote(str(SCRIPT))} approve {shlex.quote(str(plan))} "
        f"--reply-file - --session-md {shlex.quote(str(session))} <<'END_OF_REPLY'\n{reply}\nEND_OF_REPLY\n"
    )
    before = plan.read_bytes()

    result = subprocess.run(["bash", "-c", command], capture_output=True, env={**git_env(), "PYTHONDONTWRITEBYTECODE": "1"}, check=False)

    # "it's" and "x" are words the classifier does not know, so this is the confirm path: the reply is still logged whole
    assert (result.returncode, result.stdout.decode(), result.stderr) == (3, CONFIRM, b"")
    logged = session.read_bytes().decode("utf-8")
    assert f"Reply needing confirmation on card 37e114a ({plan})\n  > go \"ok\" it's $(x)\n  > then `date` \\ $HOME\n" in logged
    assert logged.count("  > ") == 2, "the heredoc's own final newline is not a third reply line"
    assert plan.read_bytes() == before


def test_reply_file_drops_one_trailing_newline(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    reply_file = tmp_path / "reply.txt"
    reply_file.write_bytes(b"go\n\n")

    result = _run_cli("approve", plan, "--reply-file", reply_file, "--session-md", session)

    assert (result.returncode, result.stderr) == (0, "")
    assert "  > go\n  > \n\n## Status\n" in session.read_text(encoding="utf-8"), "one newline dropped, the second kept"


@pytest.mark.parametrize(
    ("session_text", "expected"),
    [
        pytest.param(
            "# S\n\n## Goal\nx\n\n## Status\ndone\n",
            "# S\n\n## Goal\nx\n\n## Decisions\n\n{entry}\n## Status\ndone\n",
            id="before-status",
        ),
        pytest.param("# S\n\n## Goal\nx\n", "# S\n\n## Goal\nx\n\n## Decisions\n\n{entry}", id="at-eof"),
        pytest.param("# S\n\n## Goal\nx", "# S\n\n## Goal\nx\n\n## Decisions\n\n{entry}", id="at-eof-without-final-newline"),
        pytest.param("", "## Decisions\n\n{entry}", id="empty-file"),
        pytest.param("# S\n\n## Decisions\n", "# S\n\n## Decisions\n\n{entry}", id="empty-section-at-eof"),
        pytest.param(
            "# S\n\n## Decisions\n- **2026-10-06** — Old.\n## Status\ndone\n",
            "# S\n\n## Decisions\n- **2026-10-06** — Old.\n{entry}## Status\ndone\n",
            id="appended-after-last-entry",
        ),
        pytest.param(
            "# S\n\n```\n## Decisions\n```\n\n## Status\ndone\n",
            "# S\n\n```\n## Decisions\n```\n\n## Decisions\n\n{entry}\n## Status\ndone\n",
            id="heading-in-a-code-fence-is-not-the-section",
        ),
    ],
)
def test_decisions_section_created_before_status(tmp_path, session_text, expected):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path, session_text)

    (out, code), days = _decide(plan, "go", session)

    assert code == 0, out
    assert _masked(session.read_text(encoding="utf-8"), days) == expected.format(entry=_entry("Approved card", plan, "go"))


# --- approve: a reply that does not approve ---


def test_change_logs_and_plan_unchanged(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, "change the expiry to 7 days", session)

    assert (out, code) == (f"change request: not approved; logged to {session}\n", 2)
    assert plan.read_bytes() == before
    entry = _entry("Change requested on card", plan, "change the expiry to 7 days")
    assert _masked(session.read_text(encoding="utf-8"), days) == SESSION.replace("\n## Status\n", entry + "\n## Status\n")


def test_ambiguous_logs_and_plan_unchanged(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, "ok", session)

    assert (out, code) == (CONFIRM, 3)
    assert plan.read_bytes() == before
    entry = _entry("Reply needing confirmation on card", plan, "ok")
    assert _masked(session.read_text(encoding="utf-8"), days) == SESSION.replace("\n## Status\n", entry + "\n## Status\n")


@pytest.mark.parametrize("reply", ["3 option 1", "3 yes, go", "3 sub-agent, go"])
def test_bad_run_answer_is_ambiguous(tmp_path, reply):
    # Item 3 is Run, which takes subagent-driven, subagent or inline; an approving reply with another answer is unclear
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, reply, session)

    assert (out, code) == (CONFIRM, 3)
    assert plan.read_bytes() == before
    assert f"Reply needing confirmation on card 37e114a ({plan})\n  > {reply}\n" in _masked(session.read_text(encoding="utf-8"), days)


@pytest.mark.parametrize("reply", ["2 stop, 2 no, go", "2 no, 2 yes"])
def test_a_repeated_question_number_never_approves(tmp_path, reply):
    # The earlier answer ("stop") must not be overwritten by the later one before it is checked
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), days = _decide(plan, reply, session)

    assert (out, code) == (CONFIRM, 3)
    assert plan.read_bytes() == before and b"status: awaiting-approval\n" in before
    assert f"Reply needing confirmation on card 37e114a ({plan})\n  > {reply}\n" in _masked(session.read_text(encoding="utf-8"), days)


def test_a_reply_naming_the_plan_approves(tmp_path):
    # The plan's own path is taken out of the reply first: this directory's name holds the hedge word "Remove"
    plan = _awaiting(tmp_path / PLAN_DIR)
    session = _session(tmp_path / PLAN_DIR)

    (out, code), _ = _decide(plan, f"Implement plan {plan}", session)

    assert (out, code) == (f'approved: "{TITLE}" (card 37e114a); logged to {session}\n', 0)
    assert _plan_card(plan).questions[0].answered is False and b"status: approved\n" in plan.read_bytes()


def test_an_answer_for_a_number_the_card_lacks_is_ambiguous(tmp_path):
    # Questions numbered 1, 2 and 4: the reply grammar takes "3 no" as an answer, but no question 3 can receive it
    plan = _awaiting(tmp_path, **{"3. Run →": "4. Run →"})
    session = _session(tmp_path)
    before = plan.read_bytes()

    (out, code), _ = _decide(plan, "3 no, go", session)

    assert (out, code) == (CONFIRM, 3)
    assert plan.read_bytes() == before


# --- approve: refusals ---


def test_refuses_draft(tmp_path):
    plan = v3_plan(tmp_path)
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    out, code = card.approve(plan, "go", session)

    assert code == 1
    assert out.startswith("ERROR [status] ") and "render the card first" in out and out.endswith("\n"), out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


@pytest.mark.parametrize("status", ["approved", "in-progress", "complete"])
def test_refuses_a_plan_past_the_card(tmp_path, status):
    plan = v3_plan(tmp_path, **{"status: draft": f"status: {status}"})
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    out, code = card.approve(plan, "go", session)

    assert code == 1
    assert out == f"ERROR [status] plan is {status}, not awaiting-approval; there is nothing to approve\n"
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


def test_refuses_invalid_plan(tmp_path):
    plan = v3_plan(tmp_path, **{"**Flags:** none\n": "", "status: draft": "status: awaiting-approval"})
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()
    brief_line = plan.read_text(encoding="utf-8").splitlines().index("## Brief") + 1

    out, code = card.approve(plan, "go", session)

    assert code == 1
    assert f"ERROR [card] line {brief_line}: Brief is missing the label **Flags:**\n" in out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


def test_refuses_legacy_plan(tmp_path):
    plan = v3_plan(tmp_path, **{"schema: plan/v3": "schema: plan/v2", "status: draft": "status: awaiting-approval"})
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    out, code = card.approve(plan, "go", session)

    assert (out, code) == ("card.py approve needs schema: plan/v3 (this plan: plan/v2); present legacy plans as before\n", 1)
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


def test_refuses_a_remote_that_has_gone_since_the_card(tmp_path):
    # approve re-probes the delivery repos like render does: a plan whose remote is gone is no longer valid
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    subprocess.run(["git", "-C", str(tmp_path / "repo"), "remote", "remove", "origin"], check=True, capture_output=True, env=git_env())
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    out, code = card.approve(plan, "go", session)

    assert code == 1 and "ERROR [delivery]" in out and "no remote named 'origin'" in out, out
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


def test_nonexistent_session_md_exits_1_plan_unchanged(tmp_path):
    plan = _awaiting(tmp_path)
    missing = tmp_path / "nope" / "SESSION.md"
    before = plan.read_bytes()

    result = _run_cli("approve", plan, "--reply", "go", "--session-md", missing)

    assert (result.returncode, result.stdout) == (1, "")
    assert result.stderr == f"ERROR [io] SESSION.md not found: {missing}; pass the session's SESSION.md with --session-md\n"
    assert plan.read_bytes() == before
    assert not missing.parent.exists(), "approve does not create the session file or its directory"


def test_refusal_prints_to_stderr_and_a_decision_to_stdout(tmp_path):
    drafted = v3_plan(tmp_path / "a")
    refused = _run_cli("approve", drafted, "--reply", "go", "--session-md", _session(tmp_path / "a"))
    assert (refused.returncode, refused.stdout) == (1, "")
    assert "render the card first" in refused.stderr

    plan = _awaiting(tmp_path / "b")
    approved = _run_cli("approve", plan, "--reply", "go", "--session-md", _session(tmp_path / "b"))
    assert (approved.returncode, approved.stderr) == (0, "")
    assert approved.stdout.startswith(f'approved: "{TITLE}" (card 37e114a); logged to ')


# --- approve: writes happen log first, plan second, each whole or not at all ---


def test_log_is_written_before_the_plan(tmp_path, monkeypatch):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    written = []
    real = card.write_atomic

    def spy(path, text):
        written.append(Path(path))
        real(path, text)

    monkeypatch.setattr(card, "write_atomic", spy)

    assert card.approve(plan, "go", session)[1] == 0
    assert written == [session, plan]
    assert sorted(os.listdir(tmp_path)) == ["PLAN.md", "SESSION.md", "repo"], "no temp file is left behind"


def test_plan_write_failure_leaves_the_plan_awaiting_and_the_log_written(tmp_path, monkeypatch):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = plan.read_bytes()
    real = card.write_atomic

    def fail_for_the_plan(path, text):
        if Path(path) == plan:
            raise OSError(28, "No space left on device")
        real(path, text)

    monkeypatch.setattr(card, "write_atomic", fail_for_the_plan)

    out, code = card.approve(plan, "go", session)

    assert code == 1
    assert out == (
        f"ERROR [io] Cannot write {plan}: No space left on device; the approval is logged in {session}, "
        "but the plan is still awaiting-approval\n"
    )
    assert plan.read_bytes() == before
    assert f"Approved card 37e114a ({plan})" in session.read_text(encoding="utf-8")


def test_session_write_failure_writes_nothing(tmp_path, monkeypatch):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    plan_before, session_before = plan.read_bytes(), session.read_bytes()

    def fail(path, text):
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(card, "write_atomic", fail)

    out, code = card.approve(plan, "go", session)

    assert (out, code) == (f"ERROR [io] Cannot write {session}: Permission denied\n", 1)
    assert (plan.read_bytes(), session.read_bytes()) == (plan_before, session_before)


# --- approve: the command line ---


def test_missing_session_md_arg_exits_64(tmp_path):
    plan = _awaiting(tmp_path)
    result = _run_cli("approve", plan, "--reply", "go")
    assert (result.returncode, result.stdout) == (64, "")
    assert "usage:" in result.stderr and "--session-md" in result.stderr


@pytest.mark.parametrize(
    "reply_args",
    [["--reply", "go", "--reply-file", "reply.txt"], []],
    ids=["both", "neither"],
)
def test_reply_and_reply_file_together_exit_64(tmp_path, reply_args):
    # Both or neither reply option is a usage error, and nothing is read or written
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    (tmp_path / "reply.txt").write_text("go\n", encoding="utf-8")
    before = (plan.read_bytes(), session.read_bytes())

    result = _run_cli("approve", plan, *reply_args, "--session-md", session, cwd=tmp_path)

    assert (result.returncode, result.stdout) == (64, "")
    assert "usage:" in result.stderr and "--reply" in result.stderr
    assert (plan.read_bytes(), session.read_bytes()) == before


def test_unreadable_reply_file_exits_64(tmp_path):
    plan = _awaiting(tmp_path)
    session = _session(tmp_path)
    before = (plan.read_bytes(), session.read_bytes())

    result = _run_cli("approve", plan, "--reply-file", tmp_path / "nope.txt", "--session-md", session)

    assert (result.returncode, result.stdout) == (64, "")
    assert "cannot read the reply" in result.stderr
    assert (plan.read_bytes(), session.read_bytes()) == before


def test_cli_exit_codes(tmp_path):
    codes = {}
    for reply, name in [("go", "approve"), ("wait", "change"), ("ok", "ambiguous")]:
        plan = _awaiting(tmp_path / name)
        result = _run_cli("approve", plan, "--reply", reply, "--session-md", _session(tmp_path / name))
        codes[name] = (result.returncode, result.stderr)
    assert codes == {"approve": (0, ""), "change": (2, ""), "ambiguous": (3, "")}


def test_cli_repeated_question_number_exits_3_and_leaves_the_plan_awaiting(tmp_path):
    plan = _awaiting(tmp_path)
    before = plan.read_bytes()

    result = _run_cli("approve", plan, "--reply", "2 stop, 2 no, go", "--session-md", _session(tmp_path))

    assert (result.returncode, result.stderr) == (3, "")
    assert result.stdout == CONFIRM
    assert plan.read_bytes() == before and b"status: awaiting-approval\n" in before
