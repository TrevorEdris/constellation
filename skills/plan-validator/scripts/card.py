#!/usr/bin/env python3
"""
card.py - the approval card for a plan/v3 PLAN.md.

A v3 plan opens with a Brief written as the card the user approves. `render`
validates the plan, prints that card, and moves a draft plan to
awaiting-approval. `approve` reads the user's reply to the card and records
what it decides.

Usage:
    python3 card.py render <PLAN>
    python3 card.py render <PLAN> --no-write
    python3 card.py approve <PLAN> (--reply <text> | --reply-file <path|->) --session-md <SESSION.md>

The card is the Brief, verbatim, between an ask line and a footer:

    **Approve "<title>"?** Reply go to take every default, or answer by number.
    <the Brief's lines; the Ships-as line ends " (remote checked MM-DD HH:MM)">
    **Warnings for you:** <human warnings>        (only when there are some)
    Plan: <absolute PLAN path> · validator <score> PASS · card <sha7>

The check time is when `render` re-probed the delivery repos with git. It is
printed, never stored. sha7 is brief_sha7 of the Brief.

classify_reply reads the user's chat reply to that card and decides whether it
approves the plan, asks for a change, or is too unclear to act on. `approve`
logs the reply, verbatim, under `## Decisions` in SESSION.md, and acts on it:

    approve    every [ask] D-line and answered Brief bold takes the user's answer
               (or the card's default), and the status becomes approved
    change     nothing else is written
    ambiguous  nothing else is written; the caller asks the user to confirm

Exit codes:
    0  - render: the card was printed (or the plan needs no approval); approve: the plan is approved
    1  - the plan is invalid, legacy or not ready for approval, or a file cannot be read or written:
         the reasons are on stderr
    2  - approve: the reply asks for a change; the plan is untouched
    3  - approve: the reply is unclear; the plan is untouched and the user is asked to confirm
    64 - usage error
"""

import argparse
import hashlib
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Callable, NamedTuple, Optional

from validate_plan import (
    CARD_PAST_APPROVAL_STATUSES,
    SHIPS_LABEL,
    Card,
    DLine,
    Frontmatter,
    Issue,
    Question,
    ValidationReport,
    _ANSWER_PREFIX,  # the one definition of "an answered question"
    _ASK_BODY_RE,  # the one definition of an [ask] D-line's body
    _NUMBERED_RE,  # the one definition of "a numbered question line"
    _QUESTION_RE,
    _RUN_RE,
    _fence_mask,
    _find_section,
    _words,  # the one definition of "a word"
    ask_line,
    is_v3,
    parse_card,
    parse_dlines,
    parse_frontmatter,
    plan_title,
    validate_plan,
)

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_CHANGE = 2
EXIT_AMBIGUOUS = 3
EXIT_USAGE = 64

WARNINGS_LABEL = "**Warnings for you:**"
FOOTER_PREFIX = "Plan: "
SET_STATUS = "awaiting-approval"
APPROVED_STATUS = "approved"


# ---------------------------------------------------------------------------
# The card
# ---------------------------------------------------------------------------


def brief_sha7(brief_text: str) -> str:
    """The first 7 hex digits of sha256 of the Brief body.

    brief_text is Card.brief_text: the Brief's card lines (non-blank, not
    starting `>`, up to the `---` rule or the next `##`), joined by newlines.
    Blank lines and the status line are not in it, so neither moves the sha.
    """
    return hashlib.sha256(brief_text.encode("utf-8")).hexdigest()[:7]


def warnings_line(messages: list[str]) -> str:
    """The card's Warnings line for the human warnings, or "" when there are none.

    Every warning is shown, in order, joined by " · ". The line is outside the
    120-word budget and is never cut: a warning the user cannot see is one they
    cannot act on, and the agent only posts this card.
    """
    if not messages:
        return ""
    return f"{WARNINGS_LABEL} {' · '.join(messages)}"


