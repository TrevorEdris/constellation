#!/usr/bin/env python3
"""
validate_plan.py — Validate structural completeness and actionability of an
implementation plan (PLAN.md).

Usage:
    python validate_plan.py <path-to-plan.md>
    python validate_plan.py <path-to-plan.md> --verbose
    python validate_plan.py <path-to-plan.md> --json

Exit codes:
    0 — PASS (score >= 70, no blocking issues)
    1 — NEEDS WORK (score < 70 or blocking issues found)

Schema dispatch: a plan whose frontmatter says exactly `schema: plan/v3` gets
errors for card, delivery, placeholder and step findings. Every other plan is
legacy: the same checks as before, new checks as warnings, plus one `legacy`
warning. No new check changes the score, so a legacy plan's PASS/NEEDS WORK
status never changes because of the v3 work.

A v3 plan lists where its work ships in a `delivery:` block list. That list is
checked against the card's Ships-as and Size lines and, unless the probe is
off, against what git says about each repo (its remotes and recent commits).
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


# Categories a human reviewer should see on the approval card; every other
# category is for the agent that wrote the plan.
HUMAN_CATEGORIES = frozenset({"git", "brief", "card", "delivery"})


@dataclass
class Issue:
    """A single validation finding."""

    severity: str  # "error" | "warning" | "info"
    category: str
    message: str
    line: int = 0
    rule: str = ""  # stable id of the rule that fired, for card and delivery errors

    @property
    def audience(self) -> str:
        """Who should act on this finding: "human" or "agent"."""
        return "human" if self.category in HUMAN_CATEGORIES else "agent"


@dataclass
class ValidationReport:
    """Aggregated validation result for a plan."""

    path: str
    issues: list[Issue] = field(default_factory=list)
    score: int = 100

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def passed(self) -> bool:
        return len(self.errors) == 0 and self.score >= 70


# ---------------------------------------------------------------------------
# Section detection helpers
# ---------------------------------------------------------------------------

_FILE_EXTENSIONS = (
    # C / C++
    "c|cc|cpp|cxx|h|hh|hpp|hxx"
    # JVM
    "|kt|java|gradle|scala|clj"
    # Python
    "|py|pyi|pyx"
    # JavaScript / TypeScript
    "|ts|tsx|js|jsx|mjs|cjs"
    # Go / Rust
    "|go|rs"
    # Ruby / PHP / Perl
    "|rb|php|pl|pm"
    # Swift / Objective-C
    "|swift|m|mm"
    # C# / F#
    "|cs|fs|fsx"
    # Shell / scripting
    "|sh|bash|zsh|fish|ps1"
    # Data / config
    "|sql|yaml|yml|json|jsonc|xml|toml|ini|cfg|conf|env"
    # Markup / docs
    "|md|mdc|mdx|rst|txt|tex|adoc"
    # Web
    "|html|htm|css|scss|sass|less|svelte|vue"
    # IaC / DevOps
    "|tf|tfvars|hcl"
    # Build / project
    "|cmake|meson|ninja|bazel"
    # Misc
    "|proto|graphql|gql|wasm|zig|nim|dart|ex|exs|erl|hrl|hs|lua|r|jl"
)

FILE_PATH_PATTERN = re.compile(
    r"(?:"
    rf"[`\"][\w./\-]+(?:\.(?:{_FILE_EXTENSIONS}))[`\"]"
    r"|"
    rf"(?:^|\s)[\w./\-]+(?:\.(?:{_FILE_EXTENSIONS}))(?:\s|$|[,;:\)])"
    r")"
)

VAGUE_PHRASES = [
    r"\bshould work\b",
    r"\bmight need\b",
    r"\bprobably\b",
    r"\bas needed\b",
    r"\betc\.?\b",
    r"\bsomehow\b",
    r"\bvarious\b",
    r"\bas appropriate\b",
    r"\bif necessary\b",
    r"\band so on\b",
    r"\bmaybe\b",
]

VERIFICATION_KEYWORDS = re.compile(
    r"\b(?:test|tests|build|lint|verify|verification|validate|check|assert|gradle|pytest|npm run|jest|make)\b",
    re.IGNORECASE,
)

PR_SIZE_TOTAL_RE = re.compile(r"estimated\s+pr\s+size[:*\s]+.*?([\d,]{2,})", re.IGNORECASE)


def find_section(lines: list[str], pattern: str) -> tuple[int, int]:
    """Find a section by heading pattern. Returns (start_line, end_line) 1-indexed, or (0, 0)."""
    regex = re.compile(pattern, re.IGNORECASE)
    start = 0
    level = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not start and regex.match(stripped):
            start = i + 1
            level = len(stripped) - len(stripped.lstrip("#"))
            continue
        if start and stripped.startswith("#"):
            heading_level = len(stripped) - len(stripped.lstrip("#"))
            if heading_level <= level:
                return (start, i)
    if start:
        return (start, len(lines))
    return (0, 0)


def section_content(lines: list[str], start: int, end: int) -> str:
    """Extract section body text (excluding the heading line itself)."""
    if start == 0:
        return ""
    return "\n".join(lines[start:end])


# ---------------------------------------------------------------------------
# Frontmatter parsing and schema dispatch
# ---------------------------------------------------------------------------

SCHEMA_V3 = "plan/v3"
STATUS_TOKENS = ("draft", "awaiting-approval", "approved", "in-progress", "complete")


class FrontmatterProblem(NamedTuple):
    """Something in the frontmatter that is tolerated in legacy plans and an error in v3."""

    code: str  # "inline-comment" | "syntax" | "unterminated"
    line: int  # 1-indexed line in the file
    message: str


class Frontmatter(NamedTuple):
    """Result of parse_frontmatter; unpacks as (data, end_line, problems).

    data: top-level keys. Scalars are str, `null`/`~`/empty are None, flow and
        block lists are list[str], and a block list of `key: value` items is
        list[dict]. Values stay strings; callers convert (e.g. `prs`).
    end_line: 1-indexed line of the closing `---`, so lines[end_line:] is the
        body. 0 when the file has no (complete) frontmatter.
    """

    data: dict[str, Any]
    end_line: int
    problems: list[FrontmatterProblem]


_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$")
_DASH_RE = re.compile(r"^(\s*)-(?:(\s+)(.*))?$")
_COMMENT_RE = re.compile(r"(?:^|\s)#")
_EMPTY = object()  # a value with no text at all (a block list may follow)


def _unquote(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        return text[1:-1]
    return text


def _parse_value(raw: str, key: str, line_no: int, problems: list[FrontmatterProblem]) -> Any:
    """Parse the text after `key:`; returns str, list[str], None or _EMPTY.

    An unquoted value's inline ` #` comment is stripped and recorded as a
    problem. A quoted value is taken verbatim up to its closing quote.
    """
    text = raw.strip()
    if text[:1] in ("'", '"'):
        close = text.find(text[0], 1)
        if close != -1:
            return text[1:close]
    comment = _COMMENT_RE.search(text)
    if comment:
        problems.append(
            FrontmatterProblem(
                "inline-comment",
                line_no,
                f"Inline '#' comment after '{key}:'. Remove it; v3 frontmatter values take no trailing comments.",
            )
        )
        text = text[: comment.start()].rstrip()
    if not text:
        return _EMPTY
    if text.startswith("["):
        if not text.endswith("]"):
            problems.append(FrontmatterProblem("syntax", line_no, f"Unclosed list for '{key}:'; put a flow list on one line."))
            return text
        return [_unquote(item) for item in text[1:-1].split(",") if item.strip()]
    if text in ("null", "~"):
        return None
    return text


def _none_if_empty(value: Any) -> Any:
    return None if value is _EMPTY else value


def _parse_block_list(
    lines: list[str], start: int, end: int, key: str, problems: list[FrontmatterProblem]
) -> tuple[Optional[list[Any]], int]:
    """Parse the block list under `key:` from lines[start:end].

    Returns (items, next_index); items is None when no list items follow. Items
    are scalars or dicts of `key: value` pairs. Anything deeper is a problem.
    """
    items: list[Any] = []
    current: Optional[dict[str, Any]] = None
    key_col = 0
    dash_indent: Optional[int] = None
    i = start
    while i < end:
        raw = lines[i].rstrip()
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip())
        dash = _DASH_RE.match(raw)
        if indent == 0 and not dash:
            break  # the next top-level key
        line_no = i + 1
        if dash:
            if dash_indent is None:
                dash_indent = len(dash.group(1))
            if len(dash.group(1)) != dash_indent:
                problems.append(FrontmatterProblem("syntax", line_no, f"Inconsistent list indentation under '{key}:'."))
                current = None
            else:
                content = dash.group(3) or ""
                pair = _KEY_RE.match(content)
                if pair:
                    current = {}
                    items.append(current)
                    key_col = dash_indent + 1 + len(dash.group(2))
                    current[pair.group(1)] = _none_if_empty(
                        _parse_value(pair.group(2) or "", pair.group(1), line_no, problems)
                    )
                else:
                    current = None
                    items.append(_none_if_empty(_parse_value(content, key, line_no, problems)))
        else:
            pair = _KEY_RE.match(stripped)
            if current is not None and indent == key_col and pair:
                current[pair.group(1)] = _none_if_empty(
                    _parse_value(pair.group(2) or "", pair.group(1), line_no, problems)
                )
            else:
                problems.append(
                    FrontmatterProblem("syntax", line_no, f"Cannot parse line under '{key}:'; use a flat block list.")
                )
        i += 1
    return (items or None), i


def parse_frontmatter(text: str) -> Frontmatter:
    """Parse the leading `---` frontmatter block: block YAML, no nesting beyond a list of items."""
    lines = text.splitlines()
    if not lines or lines[0].rstrip() != "---":
        return Frontmatter({}, 0, [])
    end = next((n for n in range(1, len(lines)) if lines[n].rstrip() == "---"), None)
    if end is None:
        return Frontmatter({}, 0, [FrontmatterProblem("unterminated", 1, "Frontmatter opens with '---' but never closes.")])

    data: dict[str, Any] = {}
    problems: list[FrontmatterProblem] = []
    i = 1
    while i < end:
        raw = lines[i].rstrip()
        i += 1
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        pair = _KEY_RE.match(raw)
        if not pair:
            problems.append(FrontmatterProblem("syntax", i, f"Cannot parse frontmatter line: {raw.strip()!r}"))
            continue
        key = pair.group(1)
        value = _parse_value(pair.group(2) or "", key, i, problems)
        if value is _EMPTY:
            items, i = _parse_block_list(lines, i, end, key, problems)
            value = items
        data[key] = value
    return Frontmatter(data, end + 1, problems)


def is_v3(fm: Frontmatter) -> bool:
    """True only for the exact schema `plan/v3`; every other plan is legacy."""
    return fm.data.get("schema") == SCHEMA_V3


def check_schema(fm: Frontmatter, report: ValidationReport) -> None:
    """Dispatch on schema. Adds findings only; it never changes the score."""
    if not is_v3(fm):
        schema = fm.data.get("schema")
        label = schema if isinstance(schema, str) and schema else "none"
        report.issues.append(
            Issue(
                severity="warning",
                category="legacy",
                message=(
                    f"Legacy plan (schema: {label}). The approval-card checks report as warnings only "
                    f"and never change the score. Use 'schema: {SCHEMA_V3}' to get the card gate."
                ),
            )
        )
        return

    for problem in fm.problems:
        report.issues.append(Issue(severity="error", category="schema", message=problem.message, line=problem.line))

    status = fm.data.get("status")
    if status not in STATUS_TOKENS:
        shown = f"got '{status}'" if isinstance(status, str) else "it is missing"
        report.issues.append(
            Issue(
                severity="error",
                category="schema",
                message=f"status must be one of {', '.join(STATUS_TOKENS)}; {shown}.",
            )
        )


# ---------------------------------------------------------------------------
# Check functions
# ---------------------------------------------------------------------------


def check_target_repos(lines: list[str], report: ValidationReport) -> None:
    """Check that at least one target repo or directory is listed."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:target\s+repo|repos|repository|directories)")
    if s == 0:
        # Also check for repo mentions in the first 30 lines
        header = "\n".join(lines[:30])
        if not re.search(r"(?:repo|repository|~/|noom/|src/)", header, re.IGNORECASE):
            report.issues.append(
                Issue(
                    severity="error",
                    category="structure",
                    message="No target repo or directory identified. Plans must specify which repos are in scope.",
                )
            )
            report.score -= 15
            return
    else:
        body = section_content(lines, s, e)
        if len(body.strip()) < 5:
            report.issues.append(
                Issue(
                    severity="error",
                    category="structure",
                    message="Target repo section exists but is empty.",
                    line=s,
                )
            )
            report.score -= 15


