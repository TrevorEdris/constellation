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
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NamedTuple, Optional


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
_CODE_SPAN_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)")

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


def _placeholder_reasons(line: str) -> list[str]:
    """What is unfilled on this line (empty list when nothing is)."""
    text = _CODE_SPAN_RE.sub(" ", line)
    reasons = _FIELD_PLACEHOLDER_RE.findall(text)
    reasons += [
        found
        for found in _ANGLE_PLACEHOLDER_RE.findall(text)
        if not (_AUTOLINK_RE.fullmatch(found) or _EMAIL_RE.fullmatch(found))
    ]
    reasons += _MARKER_RE.findall(text)

    # A code span in a table cell still fills it, so mask it with text, not blanks.
    cells = _table_cells(_CODE_SPAN_RE.sub("x", line))
    if cells is not None:
        filled = [cell for cell in cells if cell]
        if not filled or (len(filled) == 1 and cells[0] and _BOLD_CELL_RE.fullmatch(cells[0])):
            reasons.append("empty table row")

    if _ELLIPSIS_LINE_RE.match(text):
        reasons.append("a line that is only '...'")
    if line.lstrip().startswith("> Template:"):
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
    found = [(idx + 1, reasons) for idx, line in enumerate(lines) if not mask[idx] and (reasons := _placeholder_reasons(line))]
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

    probe: reserved for the live git-remote probe of v3 delivery repos, which
    arrives with the delivery checks. No check reads it yet.
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

    check_schema(parse_frontmatter(content), report)

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
