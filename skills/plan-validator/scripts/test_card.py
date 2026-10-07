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
from typing import NamedTuple

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
    for reply in ("2 no, go, wait", "2 maybe, go", "2 no, but go", "2 no, go 3 inline"):
        assert card.classify_reply(reply, 3).answers == {}, reply