def check_files_to_modify(lines: list[str], report: ValidationReport) -> None:
    """Check that explicit file paths are listed."""
    content = "\n".join(lines)
    file_refs = FILE_PATH_PATTERN.findall(content)
    if len(file_refs) < 2:
        report.issues.append(
            Issue(
                severity="error",
                category="specificity",
                message=f"Only {len(file_refs)} file path(s) found in the plan. Plans must list specific files to modify.",
            )
        )
        report.score -= 15


def check_ordered_steps(lines: list[str], report: ValidationReport) -> None:
    """Check that numbered or sequenced implementation steps exist."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:implementation\s+)?steps?")
    step_pattern = re.compile(r"^#{1,4}\s+step\s+\d", re.IGNORECASE)
    numbered_pattern = re.compile(r"^\s*\d+\.\s+")

    has_steps = False
    for line in lines:
        if step_pattern.match(line.strip()) or numbered_pattern.match(line):
            has_steps = True
            break

    if not has_steps:
        report.issues.append(
            Issue(
                severity="error",
                category="structure",
                message="No ordered implementation steps found. Use numbered steps or '### Step N' headings.",
            )
        )
        report.score -= 15


def check_steps_reference_files(lines: list[str], report: ValidationReport) -> None:
    """Check that implementation steps mention file paths."""
    step_pattern = re.compile(r"^#{1,4}\s+step\s+(\d+)", re.IGNORECASE)

    current_step = None
    step_start = 0
    steps_without_files = []

    for i, line in enumerate(lines):
        match = step_pattern.match(line.strip())
        if match:
            # Check previous step
            if current_step is not None:
                step_body = "\n".join(lines[step_start:i])
                if not FILE_PATH_PATTERN.search(step_body):
                    steps_without_files.append(current_step)
            current_step = match.group(1)
            step_start = i  # include the heading line (file paths often appear there)

    # Check last step
    if current_step is not None:
        step_body = "\n".join(lines[step_start:])
        if not FILE_PATH_PATTERN.search(step_body):
            steps_without_files.append(current_step)

    for step_num in steps_without_files:
        report.issues.append(
            Issue(
                severity="warning",
                category="specificity",
                message=f"Step {step_num} does not reference any file paths.",
            )
        )
        report.score -= 3


def check_risks_section(lines: list[str], report: ValidationReport) -> None:
    """Check for a non-empty risks or assumptions section."""
    rs, re_ = find_section(lines, r"^#{1,3}\s+(?:risks?|assumptions?|risks?\s+and\s+assumptions?)")
    if rs == 0:
        report.issues.append(
            Issue(
                severity="warning",
                category="structure",
                message="No risks or assumptions section found.",
            )
        )
        report.score -= 5
    else:
        body = section_content(lines, rs, re_)
        if len(body.strip()) < 10:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="Risks section exists but is nearly empty.",
                    line=rs,
                )
            )
            report.score -= 5


def check_verification_section(lines: list[str], report: ValidationReport) -> None:
    """Check for verification steps."""
    vs, ve = find_section(lines, r"^#{1,3}\s+(?:verification|verify|testing|test\s+plan)")
    if vs == 0:
        # Check if verification keywords appear anywhere
        content = "\n".join(lines)
        if not VERIFICATION_KEYWORDS.search(content):
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="No verification steps found. Plans should describe how to confirm correctness.",
                )
            )
            report.score -= 5
    else:
        body = section_content(lines, vs, ve)
        if len(body.strip()) < 10:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="Verification section exists but is nearly empty.",
                    line=vs,
                )
            )
            report.score -= 5


def check_vague_language(lines: list[str], report: ValidationReport) -> None:
    """Flag vague language that weakens a plan."""
    hits = 0
    in_code_block = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Track code block state
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        # Skip code blocks and table rows
        if in_code_block or stripped.startswith("|"):
            continue
        for phrase_pattern in VAGUE_PHRASES:
            if re.search(phrase_pattern, line, re.IGNORECASE):
                if hits < 5:  # Cap reported issues at 5 to avoid noise
                    found = re.search(phrase_pattern, line, re.IGNORECASE)
                    phrase_text = found.group() if found else phrase_pattern
                    report.issues.append(
                        Issue(
                            severity="warning",
                            category="vagueness",
                            message=f"Vague language: \"{phrase_text}\"",
                            line=i,
                        )
                    )
                hits += 1
    if hits > 0:
        report.score -= min(hits * 2, 10)


def check_oversized_code_blocks(lines: list[str], report: ValidationReport) -> None:
    """Detect code blocks >15 lines (plans describe, not implement)."""
    in_block = False
    block_start = 0
    block_lines = 0

    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```") and not in_block:
            in_block = True
            block_start = i
            block_lines = 0
        elif line.strip() == "```" and in_block:
            in_block = False
            if block_lines > 15:
                report.issues.append(
                    Issue(
                        severity="warning",
                        category="code-size",
                        message=f"Code block at line {block_start} is {block_lines} lines. Plans should describe changes, not implement them.",
                        line=block_start,
                    )
                )
                report.score -= 3
        elif in_block:
            block_lines += 1


def check_scope_boundary(lines: list[str], report: ValidationReport) -> None:
    """Check for explicit scope exclusions."""
    content_lower = "\n".join(lines).lower()
    scope_phrases = [
        "out of scope", "not included", "excluded", "will not", "does not include",
    ]
    if not any(phrase in content_lower for phrase in scope_phrases):
        report.issues.append(
            Issue(
                severity="info",
                category="scope",
                message="No explicit scope exclusions found. Consider stating what is NOT in scope.",
            )
        )


def check_traceability_table(lines: list[str], report: ValidationReport) -> None:
    """Check for a traceability table linking discovery findings to plan steps."""
    content = "\n".join(lines)
    has_traceability = (
        re.search(r"^#{1,3}\s+traceability", content, re.IGNORECASE | re.MULTILINE)
        or re.search(r"discovery\s+finding\s*\|\s*plan\s+step", content, re.IGNORECASE)
    )
    if not has_traceability:
        report.issues.append(
            Issue(
                severity="warning",
                category="traceability",
                message=(
                    "No traceability table found. Include a table mapping "
                    "discovery findings to plan steps (Discovery Finding | Plan Step | Notes)."
                ),
            )
        )
        report.score -= 5


def check_testable_outcomes(lines: list[str], report: ValidationReport) -> None:
    """Check that at least one step references verification commands."""
    content = "\n".join(lines)
    if not VERIFICATION_KEYWORDS.search(content):
        report.issues.append(
            Issue(
                severity="warning",
                category="verification",
                message="No test, build, or verification commands found. Plans should include concrete verification steps.",
            )
        )
        report.score -= 5


def check_step_file_specificity(lines: list[str], report: ValidationReport) -> None:
    """Check 12: Each numbered step names a specific file path, not just a vague area."""
    numbered_step = re.compile(r"^\s*(\d+)\.\s+(.+)$")
    vague_step_phrases = re.compile(
        r"\b(?:update the (?:config|code|file|database|model|service)|"
        r"modify (?:the )?(?:config|settings|code)|"
        r"change (?:the )?(?:config|code|logic))\b",
        re.IGNORECASE,
    )
    vague_steps = []
    for i, line in enumerate(lines, 1):
        m = numbered_step.match(line)
        if m:
            step_text = m.group(2)
            # Only flag if vague phrase AND no file path found
            if vague_step_phrases.search(step_text) and not FILE_PATH_PATTERN.search(step_text):
                vague_steps.append((i, m.group(1), step_text[:80]))

    for lineno, step_num, text in vague_steps[:3]:  # cap at 3 to avoid noise
        report.issues.append(
            Issue(
                severity="warning",
                category="specificity",
                message=f"Step {step_num} uses vague language without a file path: \"{text}...\"",
                line=lineno,
            )
        )
        report.score -= 3


def check_per_step_verification(lines: list[str], report: ValidationReport) -> None:
    """Check 13: Each step should have a verification action."""
    step_sections = []
    step_pattern = re.compile(r"^#{1,4}\s+step\s+(\d+)", re.IGNORECASE)
    current_step = None
    step_start = 0

    for i, line in enumerate(lines):
        m = step_pattern.match(line.strip())
        if m:
            if current_step is not None:
                step_sections.append((current_step, step_start, i))
            current_step = m.group(1)
            step_start = i  # include heading line

    if current_step is not None:
        step_sections.append((current_step, step_start, len(lines)))

    if not step_sections:
        # Can't check per-step verification without labeled steps
        return

    steps_missing_verification = []
    for step_num, start, end in step_sections:
        body = "\n".join(lines[start:end])
        if not VERIFICATION_KEYWORDS.search(body):
            steps_missing_verification.append(step_num)

    if len(steps_missing_verification) > len(step_sections) // 2:
        # Only flag if more than half of steps lack verification
        report.issues.append(
            Issue(
                severity="warning",
                category="verification",
                message=(
                    f"Steps {', '.join(steps_missing_verification[:5])} lack per-step verification. "
                    "Each step should state how to confirm it succeeded (test/lint/build/manual check)."
                ),
            )
        )
        report.score -= 5


def check_structure_section(lines: list[str], report: ValidationReport) -> None:
    """Check 14: Plan should include a structure section with phase breakdown or dependency ordering."""
    content = "\n".join(lines)
    has_structure = bool(
        re.search(r"^#{1,3}\s+(?:structure|phases?|phase\s+breakdown|phase\s+ordering|dependency)", content, re.IGNORECASE | re.MULTILINE)
        or re.search(r"\bphase\s+\d+\b|\bP\d+\b", content)
        or re.search(r"depends?\s+on\s+(?:phase|step|P\d)", content, re.IGNORECASE)
    )
    if not has_structure:
        report.issues.append(
            Issue(
                severity="warning",
                category="structure",
                message=(
                    "No structure section found. Plans should include a phase breakdown or "
                    "dependency ordering (e.g., 'Phase 1 → Phase 2', dependency graph, or critical path)."
                ),
            )
        )
        report.score -= 5


def check_pr_size_estimate(lines: list[str], report: ValidationReport) -> None:
    """Require an Estimated PR size section; warn if a >1000-line estimate lacks a split analysis."""
    ss, se = find_section(lines, r"^#{1,3}\s+estimated\s+pr\s+size")
    if ss == 0:
        report.issues.append(
            Issue(
                severity="warning",
                category="structure",
                message="No 'Estimated PR size' section found. Every plan must forecast its total line delta.",
            )
        )
        report.score -= 5
        return
    body = section_content(lines, ss, se)
    if len(body.strip()) < 10:
        report.issues.append(
            Issue(
                severity="warning",
                category="structure",
                message="Estimated PR size section exists but is nearly empty.",
                line=ss,
            )
        )
        report.score -= 5
        return
    m = PR_SIZE_TOTAL_RE.search(body)
    if m:
        total = int(m.group(1).replace(",", ""))
        if total > 1000 and "split" not in body.lower() and "warning" not in body.lower():
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message=f"Estimated PR size ({total} lines) exceeds 1000 but the section has no large-PR warning or split analysis.",
                    line=ss,
                )
            )
            report.score -= 5


def check_git_branch(lines: list[str], report: ValidationReport) -> None:
    """Check 15: A branch name is specified."""
    content = "\n".join(lines)
    has_branch = bool(
        re.search(r"\b(?:feature|fix|refactor|chore|docs|hotfix|release)/[\w\-/]+", content)
        or re.search(r"branch[:\s]+`?[\w/\-]+`?", content, re.IGNORECASE)
        or re.search(r"^#{1,3}\s+git\s+(?:strategy|branch|workflow)", content, re.IGNORECASE | re.MULTILINE)
    )
    if not has_branch:
        report.issues.append(
            Issue(
                severity="warning",
                category="git",
                message=(
                    "No branch name found. Plans must specify the branch to create "
                    "(e.g., feature/my-feature, fix/bug-name)."
                ),
            )
        )
        report.score -= 5


def check_git_commit_plan(lines: list[str], report: ValidationReport) -> None:
    """Check 16: Commit checkpoints and a PR title/description are present."""
    content = "\n".join(lines)
    has_commits = bool(
        re.search(r"\b(?:feat|fix|refactor|chore|docs|test|perf|ci)\(", content)
        or re.search(r"commit\s+message", content, re.IGNORECASE)
    )
    has_pr = bool(
        re.search(r"\bpr\s+(?:title|description|body)\b", content, re.IGNORECASE)
        or re.search(r"pull\s+request", content, re.IGNORECASE)
        or re.search(r"^#{1,4}\s+pr\b", content, re.IGNORECASE | re.MULTILINE)
    )
    if not has_commits:
        report.issues.append(
            Issue(
                severity="warning",
                category="git",
                message=(
                    "No commit messages found. Plans should include commit checkpoints "
                    "with conventional commit messages."
                ),
            )
        )
        report.score -= 5
    if not has_pr:
        report.issues.append(
            Issue(
                severity="warning",
                category="git",
                message=(
                    "No PR title or description found. Plans should include an anticipated "
                    "PR title and description."
                ),
            )
        )
        report.score -= 3


BRIEF_HEADING = r"^##\s+brief\s*$"
BRIEF_MAX_WORDS = 120
BRIEF_LABELS = ("**Delivers:**", "**Changes:**", "**Decisions made for you:**")
BRIEF_STEP_REF = re.compile(r"\(\d+\.\d+\)|\bstep\s+\d+(?:\.\d+)?\b", re.IGNORECASE)


def check_brief(lines: list[str], report: ValidationReport) -> None:
    """Check 17: Plan should open with a short, plain-language Brief for the human reviewer."""
    start, end = find_section(lines, BRIEF_HEADING)
    if start == 0:
        report.issues.append(
            Issue(
                severity="warning",
                category="brief",
                message=(
                    "No Brief section found. Plans should open with '## Brief' "
                    "(Delivers / Changes / Decisions made for you) so a human can review in under a minute."
                ),
            )
        )
        report.score -= 5
        return

    # The Brief only helps if it is the first thing a human sees.
    in_code_block = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block or not re.match(r"^##\s", stripped):
            continue
        if not re.match(BRIEF_HEADING, stripped, re.IGNORECASE):
            report.issues.append(
                Issue(
                    severity="warning",
                    category="brief",
                    message="Brief must be the first section (first '##' heading) of the plan.",
                    line=start,
                )
            )
            report.score -= 3
        break

    # Blockquote lines are the template's guidance note, not Brief content.
    body_lines = [ln for ln in lines[start:end] if not ln.strip().startswith(">")]
    body = "\n".join(body_lines)

    words = sum(1 for token in body.split() if re.search(r"\w", token))
    if words > BRIEF_MAX_WORDS:
        report.issues.append(
            Issue(
                severity="warning",
                category="brief",
                message=f"Brief is {words} words; the budget is {BRIEF_MAX_WORDS}. Cut it — this is the 30-second read.",
                line=start,
            )
        )
        report.score -= 5

    missing = [label for label in BRIEF_LABELS if label not in body]
    if missing:
        report.issues.append(
            Issue(
                severity="warning",
                category="brief",
                message=f"Brief is missing required label(s): {', '.join(missing)}",
                line=start,
            )
        )
        report.score -= 5

    if "`" in body or BRIEF_STEP_REF.search(body):
        report.issues.append(
            Issue(
                severity="warning",
                category="brief",
                message="Brief must be plain language: no code, backticks, or step numbers.",
                line=start,
            )
        )
        report.score -= 3


# ---------------------------------------------------------------------------
# Placeholder, v2-step and Traceability-row checks
#
# These report an error on a `plan/v3` plan and a warning on every other plan,
# and none of them touches the score: a legacy plan's PASS/NEEDS WORK status
# must not change because of them (C13), and a v3 plan is blocked by the error
# severity alone.
# ---------------------------------------------------------------------------

PLACEHOLDER_REPORT_CAP = 10

_FENCE_OPEN_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
_HEADING_RE = re.compile(r"^ {0,3}(#{1,6})\s+(\S.*)$")
# Inline code, so a command such as `card.py render <PLAN>` is not a placeholder.
# re.S lets a span run across a line break; _mask_code_spans feeds it whole paragraphs.
_CODE_SPAN_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.S)

_FIELD_PLACEHOLDER_RE = re.compile(r"\{\{[^}]*\}\}")
_ANGLE_PLACEHOLDER_RE = re.compile(r"<(?![/!])(?!(?:details|summary|br|sub|sup|kbd|img|a)\b)[A-Za-z][^<>\n]*>")
_AUTOLINK_RE = re.compile(r"<[A-Za-z][A-Za-z0-9+.\-]{1,31}:[^\s<>]*>")
_EMAIL_RE = re.compile(r"<[^\s@<>]+@[^\s@<>]+>")
_MARKER_RE = re.compile(r"\bTBD\b|\bTODO\b")
_ELLIPSIS_LINE_RE = re.compile(r"^\s*(?:\*\*[^*]+\*\*\s*)?\.\.\.\s*$")
_BOLD_CELL_RE = re.compile(r"\*\*[^*]+\*\*")
_SEPARATOR_CELL_RE = re.compile(r":?-+:?")
_TABLE_PIPE_RE = re.compile(r"(?<!\\)\|")

_V2_STEP_RE = re.compile(r"^\s*\d+\.\s+\*\*\((\d+\.\d+)\)")
_V2_VERIFY_RE = re.compile(r"\bVerify\b[^:\n]{0,20}:|Expected:")


def _finding_severity(lines: list[str]) -> str:
    """"error" for a `plan/v3` plan, "warning" for every other plan."""
    return "error" if is_v3(parse_frontmatter("\n".join(lines))) else "warning"


def _fence_mask(lines: list[str]) -> list[bool]:
    """True for each line inside a fenced code block, the fence lines included.

    A fence closes on the same character at least as long as the opener, so a
    ``` line inside a ```` block does not end it. An unclosed fence runs to EOF.
    """
    mask: list[bool] = []
    fence: Optional[tuple[str, int]] = None
    for line in lines:
        stripped = line.strip()
        if fence is None:
            opener = _FENCE_OPEN_RE.match(line)
            if opener and not (opener.group(1)[0] == "`" and "`" in opener.group(2)):
                fence = (opener.group(1)[0], len(opener.group(1)))
                mask.append(True)
            else:
                mask.append(False)
        else:
            mask.append(True)
            if stripped and set(stripped) == {fence[0]} and len(stripped) >= fence[1]:
                fence = None
    return mask


def _find_section(lines: list[str], mask: list[bool], title: "re.Pattern[str]", max_level: int) -> Optional[tuple[int, int]]:
    """(heading index, end index) of the first heading whose title matches, ignoring fenced code.

    Only headings of level <= max_level qualify. The section runs to the next
    heading of the same or a shallower level (deeper headings stay inside it).
    """
    headings = [
        (idx, len(m.group(1)), m.group(2))
        for idx, line in enumerate(lines)
        if not mask[idx] and (m := _HEADING_RE.match(line))
    ]
    for pos, (idx, level, text) in enumerate(headings):
        if level <= max_level and title.match(text):
            end = next((j for j, lv, _ in headings[pos + 1 :] if lv <= level), len(lines))
            return idx, end
    return None


def _table_cells(line: str) -> Optional[list[str]]:
    """Cells of a Markdown table row, or None when the line is not one."""
    stripped = line.strip()
    if not stripped.startswith("|") or stripped == "|":
        return None
    inner = stripped[1:-1] if stripped.endswith("|") else stripped[1:]
    return [cell.strip() for cell in _TABLE_PIPE_RE.split(inner)]


def _is_separator_row(cells: list[str]) -> bool:
    """A delimiter row such as `|---|:---:|`: it is not a data row."""
    return all(_SEPARATOR_CELL_RE.fullmatch(cell) for cell in cells)


def _mask_code_spans(lines: list[str], fenced: list[bool], fill: str) -> list[str]:
    """Each line with every inline code span overwritten by `fill`, newlines kept.

    A span can wrap across a line break (`Promise<Foo>` split after "Promise"),
    so spans are matched per paragraph: a run of non-blank lines outside fenced
    blocks. A backtick never pairs with one in another paragraph or past a fence.
    The line count and each line's other characters are unchanged.
    """
    masked = list(lines)
    idx = 0
    while idx < len(lines):
        if fenced[idx] or not lines[idx].strip():
            idx += 1
            continue
        end = idx
        while end < len(lines) and not fenced[end] and lines[end].strip():
            end += 1
        paragraph = _CODE_SPAN_RE.sub(lambda m: "".join("\n" if c == "\n" else fill for c in m.group()), "\n".join(lines[idx:end]))
        masked[idx:end] = paragraph.split("\n")
        idx = end
    return masked


def _placeholder_reasons(text: str, cell_text: str) -> list[str]:
    """What is unfilled on this line (empty list when nothing is).

    `text` is the line with its code spans blanked with spaces; `cell_text` has
    them filled with a letter instead, because code in a table cell still fills it.
    """
    reasons = _FIELD_PLACEHOLDER_RE.findall(text)
    reasons += [
        found
        for found in _ANGLE_PLACEHOLDER_RE.findall(text)
        if not (_AUTOLINK_RE.fullmatch(found) or _EMAIL_RE.fullmatch(found))
    ]
    reasons += _MARKER_RE.findall(text)

    cells = _table_cells(cell_text)
    if cells is not None:
        filled = [cell for cell in cells if cell]
        if not filled or (len(filled) == 1 and cells[0] and _BOLD_CELL_RE.fullmatch(cells[0])):
            reasons.append("empty table row")

    if _ELLIPSIS_LINE_RE.match(text):
        reasons.append("a line that is only '...'")
    if text.lstrip().startswith("> Template:"):
        reasons.append("template guidance line")
    return reasons


def check_placeholders(lines: list[str], report: ValidationReport) -> None:
    """Flag text a plan author was meant to replace: `{{FIELD}}`, `<angle>` slots, TBD/TODO,
    empty table rows, a bare `...` line and `> Template:` guidance.

    Everything outside fenced code blocks and inline code spans is scanned, the
    frontmatter included. One finding per line, at most 10, then "+N more".
    """
    severity = _finding_severity(lines)
    mask = _fence_mask(lines)
    texts = _mask_code_spans(lines, mask, " ")
    cell_texts = _mask_code_spans(lines, mask, "x")
    found = [
        (idx + 1, reasons)
        for idx in range(len(lines))
        if not mask[idx] and (reasons := _placeholder_reasons(texts[idx], cell_texts[idx]))
    ]
    for line_no, reasons in found[:PLACEHOLDER_REPORT_CAP]:
        report.issues.append(
            Issue(
                severity=severity,
                category="placeholder",
                message=f"Unfilled placeholder ({', '.join(reasons)}). Fill it in or delete it.",
                line=line_no,
            )
        )
    if len(found) > PLACEHOLDER_REPORT_CAP:
        report.issues.append(
            Issue(
                severity=severity,
                category="placeholder",
                message=f"+{len(found) - PLACEHOLDER_REPORT_CAP} more unfilled placeholder lines not shown.",
            )
        )


def check_v2_steps(lines: list[str], report: ValidationReport) -> None:
    """Check each `1. **(1.1)** ...` step under `## Ordered steps` for a verification and a file path.

    The older step checks only see `### Step N` headings, so these numbered
    steps were never checked. A step's body runs to the next step or heading.
    """
    mask = _fence_mask(lines)
    section = _find_section(lines, mask, re.compile(r"ordered\s+steps\b", re.IGNORECASE), 2)
    if section is None:
        return
    start, end = section
    severity = _finding_severity(lines)

    steps = [i for i in range(start + 1, end) if not mask[i] and _V2_STEP_RE.match(lines[i])]
    headings = {i for i in range(start + 1, end) if not mask[i] and _HEADING_RE.match(lines[i])}
    stops = sorted(headings | set(steps) | {end})
    for i in steps:
        step_id = _V2_STEP_RE.match(lines[i]).group(1)
        body = "\n".join(lines[i : next(stop for stop in stops if stop > i)])
        if not _V2_VERIFY_RE.search(body):
            report.issues.append(
                Issue(
                    severity=severity,
                    category="verification",
                    message=f"Step {step_id} has no 'Verify:' or 'Expected:' line. Say how to confirm the step worked.",
                    line=i + 1,
                )
            )
        if not FILE_PATH_PATTERN.search(body):
            report.issues.append(
                Issue(
                    severity=severity,
                    category="specificity",
                    message=f"Step {step_id} names no file path. Name the exact file the step touches.",
                    line=i + 1,
                )
            )


def check_traceability_rows(lines: list[str], report: ValidationReport) -> None:
    """A Traceability section that exists must hold at least one data row.

    The header and delimiter rows and rows with every cell empty do not count.
    A missing section is `check_traceability_table`'s finding, not this one's.
    """
    mask = _fence_mask(lines)
    section = _find_section(lines, mask, re.compile(r"traceability\b", re.IGNORECASE), 3)
    if section is None:
        return
    start, end = section
    rows = [cells for i in range(start + 1, end) if not mask[i] and (cells := _table_cells(lines[i])) is not None]
    for pos, cells in enumerate(rows):
        is_header = pos + 1 < len(rows) and _is_separator_row(rows[pos + 1])
        if not is_header and not _is_separator_row(cells) and any(cells):
            return
    report.issues.append(
        Issue(
            severity=_finding_severity(lines),
            category="traceability",
            message=(
                "Traceability section has no table data rows. Add one row per discovery finding "
                "(Discovery finding | Plan step), or say why a finding is out of scope."
            ),
            line=start + 1,
        )
    )


# ---------------------------------------------------------------------------
# Approval card (plan/v3)
#
# A v3 plan opens with a Brief written as the approval card: six labelled
# fields, questions first. `card.py` prints the Brief verbatim between an ask
# line and a footer, so the Brief is what the user approves. parse_card reads
# it, parse_dlines reads the plan's D-lines, and check_card enforces the
# grammar and the word budgets. Every finding has a stable `rule` id.
# ---------------------------------------------------------------------------

CARD_LABELS = (
    "**Needs your call:**",
    "**Ships as:**",
    "**Delivers:**",
    "**Size:**",
    "**Made for you:**",
    "**Flags:**",
)
NEEDS_LABEL, SHIPS_LABEL, DELIVERS_LABEL, SIZE_LABEL, MADE_LABEL, FLAGS_LABEL = CARD_LABELS
CARD_FLAGS = ("auth", "payments", "migration", "delete", "external-contract", "prod-infra")

CARD_MAX_WORDS = 120
CHECK_TIME_WORDS = 4  # " (remote checked MM-DD HH:MM)", which the renderer adds to the Ships-as line
CARD_QUESTIONS_END_BY_WORD = 60
CARD_MAX_QUESTIONS = 3  # not counting Run
CARD_MAX_MADE = 3
CARD_ITEM_MAX_WORDS = 20  # each question and each Made-for-you item
CARD_DELIVERS_MAX_WORDS = 25
# The word budgets limit what the renderer shows for approval. Once the plan is approved the Brief is
# frozen, and `approve` has added `you: <answer>` to it, which can push it over; so they stop applying.
CARD_PAST_APPROVAL_STATUSES = ("approved", "in-progress", "complete")
_WORD_BUDGET_RULES = frozenset({"question_over_20_words", "made_over_20_words"})

_QUESTION_RE = re.compile(r"^(\d+)\. (.+\?) → \*\*(.+?)\*\* \((.+); if wrong: (.+)\)$")
_RUN_RE = re.compile(r"^(\d+)\. Run → \*\*(.+?)\*\* \((.+); or (subagent-driven|inline)\)$")
_MADE_RE = re.compile(r"^- (D\d+) (.+) \(if wrong: (.+)\)$")
_DELIVERS_RE = re.compile(r"^An? .+ can .+")
_DELIVERS_FOUNDATION = "None user-visible: foundation for"
_SIZE_PARTS = (
    ("a line count such as '~430 lines'", re.compile(r"~?[\d,]+ lines\b")),
    ("a file count such as '9 files'", re.compile(r"\d+ files?\b")),
    ("a PR count such as '1 PR'", re.compile(r"\d+ PRs?\b")),
)
_NUMBERED_RE = re.compile(r"^\d+\. ")
_DLINE_RE = re.compile(r"^- (D\d+) \[(ask|made|made, one-way|you: [^\]]+)\] (.+)$")
_DLINE_START_RE = re.compile(r"^- D\d+\b")
_ASK_BODY_RE = re.compile(r"^(.+?\?) Default: (.+?)\. Why: (.+?)\. If wrong: (.+)\.$")
_TITLE_RE = re.compile(r"^#\s+PLAN\s*[:—-]\s*(.+)$")
_GLOBAL_CONSTRAINTS_RE = re.compile(r"global\s+constraints\b", re.IGNORECASE)
_ANSWER_PREFIX = "you: "


class Question(NamedTuple):
    """One numbered line under "Needs your call".

    default: the bold text, or the user's answer once it reads `**you: <answer>**`.
    For Run (text "Run"), `cost` holds the other option from "or <other>".
    line: 1-indexed file line.
    """

    n: int
    text: str
    default: str
    reason: str
    cost: str
    is_run: bool
    answered: bool
    line: int = 0


class CardField(NamedTuple):
    """A card label's line number (1-indexed) and the text after the label on that line."""

    line: int
    text: str