def card_word_stats(card_text: str) -> tuple[int, int]:
    """(words on the card, word at which its last numbered line ends).

    Counts every line of a rendered card except the `Plan:` footer and the
    Warnings line, which sit outside the 120-word budget. The check time on the
    Ships-as line counts, as it is printed.
    """
    words = last_numbered_end = 0
    for line in card_text.splitlines():
        if line.startswith(FOOTER_PREFIX) or line.startswith(WARNINGS_LABEL):
            continue
        words += _words(line)
        if _NUMBERED_RE.match(line):
            last_numbered_end = words
    return words, last_numbered_end


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def write_atomic(path: str, text: str) -> None:
    """Replace the file at path with text, all at once: write a temp file beside it, then os.replace.

    The text is written as given (no newline translation) and the file keeps its
    permissions. A symlink is followed, so the link stays a link.
    """
    target = os.path.realpath(path)
    fd, temp = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".card-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        shutil.copymode(target, temp)
        os.replace(temp, target)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _with_status(raw: str, status: str) -> str:
    """raw with its frontmatter `status:` line set to status; every other byte is unchanged."""
    lines = raw.splitlines(keepends=True)
    end = parse_frontmatter(raw).end_line  # 1-indexed closing `---`
    # The last `status:` is the one the parser keeps
    idx = next(n for n in reversed(range(1, end - 1)) if lines[n].startswith("status:"))
    lines[idx] = f"status: {status}" + lines[idx][len(lines[idx].rstrip("\r\n")) :]
    return "".join(lines)


# ---------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------


def _finding(prefix: str, issue: Issue) -> str:
    where = f" line {issue.line}:" if issue.line else ""
    return f"{prefix} [{issue.category}]{where} {issue.message}\n"


def _with_check_time(brief_lines: list[str], checked: str) -> list[str]:
    """The Brief's lines with " (remote checked <checked>)" added to the Ships-as line."""
    stamped = list(brief_lines)
    idx = next(n for n, line in enumerate(stamped) if line.startswith(SHIPS_LABEL))
    stamped[idx] += f" (remote checked {checked})"
    return stamped


class _Plan(NamedTuple):
    """A plan/v3 file that validated and passed: its report, its text as read (no newline translation) and its frontmatter."""

    report: ValidationReport
    raw: str
    fm: Frontmatter


def _read_text(path: str) -> str:
    """The text of the file at path, with every line ending as it is on disk."""
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def _load_plan(plan: str, command: str) -> tuple[Optional[_Plan], str]:
    """Validate the plan at the absolute path plan for `card.py <command>`: (the plan, "") or (None, why not).

    The delivery repos are probed live, so a remote that has gone since the plan was written is caught.
    A file that cannot be read, a plan that is not schema plan/v3, one with validator errors and one
    whose score is below the PASS line are all refused; the reason is whole lines for stderr.
    """
    report = validate_plan(Path(plan))
    unreadable = [issue for issue in report.errors if issue.category == "io"]
    if unreadable:
        return None, "".join(_finding("ERROR", issue) for issue in unreadable)

    try:
        raw = _read_text(plan)
    except (OSError, UnicodeDecodeError) as exc:  # the file changed since the validator read it
        return None, f"ERROR [io] Cannot read file: {exc}\n"
    fm = parse_frontmatter(raw)
    if not is_v3(fm):
        schema = fm.data.get("schema")
        shown = schema if isinstance(schema, str) and schema else "none"
        return None, f"card.py {command} needs schema: plan/v3 (this plan: {shown}); present legacy plans as before\n"

    if report.errors:
        return None, "".join(_finding("ERROR", issue) for issue in report.errors)
    if not report.passed:
        # No errors, so the score is under 70. The footer says PASS, so no card.
        refusal = (
            f"ERROR [score] validator score {report.score}/100 is below 70 (NEEDS WORK), "
            "so the plan cannot be presented. Fix these warnings, then render again.\n"
        )
        return None, refusal + "".join(_finding("WARN", issue) for issue in report.warnings)
    return _Plan(report, raw, fm), ""


