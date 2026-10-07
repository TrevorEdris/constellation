#!/usr/bin/env python3
"""
card.py - the approval card for a plan/v3 PLAN.md.

A v3 plan opens with a Brief written as the card the user approves. `render`
validates the plan, prints that card, and moves a draft plan to
awaiting-approval.

Usage:
    python3 card.py render <PLAN>
    python3 card.py render <PLAN> --no-write

The card is the Brief, verbatim, between an ask line and a footer:

    **Approve "<title>"?** Reply go to take every default, or answer by number.
    <the Brief's lines; the Ships-as line ends " (remote checked MM-DD HH:MM)">
    **Warnings for you:** <human warnings>        (only when there are some)
    Plan: <absolute PLAN path> · validator <score> PASS · card <sha7>

The check time is when `render` re-probed the delivery repos with git. It is
printed, never stored. sha7 is brief_sha7 of the Brief.

Exit codes:
    0  - the card was printed (or the plan needs no approval)
    1  - the plan is invalid, legacy or does not pass: the reasons are on stderr
    64 - usage error
"""

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from validate_plan import (
    CARD_PAST_APPROVAL_STATUSES,
    SHIPS_LABEL,
    Issue,
    _NUMBERED_RE,  # the one definition of "a numbered question line"
    _words,  # the one definition of "a word"
    ask_line,
    is_v3,
    parse_card,
    parse_frontmatter,
    plan_title,
    validate_plan,
)

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_USAGE = 64

WARNINGS_LABEL = "**Warnings for you:**"
FOOTER_PREFIX = "Plan: "
SET_STATUS = "awaiting-approval"


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
    report = validate_plan(Path(plan))
    unreadable = [issue for issue in report.errors if issue.category == "io"]
    if unreadable:
        return "", "".join(_finding("ERROR", issue) for issue in unreadable), EXIT_REFUSED

    try:
        with open(plan, encoding="utf-8", newline="") as fh:
            raw = fh.read()
    except (OSError, UnicodeDecodeError) as exc:  # the file changed since the validator read it
        return "", f"ERROR [io] Cannot read file: {exc}\n", EXIT_REFUSED
    fm = parse_frontmatter(raw)
    if not is_v3(fm):
        schema = fm.data.get("schema")
        shown = schema if isinstance(schema, str) and schema else "none"
        return "", f"card.py render needs schema: plan/v3 (this plan: {shown}); present legacy plans as before\n", EXIT_REFUSED

    if report.errors:
        return "", "".join(_finding("ERROR", issue) for issue in report.errors), EXIT_REFUSED
    if not report.passed:
        # No errors, so the score is under 70. The footer says PASS, so no card.
        refusal = (
            f"ERROR [score] validator score {report.score}/100 is below 70 (NEEDS WORK), "
            "so the plan cannot be presented. Fix these warnings, then render again.\n"
        )
        return "", refusal + "".join(_finding("WARN", issue) for issue in report.warnings), EXIT_REFUSED

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
    commands = parser.add_subparsers(dest="command", required=True, metavar="{render}")
    render_parser = commands.add_parser(
        "render",
        help="print the approval card and set a draft plan to awaiting-approval",
        description="Validate PLAN, print its approval card, and set a draft plan's status to awaiting-approval.",
    )
    render_parser.add_argument("plan", metavar="PLAN", help="path to the PLAN.md")
    render_parser.add_argument("--no-write", action="store_true", help="print the card; leave the file as it is")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    stdout, stderr, code = render(args.plan, write=not args.no_write)
    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