class Card(NamedTuple):
    """A plan's Brief read as an approval card.

    made: (D-id, choice, cost) per Made-for-you item.
    fields: label -> CardField, in the order the labels appear. Text is normalized
        (`->` read as `→`); brief_text is verbatim.
    brief_text: the Brief's lines, joined by newlines: non-blank, not starting `>`,
        up to a `---` line or the next heading of level 1 or 2.
    brief_start: 1-indexed line of the `## Brief` heading; 0 when there is none.
    """

    questions: list[Question]
    made: list[tuple[str, str, str]]
    fields: dict[str, CardField]
    brief_text: str
    brief_start: int


class DLine(NamedTuple):
    """A `- D<n> [<tag>] <body>` line in `## Global Constraints`.

    tag: "ask", "made", "made, one-way" or "you: <answer>".
    text: everything after the tag.
    default: the `Default:` value of an [ask] or [you:] line, else "".
    line: 1-indexed file line.
    """

    tag: str
    text: str
    default: str
    line: int = 0


class _CardProblem(NamedTuple):
    line: int
    rule: str
    message: str


def _words(text: str) -> int:
    """A word is a whitespace token that contains a word character."""
    return sum(1 for token in text.split() if re.search(r"\w", token))


def plan_title(lines: list[str]) -> Optional[str]:
    """The title from the first `# PLAN: <title>` line outside fenced code, or None."""
    mask = _fence_mask(lines)
    for idx in range(parse_frontmatter("\n".join(lines)).end_line, len(lines)):
        match = None if mask[idx] else _TITLE_RE.match(lines[idx].rstrip())
        if match:
            return match.group(1).strip()
    return None