def render(path, write: bool = True) -> tuple[str, str, int]:
    """Validate a plan/v3 PLAN.md and render its approval card: (stdout, stderr, exit code).

    The plan is validated first, with the delivery repos probed live, so a remote
    that has gone since the plan was written is caught here. Then, by status:

    - draft: the card is printed and `status:` becomes awaiting-approval (the one
      line that changes, written atomically). write=False prints without writing.
    - awaiting-approval: the card is printed; nothing is written.
    - approved, in-progress, complete: a one-line notice; nothing is written.

    A legacy plan (any schema but plan/v3), a plan with validator errors and a plan
    whose score is below the PASS line are refused with exit 1 and nothing written.
    stdout and stderr hold whole lines, each ending in a newline.
    """
    plan = os.path.abspath(path)
    loaded, refusal = _load_plan(plan, "render")
    if loaded is None:
        return "", refusal, EXIT_REFUSED
    report, raw, fm = loaded

    lines = raw.splitlines()
    status = fm.data["status"]  # a valid token: the validator errors on any other
    title = plan_title(lines)
    if status in CARD_PAST_APPROVAL_STATUSES:
        return f'"{title}" is {status}; no approval needed.\n', "", EXIT_OK

    brief = parse_card(lines).brief_text
    checked = datetime.now().strftime("%m-%d %H:%M")
    out = [ask_line(title), *_with_check_time(brief.split("\n"), checked)]
    warnings = warnings_line([issue.message for issue in report.warnings if issue.audience == "human"])
    if warnings:
        out.append(warnings)
    out.append(f"{FOOTER_PREFIX}{plan} · validator {report.score} PASS · card {brief_sha7(brief)}")

    if status == "draft" and write:
        try:
            write_atomic(plan, _with_status(raw, SET_STATUS))
        except OSError as exc:
            return "", f"ERROR [io] Cannot write {plan}: {exc.strerror or exc}\n", EXIT_REFUSED
    return "\n".join(out) + "\n", "", EXIT_OK


# ---------------------------------------------------------------------------
# The reply classifier
# ---------------------------------------------------------------------------

APPROVE = "approve"
CHANGE = "change"
AMBIGUOUS = "ambiguous"

# The classifier only approves a reply made of approval phrases, filler and numbered answers, so a
# word on none of these lists (a new instruction, a name, a qualifier) makes the reply ambiguous.
# Every match is on whole tokens of the lowercased reply, with the curly apostrophe made straight.

# A reply must hold one of these (or a numbered answer) to approve. Multi-word phrases come first.
APPROVAL = (
    "go ahead", "looks good", "ship it", "approved", "approve", "lgtm", "go", "yes",
    "implement", "execute", "proceed", "begin", "start", "embark",
)

# Any of these in the text of a reply means the user is holding back or changing something: a change request.
# "do not" is already caught by "not"; it is listed so this list reads as the GC11 list.
HEDGE_WORDS = frozenset((
    "not", "no", "never", "dont", "don't", "wait", "hold", "stop", "pause", "but", "except", "instead", "rather",
    "however", "although", "though", "unless", "until", "yet", "actually", "nope", "nah", "why", "what", "how",
    "change", "revise", "rework", "redo", "fix", "before", "first", "later", "without", "remove", "drop",
))
HEDGE_PHRASES = ("do not",)
_CONTRACTION_RE = re.compile(r"\w+n't")  # won't, shouldn't, isn't: any negated contraction is a hedge

# Words that may sit beside an approval without changing what it means.
FILLER = frozenset((
    "the", "a", "an", "this", "that", "it", "its", "plan", "plans", "with", "and", "then", "now", "please", "all",
    "every", "default", "defaults", "to", "on", "of", "for", "as", "is", "i", "we", "you", "lets", "let's", "ok",
    "okay", "sure", "thanks", "thank", "great", "implementation", "journey", "ahead", "rest", "everything", "else",
))

# A numbered answer holding one of these, or running past MAX_ANSWER_WORDS, is not a clean answer.
UNSURE_WORDS = frozenset((
    "but", "except", "instead", "rather", "however", "unless", "until", "wait", "hold", "unsure", "maybe", "skip",
))
UNSURE_PHRASES = ("not sure",)
MAX_ANSWER_WORDS = 6

# An answer goes back into the plan as "[you: <answer>]" (a D-line) and "**you: <answer>**" (the Brief),
# so it cannot hold the characters that close or reopen those spans, a code span, a table cell or an escape.
# A line break (any character str.splitlines splits at) would cut the D-line or Brief line in two.
ANSWER_UNSAFE_CHARS = frozenset("[]*`|\\")
# The one hedge word a clean answer may be: "2 no" answers a yes/no question. "2 no go" and "2 no way" are not.
CLEAN_NEGATIVE = "no"

