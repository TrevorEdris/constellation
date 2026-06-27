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
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class Issue:
    """A single validation finding."""

    severity: str  # "error" | "warning" | "info"
    category: str
    message: str
    line: int = 0


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
                        category="scope",
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
            out.append(f"  [ERROR] [{issue.category}]{loc} {issue.message}")

    if report.warnings:
        out.append(f"\nWARNINGS ({len(report.warnings)}):")
        for issue in report.warnings:
            loc = f" [line {issue.line}]" if issue.line else ""
            out.append(f"  [WARN]  [{issue.category}]{loc} {issue.message}")

    infos = [i for i in report.issues if i.severity == "info"]
    if verbose and infos:
        out.append(f"\nINFO ({len(infos)}):")
        for issue in infos:
            out.append(f"  [INFO]  [{issue.category}] {issue.message}")

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


def validate_plan(path: Path) -> ValidationReport:
    """Run all checks on a plan file and return the aggregated report."""
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
    check_git_branch(lines, report)
    check_git_commit_plan(lines, report)

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