def ask_line(title: str) -> str:
    """The first line of the rendered card; it counts against the word budget."""
    return f'**Approve "{title}"?** Reply go to take every default, or answer by number.'


def _brief_lines(lines: list[str]) -> tuple[int, list[tuple[int, str]], bool]:
    """(1-indexed `## Brief` line, [(1-indexed line, text)], whether it is the first `##` section).

    (0, [], False) when the plan has no Brief. Headings in fenced code and in
    the frontmatter do not count. The entries are the Brief's card lines.
    """
    mask = _fence_mask(lines)
    h2 = []
    for idx in range(parse_frontmatter("\n".join(lines)).end_line, len(lines)):
        heading = None if mask[idx] else _HEADING_RE.match(lines[idx])
        if heading and len(heading.group(1)) == 2:
            h2.append((idx, heading.group(2).strip().lower()))
    brief = next((idx for idx, title in h2 if title == "brief"), None)
    if brief is None:
        return 0, [], False

    entries = []
    for idx in range(brief + 1, len(lines)):
        stripped = lines[idx].strip()
        heading = None if mask[idx] else _HEADING_RE.match(lines[idx])
        if stripped == "---" or (heading and len(heading.group(1)) <= 2):
            break
        if stripped and not stripped.startswith(">"):
            entries.append((idx + 1, lines[idx].rstrip()))
    return brief + 1, entries, h2[0][0] == brief