_TOKEN_RE = re.compile(r"[\w']+")
_CHUNK_SPLIT_RE = re.compile(r"[,;\n]")
_SENTENCE_END_RE = re.compile(r"\.(?=\s|$)")
# "2 no", "2. no", "(2) no", "2: no", "2= no": a question number, then its answer
_ANSWER_RE = re.compile(r"^\(?(\d{1,2})[.):=]?\s+(\S.*?)\.?$")


class Classification(NamedTuple):
    """What a reply means. kind is approve, change or ambiguous; reason says why, for logs and test failures.

    answers maps a question number to the user's answer, in the reply's own case. It is empty
    unless kind is approve: a reply that is not an approval gives nothing to apply. An answer in it
    is safe to write into a D-line ("[you: <answer>]") and a Brief line ("**you: <answer>**").
    """

    kind: str
    answers: dict[int, str]
    reason: str


def _tokens(text: str) -> list[str]:
    """The lowercased words of text: runs of word characters and apostrophes, with ’ made '.

    A run of apostrophes alone is not a word and is dropped.
    """
    return [tok for tok in _TOKEN_RE.findall(text.lower().replace("’", "'")) if tok.strip("'")]


def _phrase_at(tokens: list[str], start: int, phrase: str) -> bool:
    """Whether the words of phrase are the tokens that begin at start."""
    words = phrase.split()
    return tokens[start : start + len(words)] == words


def _first_hedge(tokens: list[str]) -> Optional[str]:
    """The first hedge token or phrase in tokens, or None."""
    for n, tok in enumerate(tokens):
        if tok in HEDGE_WORDS or _CONTRACTION_RE.fullmatch(tok):
            return tok
        for phrase in HEDGE_PHRASES:
            if _phrase_at(tokens, n, phrase):
                return phrase
    return None


def _first_unsure(tokens: list[str]) -> Optional[str]:
    """The first uncertainty word or phrase in tokens, or None."""
    for n, tok in enumerate(tokens):
        if tok in UNSURE_WORDS:
            return tok
        for phrase in UNSURE_PHRASES:
            if _phrase_at(tokens, n, phrase):
                return phrase
    return None


def _answer_problem(answer: str) -> Optional[str]:
    """Why answer is not a clean numbered answer (a phrase to follow "answer N"), or None when it is clean.

    A clean answer is short, free of uncertainty and hedge words (except the bare answer "no") and safe
    to write into a D-line and a Brief line. Quotes around a word do not hide it: 'stop' is "stop".
    """
    tokens = _tokens(answer)
    if len(tokens) > MAX_ANSWER_WORDS:
        return f"is longer than {MAX_ANSWER_WORDS} words"
    unsafe = next((repr(ch) for ch in answer if ch in ANSWER_UNSAFE_CHARS), None)
    if unsafe is None and len(answer.splitlines()) > 1:
        unsafe = "a line break"
    if unsafe is not None:
        return f"holds {unsafe}, which the card cannot carry"
    unsure = _first_unsure(tokens)
    if unsure:
        return f'says "{unsure}"'
    bare = [tok.strip("'") for tok in tokens]
    hedge = None if bare == [CLEAN_NEGATIVE] else _first_hedge(bare)
    if hedge:
        return f'says "{hedge}"'
    return None


def _strip_approval(tokens: list[str]) -> tuple[bool, list[str]]:
    """(whether an approval phrase was found, the tokens that are neither approval nor filler)."""
    found = False
    left = []
    n = 0
    while n < len(tokens):
        phrase = next((p for p in APPROVAL if _phrase_at(tokens, n, p)), None)
        if phrase:
            found = True
            n += len(phrase.split())
            continue
        if tokens[n] not in FILLER:
            left.append(tokens[n])
        n += 1
    return found, left