def _scan_card(lines: list[str]) -> tuple[Card, list[_CardProblem], list[tuple[int, str]], bool]:
    """Read the Brief: (card, format and per-item budget findings, the Brief's lines, Brief is first)."""
    brief_start, entries, is_first = _brief_lines(lines)
    fields: dict[str, CardField] = {}
    content: dict[str, list[tuple[int, str]]] = {NEEDS_LABEL: [], MADE_LABEL: []}
    current = None
    for line_no, raw in entries:
        text = raw.replace("->", "→")
        label = next((lab for lab in CARD_LABELS if text.startswith(lab)), None)
        if label is None:
            if current in content:
                content[current].append((line_no, text))
            continue
        current = label
        value = text[len(label) :].strip()
        fields.setdefault(label, CardField(line_no, value))
        if label in content and value:
            content[label].append((line_no, value))

    problems: list[_CardProblem] = []
    questions: list[Question] = []
    for line_no, text in content[NEEDS_LABEL]:
        run = _RUN_RE.match(text)
        match = run or _QUESTION_RE.match(text)
        if match is None:
            problems.append(
                _CardProblem(
                    line_no,
                    "question_format",
                    f"Cannot read this question: {text!r}. Write 'N. <question>? → **<default>** (<reason>; if wrong: <cost>)', "
                    "and 'N. Run → **<subagent-driven|inline>** (<reason>; or <other>)' last.",
                )
            )
            continue
        bold = match.group(3 if not run else 2)
        answered = bold.startswith(_ANSWER_PREFIX)
        questions.append(
            Question(
                n=int(match.group(1)),
                text="Run" if run else match.group(2),
                default=bold[len(_ANSWER_PREFIX) :] if answered else bold,
                reason=match.group(3) if run else match.group(4),
                cost=match.group(4) if run else match.group(5),
                is_run=bool(run),
                answered=answered,
                line=line_no,
            )
        )
        if _words(text) > CARD_ITEM_MAX_WORDS:
            problems.append(
                _CardProblem(
                    line_no,
                    "question_over_20_words",
                    f"Question {match.group(1)} is {_words(text)} words; each is at most {CARD_ITEM_MAX_WORDS}. Shorten it.",
                )
            )

    made: list[tuple[str, str, str]] = []
    for line_no, text in content[MADE_LABEL]:
        match = _MADE_RE.match(text)
        if match:
            made.append(match.groups())
            if _words(text) > CARD_ITEM_MAX_WORDS:
                problems.append(
                    _CardProblem(
                        line_no,
                        "made_over_20_words",
                        f"Made-for-you item {match.group(1)} is {_words(text)} words; "
                        f"each is at most {CARD_ITEM_MAX_WORDS}. Shorten it.",
                    )
                )
        elif text != "None.":
            problems.append(
                _CardProblem(
                    line_no,
                    "made_for_you_format",
                    f"Cannot read this Made-for-you item: {text!r}. Write '- D<n> <choice> (if wrong: <cost>)'.",
                )
            )
    if MADE_LABEL in fields and not content[MADE_LABEL]:
        problems.append(
            _CardProblem(
                fields[MADE_LABEL].line,
                "made_for_you_format",
                "Made for you is empty. List the items, or write the line 'None.'.",
            )
        )

    card = Card(questions, made, fields, "\n".join(raw for _, raw in entries), brief_start)
    return card, problems, entries, is_first


def parse_card(lines: list[str]) -> Card:
    """Read a plan's Brief as an approval card. This is the one card parser; card.py imports it."""
    return _scan_card(lines)[0]


def _scan_dlines(lines: list[str]) -> tuple[bool, dict[str, DLine], list[_CardProblem]]:
    """(has `## Global Constraints`, its D-lines, D-lines that do not parse)."""
    mask = _fence_mask(lines)
    section = _find_section(lines, mask, _GLOBAL_CONSTRAINTS_RE, 2)
    if section is None:
        return False, {}, []
    dlines: dict[str, DLine] = {}
    problems: list[_CardProblem] = []
    for idx in range(section[0] + 1, section[1]):
        line = lines[idx].rstrip()
        if mask[idx] or not _DLINE_START_RE.match(line):
            continue
        match = _DLINE_RE.match(line)
        if match is None:
            problems.append(
                _CardProblem(
                    idx + 1,
                    "dline_format",
                    f"Cannot read this D-line: {line!r}. Write '- D<n> [ask|made|made, one-way] <text>'.",
                )
            )
            continue
        did, tag, body = match.groups()
        default = ""
        if tag == "ask" or tag.startswith(_ANSWER_PREFIX):
            ask = _ASK_BODY_RE.match(body)
            if ask:
                default = ask.group(2)
            else:
                problems.append(
                    _CardProblem(idx + 1, "dline_format", f"{did} must read '<question>? Default: <d>. Why: <w>. If wrong: <c>.'")
                )
        dlines[did] = DLine(tag, body, default, idx + 1)
    return True, dlines, problems


def parse_dlines(lines: list[str]) -> dict[str, DLine]:
    """The D-lines in `## Global Constraints`, by D-id."""
    return _scan_dlines(lines)[1]


def check_card(lines: list[str], report: ValidationReport) -> None:
    """Check a `plan/v3` Brief against the card grammar, the word budgets and the D-lines.

    Every finding is an error with category "card" and a stable rule id. None
    touches the score: a v3 plan is blocked by the error severity alone.

    The word budgets (the card total, the questions-by-word-60 limit and the per-item
    caps) are render-time limits. They stop applying once the status is approved,
    in-progress or complete, so a plan keeps validating however long the user's answers
    made the frozen Brief (DESIGN 3.3, R1). Every other card rule still applies.
    """

    def error(rule: str, message: str, line: int = 0) -> None:
        report.issues.append(Issue(severity="error", category="card", message=message, line=line, rule=rule))

    budgets = parse_frontmatter("\n".join(lines)).data.get("status") not in CARD_PAST_APPROVAL_STATUSES
    card, problems, entries, is_first = _scan_card(lines)
    if not budgets:
        problems = [problem for problem in problems if problem.rule not in _WORD_BUDGET_RULES]
    has_constraints, dlines, dline_problems = _scan_dlines(lines)
    if not has_constraints:
        error(
            "global_constraints_missing",
            "No '## Global Constraints' section. Record each [ask] and [made] decision there as a D-line.",
        )
    for problem in dline_problems:
        error(problem.rule, problem.message, problem.line)

    if card.brief_start == 0:
        error("brief_missing", "No '## Brief' section. A v3 plan opens with a Brief written as the approval card.")
        return
    if not is_first:
        error("brief_not_first", "Brief must be the first section (first '##' heading) of the plan.", card.brief_start)

    title = plan_title(lines)
    if title is None:
        error("title_missing", "No '# PLAN: <title>' line. The card's ask line is built from the title.")

    # Grammar: every label, once, in order
    for label in CARD_LABELS:
        if label not in card.fields:
            error("missing_label", f"Brief is missing the label {label}", card.brief_start)
    present = [label for label in CARD_LABELS if label in card.fields]
    written = sorted(card.fields, key=lambda label: card.fields[label].line)
    if written != present:
        error("label_order", f"Brief labels are out of order. Use: {', '.join(present)}", card.fields[written[0]].line)

    for problem in problems:
        error(problem.rule, problem.message, problem.line)

    # Questions: at most 3 plus Run, and Run last
    plain = [q for q in card.questions if not q.is_run]
    if len(plain) > CARD_MAX_QUESTIONS:
        error(
            "four_questions",
            f"{len(plain)} questions plus Run; the card takes at most {CARD_MAX_QUESTIONS}. "
            "More means the design is unsettled: decide some, or go back to brainstorming.",
            plain[CARD_MAX_QUESTIONS].line,
        )
    first_run = next((q.line for q in card.questions if q.is_run), 0)
    if not first_run:
        # An unreadable numbered line may be the Run itself; question_format already reports it
        unreadable = any(problem.rule == "question_format" for problem in problems)
        needs = card.fields.get(NEEDS_LABEL)
        if not unreadable:
            error(
                "run_not_last",
                "The card has no Run item. End the numbered list with "
                "'N. Run → **<subagent-driven|inline>** (<reason>; or <other>)'; Run must be the last numbered item.",
                card.questions[-1].line if card.questions else needs.line if needs else card.brief_start,
            )
    elif card.questions[-1].line != first_run:
        error("run_not_last", "Run must be the last numbered item, and appear once.", first_run)

    # Fields
    if len(card.made) > CARD_MAX_MADE:
        error(
            "four_made",
            f"{len(card.made)} Made-for-you items; the card takes at most {CARD_MAX_MADE}. Keep the costliest.",
            card.fields[MADE_LABEL].line,
        )

    delivers = card.fields.get(DELIVERS_LABEL)
    if delivers:
        if not (_DELIVERS_RE.match(delivers.text) or delivers.text.startswith(_DELIVERS_FOUNDATION)):
            error(
                "delivers_not_user_action",
                f"Delivers must say what a user can do ('A <user> can <action>.'), or start '{_DELIVERS_FOUNDATION} <X>'.",
                delivers.line,
            )
        if budgets and _words(delivers.text) > CARD_DELIVERS_MAX_WORDS:
            error(
                "delivers_over_25_words",
                f"Delivers is {_words(delivers.text)} words; the limit is {CARD_DELIVERS_MAX_WORDS}.",
                delivers.line,
            )

    size = card.fields.get(SIZE_LABEL)
    if size:
        missing = [what for what, pattern in _SIZE_PARTS if not pattern.search(size.text)]
        if missing:
            error("size_without_counts", f"Size must give counts, not adjectives. Missing {'; '.join(missing)}.", size.line)

    flags = card.fields.get(FLAGS_LABEL)
    if flags and flags.text != "none":
        unknown = [flag for flag in (item.strip() for item in flags.text.split(",")) if flag not in CARD_FLAGS]
        if unknown:
            error(
                "unknown_flag",
                f"Unknown flag {', '.join(repr(flag) for flag in unknown)}. Use 'none' or a comma list of: {', '.join(CARD_FLAGS)}.",
                flags.line,
            )

    # The Brief is read as plain language, and the renderer adds the check time itself
    if "`" in card.brief_text:
        error("backticks_in_brief", "Brief must be plain language: no code or backticks.", card.brief_start)
    if BRIEF_STEP_REF.search(card.brief_text):
        error("step_ref_in_brief", "Brief must be plain language: no step numbers.", card.brief_start)
    if "remote checked" in card.brief_text.lower():
        ships = card.fields.get(SHIPS_LABEL)
        error(
            "remote_checked_in_brief",
            "Brief must not contain 'remote checked'; the renderer adds the check time to the Ships-as line.",
            ships.line if ships else card.brief_start,
        )

    # Budgets: ask line + Brief + the check time the renderer adds
    ask_words = _words(ask_line(title or ""))
    total = ask_words + sum(_words(text) for _, text in entries) + CHECK_TIME_WORDS
    if budgets and total > CARD_MAX_WORDS:
        error(
            "card_over_120_words",
            f"Card is {total} words; the budget is {CARD_MAX_WORDS} "
            f"(ask line, Brief and the {CHECK_TIME_WORDS}-word check time added at render). Cut it.",
            card.brief_start,
        )
    position, last_question_end, last_question_line = ask_words, 0, 0
    for line_no, text in entries:
        position += _words(text)
        if _NUMBERED_RE.match(text):
            last_question_end, last_question_line = position, line_no
    if budgets and last_question_end > CARD_QUESTIONS_END_BY_WORD:
        error(
            "questions_after_word_60",
            f"The questions end at word {last_question_end}; they must end by word {CARD_QUESTIONS_END_BY_WORD}. "
            "Shorten them, or move words to Size.",
            last_question_line,
        )

    # D-lines
    ask_dlines = {}
    for did, dline in dlines.items():
        if dline.tag == "ask" or dline.tag.startswith(_ANSWER_PREFIX):
            ask = _ASK_BODY_RE.match(dline.text)
            if ask:
                ask_dlines.setdefault(ask.group(1), (did, dline))
    question_texts = {q.text for q in plain}
    for question, (did, dline) in ask_dlines.items():
        if dline.tag == "ask" and question not in question_texts:
            error("ask_without_question", f"{did} is an [ask] but the card has no question {question!r}.", dline.line)
    for q in plain:
        found = ask_dlines.get(q.text)
        if found is None:
            error("question_without_ask", f"Question {q.n} ({q.text!r}) has no [ask] D-line in Global Constraints.", q.line)
            continue
        did, dline = found
        answered = q.answered or dline.tag.startswith(_ANSWER_PREFIX)
        if not answered and dline.default != q.default:
            error(
                "dline_default_mismatch",
                f"{did} says Default: {dline.default}, but the card's default is {q.default}.",
                dline.line,
            )

    for did, dline in dlines.items():
        if dline.tag == "made, one-way":
            error("one_way_made", f"{did} is one-way, so the user decides it: make it an [ask].", dline.line)
        if dline.tag.startswith("made") and "Conflicts:" in dline.text:
            error(
                "conflicts_made",
                f"{did} conflicts with a standing rule, so the user decides it: make it an [ask].",
                dline.line,
            )
    for did, _, _ in card.made:
        if did not in dlines or not dlines[did].tag.startswith("made"):
            error(
                "made_for_you_unknown_did",
                f"Made for you lists {did}, but Global Constraints has no [made] D-line {did}.",
                card.fields[MADE_LABEL].line,
            )