def _without_plan_path(reply: str, plan_path: Optional[str]) -> str:
    """reply with the plan's path, its ~/ form, its directory's name and `plan.md` taken out, whatever their case.

    Saying which plan to run ("Implement plan <path>") is not a qualifier, and a directory name such
    as 2026-10-07_Add-Remove-Button would otherwise read as a hedge. The longest forms go first.
    """
    patterns = []
    if plan_path:
        path = str(plan_path)
        patterns.append(re.escape(path))
        home = os.path.expanduser("~").rstrip("/")
        if home and path.startswith(home + "/"):
            patterns.append(re.escape("~" + path[len(home) :]))
        parent = os.path.basename(os.path.dirname(path))
        if parent:
            patterns.append(rf"(?<!\w){re.escape(parent)}(?!\w)")
    patterns.append(r"(?<!\w)plan\.md(?!\w)")
    for pattern in patterns:
        reply = re.sub(pattern, " ", reply, flags=re.IGNORECASE)
    return reply


def classify_reply(reply: str, question_count: int, plan_path: Optional[str] = None) -> Classification:
    """Decide whether a chat reply to the approval card approves the plan.

    The rule is that approval must be unmistakable: anything unclear is ambiguous (the user is asked
    to confirm) and anything held back or questioned is a change. A false approval ships a plan the
    user did not accept; a false "ambiguous" costs one more word.

    question_count is the number of numbered items on the card, Run included; "N answer" is an
    answer only for N in 1..question_count. plan_path is the plan the card is for: a reply that
    names it ("Implement plan <path>") still approves. Steps, the first to match wins:

    1. an empty reply is ambiguous;
    2. a "?" anywhere is a change;
    3. the plan's path is taken out (see _without_plan_path);
    4. the reply is cut at commas, semicolons and newlines into chunks; a chunk that is
       "<number> <answer>" is a numbered answer, and every other chunk is cut again at sentence
       ends into text (so "1. option 3" stays one answer);
    5. a hedge word in the text is a change;
    6. an answer is ambiguous when it is longer than MAX_ANSWER_WORDS, holds an uncertainty word or a
       hedge word (the bare answer "no" is clean), or holds a character the card cannot carry (see
       ANSWER_UNSAFE_CHARS and _answer_problem);
    7. text left after approval phrases and filler are taken out is ambiguous;
    8. no approval phrase and no answer is ambiguous;
    9. otherwise the reply approves.
    """
    if not reply.strip():
        return Classification(AMBIGUOUS, {}, "the reply is empty")
    if "?" in reply:
        return Classification(CHANGE, {}, "the reply asks a question")

    answers: dict[int, str] = {}
    text: list[list[str]] = []  # the tokens of each stretch of text
    for chunk in _CHUNK_SPLIT_RE.split(_without_plan_path(reply, plan_path)):
        chunk = chunk.strip()
        match = _ANSWER_RE.match(chunk)
        if match and 1 <= int(match.group(1)) <= question_count:
            answers[int(match.group(1))] = match.group(2)  # as typed: the case is kept
        else:
            text.extend(_tokens(sentence) for sentence in _SENTENCE_END_RE.split(chunk))

    for tokens in text:
        hedge = _first_hedge(tokens)
        if hedge:
            return Classification(CHANGE, {}, f'the reply says "{hedge}"')

    for number, answer in answers.items():
        problem = _answer_problem(answer)
        if problem:
            return Classification(AMBIGUOUS, {}, f"answer {number} {problem}")

    approved = False
    left: list[str] = []
    for tokens in text:
        found, rest = _strip_approval(tokens)
        approved = approved or found
        left.extend(rest)
    if left:
        return Classification(AMBIGUOUS, {}, f"the reply says more than an approval: {' '.join(left)}")
    if not approved and not answers:
        return Classification(AMBIGUOUS, {}, "the reply has no approval phrase and no numbered answer")
    return Classification(APPROVE, answers, "approval phrase" if approved else "numbered answers")


# ---------------------------------------------------------------------------
# approve
# ---------------------------------------------------------------------------

# What the Run item accepts as an answer, and what each is written as
RUN_ANSWERS = {"subagent-driven": "subagent-driven", "subagent": "subagent-driven", "inline": "inline"}

_DECISION_HEADS = {
    APPROVE: "Approved card",
    CHANGE: "Change requested on card",
    AMBIGUOUS: "Reply needing confirmation on card",
}
_DLINE_TAG_RE = re.compile(r"^(- D\d+ )\[(?:ask|you: [^\]]+)\]")  # the tag of an [ask] or [you: ...] D-line
_DECISIONS_TITLE_RE = re.compile(r"decisions\s*$", re.IGNORECASE)
_STATUS_TITLE_RE = re.compile(r"status\s*$", re.IGNORECASE)


def _why(exc: Exception) -> str:
    """The short reason an OSError or a decoding error gives."""
    return getattr(exc, "strerror", None) or str(exc)


def _answers_text(answers: dict[int, str]) -> str:
    """`2=no, 3=inline`: the answers by question number."""
    return ", ".join(f"{n}={answer}" for n, answer in sorted(answers.items()))


def _checked_answers(answers: dict[int, str], questions: list[Question]) -> Optional[dict[int, str]]:
    """The answers as they go into the plan, or None when one of them cannot.

    An answer must be for a question the card has (numbering can skip a number). Run takes only
    subagent-driven, subagent or inline, in any case, and is written as subagent-driven or inline.
    """
    by_number = {q.n: q for q in questions}
    checked = {}
    for number, answer in answers.items():
        question = by_number.get(number)
        if question is None:
            return None
        if question.is_run:
            answer = RUN_ANSWERS.get(answer.lower())
            if answer is None:
                return None
        checked[number] = answer
    return checked


def _edit_line(lines: list[str], line_no: int, edit: Callable[..., str], *args) -> None:
    """Replace lines[line_no - 1] (lines from splitlines(keepends=True)) with edit(its text, *args), keeping its line ending."""
    line = lines[line_no - 1]
    text = line.splitlines()[0]
    lines[line_no - 1] = edit(text, *args) + line[len(text) :]


def _bold_answer(text: str, is_run: bool, answer: str) -> str:
    """A numbered card line with its bold default replaced by `you: <answer>`.

    Trailing spaces stay. A `->` on the line is written `→`, which is how the card reads it anyway.
    """
    core = text.rstrip()
    shown = core.replace("->", "→")
    match = (_RUN_RE if is_run else _QUESTION_RE).match(shown)
    group = 2 if is_run else 3
    return f"{shown[: match.start(group)]}{_ANSWER_PREFIX}{answer}{shown[match.end(group) :]}{text[len(core) :]}"


def _retag(text: str, value: str) -> str:
    """A D-line with its [ask] or [you: ...] tag set to [you: <value>]."""
    return _DLINE_TAG_RE.sub(lambda match: f"{match.group(1)}[you: {value}]", text, count=1)


def _approved_plan(raw: str, card: Card, dlines: dict[str, DLine], answers: dict[int, str]) -> str:
    """raw with the user's answers written in and its status set to approved. ValueError when a default cannot be.

    - Each answered question's Brief bold becomes `**you: <answer>**`, Run included.
    - Each [ask] D-line becomes `[you: <answer>]`, or `[you: <the card's default>]` for a question
      left unanswered. A `[you: ...]` D-line from an earlier approval changes only when its question
      is answered again.
    - Every other byte stays, line endings included.
    """
    lines = raw.splitlines(keepends=True)
    by_number = {q.n: q for q in card.questions}
    for number, answer in answers.items():
        question = by_number[number]
        _edit_line(lines, question.line, _bold_answer, question.is_run, answer)

    asked = {q.text: q for q in card.questions if not q.is_run}
    for did, dline in dlines.items():
        if dline.tag != "ask" and not dline.tag.startswith(_ANSWER_PREFIX):
            continue
        ask = _ASK_BODY_RE.match(dline.text)
        question = asked.get(ask.group(1)) if ask else None
        if question is None:
            continue
        if question.n in answers:
            value = answers[question.n]
        elif dline.tag == "ask":
            value = question.default
            if "]" in value:
                raise ValueError(
                    f"ERROR [card] line {dline.line}: {did}'s default {value!r} holds ']', which a [you: ...] tag cannot "
                    f"carry. Answer question {question.n} yourself, or take the ']' out of the default and render the card again.\n"
                )
        else:
            continue
        _edit_line(lines, dline.line, _retag, value)
    return _with_status("".join(lines), APPROVED_STATUS)