# ---------------------------------------------------------------------------
# Delivery (plan/v3)
#
# A v3 plan's frontmatter lists where its work ships: one block-list item per
# repo. check_delivery reads the list, checks the card's Ships-as and Size
# lines against it, and scans the prose for wording that says "local only".
# With probe=True it also looks at each repo with git, so a plan cannot name a
# remote that is not there or say "no PR" about a repo whose history shows PRs
# (G1-03). Every finding is an error with category "delivery" and a stable
# `rule` id, and none touches the score.
# ---------------------------------------------------------------------------

DELIVERY_KEYS = ("repo", "mode", "branch", "base", "remote", "prs")
DELIVERY_MODES = ("pr", "stack", "local-only")
# S1's session parser reads frontmatter flat, so a delivery key with one of these names
# would be taken for the plan's own.
DELIVERY_RESERVED_KEYS = ("status", "schema", "session_id")
PROBE_TIMEOUT_SECONDS = 5
_PROBE_ENV_DROPPED = ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE")
_NOT_A_WORK_TREE = "not a git work tree"  # starts RemoteState.error when git ran and refused the directory

_PR_SUBJECT_RE = re.compile(r"\(#\d+\)")
_LOCAL_ONLY_PHRASE_RE = re.compile(
    r"\bno PRs?\b(?!\s+(?:template|title|body|description|number|comment))"
    r"|\blocal[- ]only\b"
    r"|\bno remote\b(?=\s*(?:$|[,.;)]|exists|configured|repo))"
    r"|\bmerged?\s+(?:\S+\s+){0,3}?locally\b",
    re.IGNORECASE,
)
_LOCAL_WORD_RE = re.compile(r"\blocal\b", re.IGNORECASE)
_SIZE_PRS_RE = re.compile(r"(\d+) PRs?\b")
_WHOLE_NUMBER_RE = re.compile(r"\d+")


class RemoteState(NamedTuple):
    """What git says about a delivery repo.

    remotes: the remote names from `git remote -v`, in order.
    pr_subjects: the subjects among the last 5 commits that carry a PR number, like `feat: x (#12)`.
    error: why git could not read the repo, else None. "not a git work tree: ..." when git ran and
        refused the directory; "could not run git: ..." when git is missing or timed out.
    """

    remotes: list[str]
    pr_subjects: list[str]
    error: Optional[str] = None


class _Delivery(NamedTuple):
    """One `delivery` item that passed every check that needs no git. line is its 1-indexed file line."""

    repo: str
    mode: str
    branch: str
    base: str
    remote: str
    prs: int
    line: int


def _run_git(repo: str, *args: str) -> "subprocess.CompletedProcess[str]":
    """`git -C repo <args>` with a timeout, without the GIT_* variables that would point git at another repo."""
    env = {key: value for key, value in os.environ.items() if key not in _PROBE_ENV_DROPPED}
    return subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=PROBE_TIMEOUT_SECONDS,
        env=env,
        check=False,
    )


def probe_remote(repo: "str | Path") -> RemoteState:
    """Ask git, live, which remotes a delivery repo has and whether its recent commits came through PRs.

    Runs `git -C repo remote -v` and `git -C repo log -5 --format=%s`, each with a 5 s timeout and with
    GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE removed, so a caller's repo (a git hook's, say) is never
    the one probed. A repo with no commits makes `git log` exit 128; that is an empty history, so
    pr_subjects is [] and error stays None.
    """
    path = str(repo)
    try:
        listing = _run_git(path, "remote", "-v")
        if listing.returncode != 0:
            reason = (listing.stderr.strip().splitlines() or ["no message"])[0]
            return RemoteState([], [], f"{_NOT_A_WORK_TREE}: {reason}")
        log = _run_git(path, "log", "-5", "--format=%s")
    except (OSError, subprocess.SubprocessError) as exc:
        return RemoteState([], [], f"could not run git: {exc}")

    remotes = list(dict.fromkeys(line.split()[0] for line in listing.stdout.splitlines() if line.split()))
    if log.returncode == 128:
        return RemoteState(remotes, [], None)
    if log.returncode != 0:
        reason = (log.stderr.strip().splitlines() or ["no message"])[0]
        return RemoteState(remotes, [], f"git log failed: {reason}")
    return RemoteState(remotes, [s for s in log.stdout.splitlines() if _PR_SUBJECT_RE.search(s)], None)


def _delivery_lines(lines: list[str], end_line: int) -> tuple[int, list[int]]:
    """1-indexed lines of the frontmatter's `delivery:` key and of each `- ` item under it; (0, []) when absent."""
    key = next((idx for idx in range(1, max(end_line - 1, 1)) if lines[idx].startswith("delivery:")), None)
    if key is None:
        return 0, []
    items: list[int] = []
    for idx in range(key + 1, end_line - 1):
        if _DASH_RE.match(lines[idx].rstrip()):
            items.append(idx + 1)
        elif lines[idx].strip() and not lines[idx][0].isspace() and not lines[idx].startswith("#"):
            break  # the next top-level key
    return key + 1, items


def _read_delivery_item(
    item: dict[str, Any], n: int, line: int, error: Callable[[str, str, int], None]
) -> Optional[_Delivery]:
    """Check one `delivery` item for everything that needs no git; None when anything is wrong.

    Reports every problem it finds in the item through error(rule, message, line), so one run
    shows them all.
    """
    problems = 0

    def fail(rule: str, message: str) -> None:
        nonlocal problems
        problems += 1
        error(rule, f"Delivery item {n}: {message}", line)

    def text(key: str) -> str:
        value = item.get(key)
        return value.strip() if isinstance(value, str) else ""

    unknown = [key for key in item if key not in DELIVERY_KEYS]
    if unknown:
        hint = ""
        if any(key in DELIVERY_RESERVED_KEYS for key in unknown):
            hint = " The session parser reads frontmatter flat, so it would take that key for the plan's own."
        fail("delivery_unknown_key", f"unknown key {', '.join(repr(k) for k in unknown)}; use only {', '.join(DELIVERY_KEYS)}.{hint}")
    missing = [key for key in DELIVERY_KEYS if key != "prs" and not text(key)]
    if missing:
        fail("delivery_missing_key", f"missing or empty {', '.join(repr(k) for k in missing)}.")

    mode = text("mode")
    if mode and mode not in DELIVERY_MODES:
        fail("delivery_bad_mode", f"mode '{mode}' is not one of {', '.join(DELIVERY_MODES)}.")

    repo = text("repo")
    if repo:
        path = Path(repo)
        if not path.is_absolute():
            fail("delivery_repo_path", f"repo '{repo}' is not an absolute path.")
        elif not path.exists():
            fail("delivery_repo_path", f"repo '{repo}' does not exist.")
        elif not path.is_dir():
            fail("delivery_repo_path", f"repo '{repo}' is not a directory.")

    if text("remote") == "none" and mode in ("pr", "stack"):
        fail("delivery_remote_absent", f"mode {mode} pushes to a remote, so 'remote: none' cannot be right; name one (git remote -v lists them).")

    prs = item.get("prs")
    count = 1 if mode == "pr" else 0
    if prs is None:
        if mode == "stack":
            fail("delivery_prs", "a stack must say how many PRs it has: 'prs: N', with N at least 2.")
    elif not (isinstance(prs, str) and _WHOLE_NUMBER_RE.fullmatch(prs)):
        fail("delivery_prs", f"prs must be a whole number, not {prs!r}.")
    else:
        count = int(prs)
        if mode == "stack" and count < 2:
            fail("delivery_prs", f"a stack's prs must be at least 2, not {count}; use mode: pr for one PR.")

    if problems:
        return None
    return _Delivery(repo, mode, text("branch"), text("base"), text("remote"), count, line)


def _ships_phrase(delivery: _Delivery) -> str:
    """The text the card's Ships-as line must contain for this delivery."""
    if delivery.mode == "pr":
        return f"1 PR, {delivery.branch} → {delivery.remote}/{delivery.base}"
    if delivery.mode == "stack":
        return f"{delivery.prs}-PR stack, {delivery.branch} → {delivery.remote}/{delivery.base}"
    return f"local only, no PR, {delivery.branch}"