def _decision_entry(kind: str, sha7: str, plan: str, answers: dict[int, str], reply: str) -> str:
    """The `## Decisions` entry for a reply: a dated line, then each reply line verbatim as `  > <line>`.

    The reply is cut at line feeds only, so a carriage return or any other character stays in the log as typed.
    """
    day = datetime.now().strftime("%Y-%m-%d")
    suffix = f"; answers: {_answers_text(answers)}" if answers else ""
    quoted = "".join(f"  > {line}\n" for line in reply.split("\n"))
    return f"- **{day}** — {_DECISION_HEADS[kind]} {sha7} ({plan}){suffix}\n{quoted}"


def _with_decision(text: str, entry: str) -> str:
    """SESSION.md's text with entry added to its `## Decisions` section; every other byte is unchanged.

    The entry goes after the section's last non-blank line. A file without the section gets it
    created before `## Status`, or at the end of the file. A heading inside a code fence does not count.
    """
    lines = text.splitlines(keepends=True)
    bare = text.splitlines()
    mask = _fence_mask(bare)
    section = _find_section(bare, mask, _DECISIONS_TITLE_RE, 2)
    if section:
        start, end = section
        at = max(idx for idx in range(start, end) if bare[idx].strip()) + 1
        # A heading with nothing under it: keep the blank line between it and the entry
        block = entry if at > start + 1 else "\n" + entry
    else:
        status = _find_section(bare, mask, _STATUS_TITLE_RE, 2)
        at = status[0] if status else len(lines)
        block = f"## Decisions\n\n{entry}" + ("\n" if status else "")
        if at and lines[at - 1].strip():
            block = "\n" + block
    if at and lines[at - 1] == bare[at - 1]:  # the file's last line has no line ending yet
        lines[at - 1] += "\n"
    return "".join(lines[:at]) + block + "".join(lines[at:])


def approve(path, reply: str, session_md) -> tuple[str, int]:
    """Act on the user's reply to the plan's approval card: (text to print, exit code).

    The text is for stdout, except with exit code 1 (refused), where it is the reason for stderr.

    Refused (1), with nothing written, when SESSION.md is not a file, the plan is invalid,
    legacy or below PASS (the delivery repos are probed again, as render does), or its status
    is not awaiting-approval (a draft is told to render the card first).

    Otherwise the card's sha7 is taken from the Brief as it stands, the reply is classified and
    its Run answer checked, and the reply is logged under `## Decisions` in SESSION.md:

    - approve (0): the log is written first, then the plan, each atomically. Printed:
      `approved: "<title>" (card <sha7>)[; answers: 2=no, 3=inline]; logged to <SESSION.md>`.
    - change (2): logged; the plan is untouched. Printed: `change request: not approved; logged to <SESSION.md>`.
    - ambiguous (3): logged; the plan is untouched. Printed: the line that asks the user to confirm.
      A reply that approves but answers Run with anything but subagent-driven, subagent or inline is ambiguous.
    """
    plan = os.path.abspath(path)
    session = os.path.abspath(session_md)
    if not os.path.isfile(session):
        return f"ERROR [io] SESSION.md not found: {session}; pass the session's SESSION.md with --session-md\n", EXIT_REFUSED
    try:
        session_text = _read_text(session)
    except (OSError, UnicodeDecodeError) as exc:
        return f"ERROR [io] Cannot read {session}: {_why(exc)}\n", EXIT_REFUSED

    loaded, refusal = _load_plan(plan, "approve")
    if loaded is None:
        return refusal, EXIT_REFUSED
    status = loaded.fm.data["status"]  # a valid token: the validator errors on any other
    if status == "draft":
        draft = f'ERROR [status] plan is draft: render the card first (card.py render "{plan}"), then pass the user\'s reply here\n'
        return draft, EXIT_REFUSED
    if status != SET_STATUS:
        return f"ERROR [status] plan is {status}, not {SET_STATUS}; there is nothing to approve\n", EXIT_REFUSED

    lines = loaded.raw.splitlines()
    card = parse_card(lines)
    title = plan_title(lines)
    sha7 = brief_sha7(card.brief_text)  # of the Brief as the user saw it, before any answer is written into it
    result = classify_reply(reply, len(card.questions), plan)
    kind, answers = result.kind, result.answers
    if kind == APPROVE:
        checked = _checked_answers(answers, card.questions)
        kind, answers = (APPROVE, checked) if checked is not None else (AMBIGUOUS, {})

    new_session = _with_decision(session_text, _decision_entry(kind, sha7, plan, answers, reply))
    new_plan = ""
    if kind == APPROVE:
        try:
            new_plan = _approved_plan(loaded.raw, card, parse_dlines(lines), answers)
        except ValueError as exc:
            return str(exc), EXIT_REFUSED

    try:
        write_atomic(session, new_session)
    except OSError as exc:
        return f"ERROR [io] Cannot write {session}: {_why(exc)}\n", EXIT_REFUSED
    if kind == CHANGE:
        return f"change request: not approved; logged to {session}\n", EXIT_CHANGE
    if kind == AMBIGUOUS:
        return f'Not sure that approves "{title}". Reply go to approve as is, or tell me what to change.\n', EXIT_AMBIGUOUS

    try:
        write_atomic(plan, new_plan)
    except OSError as exc:
        return (
            f"ERROR [io] Cannot write {plan}: {_why(exc)}; the approval is logged in {session}, "
            f"but the plan is still {SET_STATUS}\n",
            EXIT_REFUSED,
        )
    answered = f"; answers: {_answers_text(answers)}" if answers else ""
    return f'approved: "{title}" (card {sha7}){answered}; logged to {session}\n', EXIT_OK


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