def _local_only_phrase_hits(lines: list[str], body_start: int) -> list[tuple[int, str]]:
    """(1-indexed line, matched text) for each body line that reads as local-only wording.

    Fenced code blocks and inline code spans are ignored. The frontmatter is data and is not scanned.
    """
    body = lines[body_start:]
    fenced = _fence_mask(body)
    texts = _mask_code_spans(body, fenced, " ")
    hits = []
    for idx, text in enumerate(texts):
        match = None if fenced[idx] else _LOCAL_ONLY_PHRASE_RE.search(text)
        if match:
            hits.append((body_start + idx + 1, match.group()))
    return hits


def check_delivery(lines: list[str], report: ValidationReport, probe: bool = True) -> None:
    """Check a `plan/v3` plan's `delivery` list, the card lines that describe it, and the local-only wording.

    - The list must be a block list of items with exactly the keys repo, mode, branch, base, remote and prs.
    - The card's Ships-as line must contain each delivery's phrase (`_ships_phrase`), and Size's PR count
      must equal the sum of the deliveries' prs.
    - Prose that reads as local-only needs a delivery with mode: local-only (G1-03).
    - With probe=True each repo is read with git: it must be a git work tree (a local-only delivery with
      remote: none may be a plain directory), a pr or stack remote must exist in it, and a local-only
      delivery in a repo that has a remote or PR-style commits needs a numbered question that says "local".
    """

    def error(rule: str, message: str, line: int = 0) -> None:
        report.issues.append(Issue(severity="error", category="delivery", message=message, line=line, rule=rule))

    fm = parse_frontmatter("\n".join(lines))
    key_line, item_lines = _delivery_lines(lines, fm.end_line)
    raw = fm.data.get("delivery")
    items: list[dict[str, Any]] = []
    if not raw:
        error(
            "delivery_missing",
            "No 'delivery:' list in the frontmatter. List each repo as a block item: "
            "'- repo: <absolute path>' with mode, branch, base, remote and prs.",
        )
    elif not isinstance(raw, list) or not all(isinstance(item, dict) for item in raw):
        error(
            "delivery_flow_style",
            "delivery must be a block-style list: one '- repo: <absolute path>' item per repo, "
            "each followed by its mode, branch, base, remote and prs lines.",
            key_line,
        )
    else:
        items = raw

    deliveries = [
        found
        for n, item in enumerate(items, 1)
        if (found := _read_delivery_item(item, n, item_lines[n - 1] if n <= len(item_lines) else key_line, error))
    ]
    card = parse_card(lines)

    if probe:
        asked_local = any(_LOCAL_WORD_RE.search(q.text) for q in card.questions if not q.is_run)
        for found in deliveries:
            state = probe_remote(found.repo)
            if state.error:
                # A plain directory is fine for local-only with remote: none; a git that cannot run is not
                plain_dir = found.mode == "local-only" and found.remote == "none" and state.error.startswith(_NOT_A_WORK_TREE)
                if not plain_dir:
                    error(
                        "delivery_repo_not_git",
                        f"Delivery repo {found.repo}: {state.error}. A delivery needs a git work tree; "
                        "only mode: local-only with remote: none may point at a plain directory.",
                        found.line,
                    )
            elif found.mode != "local-only":
                if found.remote not in state.remotes:
                    have = f"it has {', '.join(state.remotes)}" if state.remotes else "it has no remote"
                    error(
                        "delivery_remote_absent",
                        f"Delivery repo {found.repo} has no remote named '{found.remote}' ({have}). "
                        "Name a remote that git remote -v lists.",
                        found.line,
                    )
            elif (state.remotes or state.pr_subjects) and not asked_local:
                seen = [f"remote {', '.join(state.remotes)}"] if state.remotes else []
                seen += [f"commits that came through PRs, like '{state.pr_subjects[0]}'"] if state.pr_subjects else []
                error(
                    "local_only_without_question",
                    f"Delivery repo {found.repo} ships local only, but it has {' and '.join(seen)}. "
                    "A repo that can reach a PR needs the user's say-so: ask it as a numbered question that "
                    "says 'local' (with its [ask] D-line), for example 'Keep this local only, no PR?'.",
                    found.line,
                )

    if deliveries and len(deliveries) == len(items):
        ships = card.fields.get(SHIPS_LABEL)
        if ships:
            for found in deliveries:
                phrase = _ships_phrase(found)
                # Not inside a longer name: "feat/share" is not "feat/share-link", "2-PR" is not "12-PR"
                if not re.search(rf"(?<![\w-]){re.escape(phrase)}(?![\w/-])", ships.text):
                    error(
                        "ships_as_mismatch",
                        f"Ships as must say '{phrase}' for {found.repo}; it says '{ships.text}'.",
                        ships.line,
                    )
        size = card.fields.get(SIZE_LABEL)
        counted = _SIZE_PRS_RE.search(size.text) if size else None
        total = sum(found.prs for found in deliveries)
        if size and counted and int(counted.group(1)) != total:
            error(
                "size_pr_count_mismatch",
                f"Size says {counted.group()} but the deliveries' prs add up to {total}.",
                size.line,
            )

    if not any(item.get("mode") == "local-only" for item in items):
        for line_no, phrase in _local_only_phrase_hits(lines, fm.end_line):
            error(
                "local_only_phrase",
                f"The plan says '{phrase}' but no delivery has mode: local-only. If this work ships without a PR, "
                "set 'mode: local-only' (and 'remote: none') on that delivery; otherwise reword the line.",
                line_no,
            )


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------


def render_text(report: ValidationReport, verbose: bool = False) -> str:
    """Render the validation report as human-readable text."""
    out = []
    status = "PASS" if report.passed else "NEEDS WORK"
    out.append(f"{'=' * 60}")
    out.append(f"Plan Validation: {status}")
    out.append(f"File: {report.path}")
    out.append(f"Score: {max(0, report.score)}/100")
    out.append(f"{'=' * 60}")

    if report.errors:
        out.append(f"\nERRORS ({len(report.errors)}):")
        for issue in report.errors:
            loc = f" [line {issue.line}]" if issue.line else ""
            out.append(f"  [ERROR] [{issue.category}] ({issue.audience}){loc} {issue.message}")

    if report.warnings:
        out.append(f"\nWARNINGS ({len(report.warnings)}):")
        for issue in report.warnings:
            loc = f" [line {issue.line}]" if issue.line else ""
            out.append(f"  [WARN]  [{issue.category}] ({issue.audience}){loc} {issue.message}")

    infos = [i for i in report.issues if i.severity == "info"]
    if verbose and infos:
        out.append(f"\nINFO ({len(infos)}):")
        for issue in infos:
            out.append(f"  [INFO]  [{issue.category}] ({issue.audience}) {issue.message}")

    if not report.issues:
        out.append("\nNo issues found.")

    return "\n".join(out)


def render_json(report: ValidationReport) -> str:
    """Render the validation report as JSON."""
    data = {
        "path": report.path,
        "passed": report.passed,
        "score": max(0, report.score),
        "issues": [
            {
                "severity": i.severity,
                "category": i.category,
                "audience": i.audience,
                "message": i.message,
                "line": i.line or None,
            }
            for i in report.issues
        ],
        "error_count": len(report.errors),
        "warning_count": len(report.warnings),
    }
    return json.dumps(data, indent=2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def validate_plan(path: Path, probe: bool = True) -> ValidationReport:
    """Run all checks on a plan file and return the aggregated report.

    probe: whether check_delivery reads each v3 delivery repo with git (the CLI
    default). The static delivery checks run either way; legacy plans never probe.
    """
    report = ValidationReport(path=str(path))

    if not path.exists():
        report.issues.append(
            Issue(severity="error", category="io", message=f"File not found: {path}")
        )
        report.score = 0
        return report

    if not path.is_file():
        report.issues.append(
            Issue(severity="error", category="io", message=f"Path is not a file: {path}")
        )
        report.score = 0
        return report

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as exc:
        report.issues.append(
            Issue(severity="error", category="io", message=f"Cannot read file: {exc}")
        )
        report.score = 0
        return report

    lines = content.splitlines()

    fm = parse_frontmatter(content)
    check_schema(fm, report)

    check_target_repos(lines, report)
    check_files_to_modify(lines, report)
    check_ordered_steps(lines, report)
    check_steps_reference_files(lines, report)
    check_risks_section(lines, report)
    check_verification_section(lines, report)
    check_vague_language(lines, report)
    check_oversized_code_blocks(lines, report)
    check_scope_boundary(lines, report)
    check_traceability_table(lines, report)
    check_testable_outcomes(lines, report)
    check_step_file_specificity(lines, report)
    check_per_step_verification(lines, report)
    check_structure_section(lines, report)
    check_pr_size_estimate(lines, report)
    check_git_branch(lines, report)
    check_git_commit_plan(lines, report)
    if is_v3(fm):
        check_card(lines, report)
        check_delivery(lines, report, probe)
    else:
        check_brief(lines, report)
    check_placeholders(lines, report)
    check_v2_steps(lines, report)
    check_traceability_rows(lines, report)

    report.score = max(0, report.score)
    return report


def main() -> int:
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Validate an implementation plan for structural completeness and actionability.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("plan_path", help="Path to the PLAN.md file")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show additional detail")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    path = Path(args.plan_path)
    report = validate_plan(path)

    if args.json:
        print(render_json(report))
    else:
        print(render_text(report, verbose=args.verbose))

    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