class _Parser(argparse.ArgumentParser):
    """An ArgumentParser whose usage errors exit 64, so they differ from a refusal (1)."""

    def error(self, message: str):
        self.print_usage(sys.stderr)
        sys.stderr.write(f"{self.prog}: error: {message}\n")
        sys.exit(EXIT_USAGE)


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="card.py", description="The approval card for a plan/v3 PLAN.md.")
    commands = parser.add_subparsers(dest="command", required=True, metavar="{render,approve}")

    render_parser = commands.add_parser(
        "render",
        help="print the approval card and set a draft plan to awaiting-approval",
        description="Validate PLAN, print its approval card, and set a draft plan's status to awaiting-approval.",
    )
    render_parser.add_argument("plan", metavar="PLAN", help="path to the PLAN.md")
    render_parser.add_argument("--no-write", action="store_true", help="print the card; leave the file as it is")

    approve_parser = commands.add_parser(
        "approve",
        help="act on the user's reply to the approval card",
        description=(
            "Log the user's reply to PLAN's approval card in SESSION.md, then approve the plan, "
            "or leave it as it is when the reply asks for a change or is unclear. "
            "Exit 0: approved. 2: a change was asked for. 3: the reply needs confirming. 1: refused."
        ),
    )
    approve_parser.add_argument("plan", metavar="PLAN", help="path to the PLAN.md, its status awaiting-approval")
    reply = approve_parser.add_mutually_exclusive_group(required=True)
    reply.add_argument("--reply", metavar="TEXT", help="the user's reply, exactly as typed")
    reply.add_argument(
        "--reply-file",
        metavar="PATH",
        help="read the reply from this file, or from stdin for -; one trailing newline is dropped",
    )
    approve_parser.add_argument("--session-md", required=True, metavar="PATH", help="the session's SESSION.md, which gets the log entry")
    return parser


def _read_reply(parser: argparse.ArgumentParser, args: argparse.Namespace) -> str:
    """The reply from --reply, or from --reply-file (stdin for -) with one trailing newline dropped."""
    if args.reply is not None:
        return args.reply
    try:
        if args.reply_file == "-":
            data = sys.stdin.buffer.read()
        else:
            with open(args.reply_file, "rb") as fh:
                data = fh.read()
        text = data.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        parser.error(f"cannot read the reply from {args.reply_file}: {_why(exc)}")
    return text[:-1] if text.endswith("\n") else text


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "render":
        stdout, stderr, code = render(args.plan, write=not args.no_write)
        sys.stdout.write(stdout)
        sys.stderr.write(stderr)
        return code
    text, code = approve(args.plan, _read_reply(parser, args), args.session_md)
    (sys.stderr if code == EXIT_REFUSED else sys.stdout).write(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
