#!/usr/bin/env python3
"""
validate_prd.py — Validate structural completeness of a Product Requirements
Document (PRD.md).

Usage:
    python validate_prd.py <path-to-prd.md>
    python validate_prd.py <path-to-prd.md> --verbose
    python validate_prd.py <path-to-prd.md> --draft
    python validate_prd.py <path-to-prd.md> --json

Exit codes:
    0 — PASS (score >= threshold)
    1 — NEEDS WORK (score < threshold)

Thresholds:
    Default: 70
    --draft:  50 (relaxed for work-in-progress PRDs)
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
    """Aggregated validation result for a PRD."""

    path: str
    threshold: int = 70
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
        return len(self.errors) == 0 and self.score >= self.threshold


# ---------------------------------------------------------------------------
# Section detection helpers
# ---------------------------------------------------------------------------


def find_section(lines: list[str], pattern: str) -> tuple[int, int]:
    """Find a section by heading pattern. Returns (start_line, end_line) 0-indexed, or (0, 0)."""
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


def count_subsections(lines: list[str], start: int, end: int) -> int:
    """Count sub-headings within a section range."""
    count = 0
    for line in lines[start:end]:
        if line.strip().startswith("#"):
            count += 1
    return count


# ---------------------------------------------------------------------------
# Check functions — 16 checks
# ---------------------------------------------------------------------------


def check_problem_statement(lines: list[str], report: ValidationReport) -> None:
    """Check 1: Problem statement section exists and is non-empty."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:problem\s+statement|problem|the\s+problem)")
    if s == 0:
        report.issues.append(
            Issue(
                severity="error",
                category="structure",
                message="No problem statement section found. PRDs must start with a clear problem definition.",
            )
        )
        report.score -= 15
    else:
        body = section_content(lines, s, e).strip()
        if len(body) < 20:
            report.issues.append(
                Issue(
                    severity="error",
                    category="structure",
                    message="Problem statement section is too brief. Describe what problem exists, who has it, and why it matters now.",
                    line=s,
                )
            )
            report.score -= 10


def check_personas_section(lines: list[str], report: ValidationReport) -> None:
    """Check 2: User personas section exists with at least one persona."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:user\s+personas?|personas?|target\s+users?)")
    if s == 0:
        report.issues.append(
            Issue(
                severity="error",
                category="structure",
                message="No user personas section found. PRDs must define who the product is for.",
            )
        )
        report.score -= 10
        return
    body = section_content(lines, s, e).strip()
    if len(body) < 20:
        report.issues.append(
            Issue(
                severity="error",
                category="structure",
                message="User personas section is too brief. Define at least one persona with role, goals, and pain points.",
                line=s,
            )
        )
        report.score -= 10


def check_persona_detail(lines: list[str], report: ValidationReport) -> None:
    """Check 3: Each persona has name, role/description, goals, pain points."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:user\s+personas?|personas?|target\s+users?)")
    if s == 0:
        return

    body = section_content(lines, s, e).lower()
    has_goals = bool(re.search(r"\bgoals?\b", body))
    has_pain = bool(re.search(r"\bpain\s+points?\b|\bfrustrat|\bchalleng|\bstruggl", body))

    if not has_goals:
        report.issues.append(
            Issue(
                severity="warning",
                category="completeness",
                message="Personas section does not mention user goals. Each persona should list what they need to accomplish.",
                line=s,
            )
        )
        report.score -= 3

    if not has_pain:
        report.issues.append(
            Issue(
                severity="warning",
                category="completeness",
                message="Personas section does not mention pain points or challenges. Each persona should describe what frustrates them today.",
                line=s,
            )
        )
        report.score -= 3


def check_functional_requirements(lines: list[str], report: ValidationReport) -> None:
    """Check 4: Functional requirements section exists."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:functional\s+requirements?|requirements?|features?|feature\s+requirements?)",
    )
    if s == 0:
        report.issues.append(
            Issue(
                severity="error",
                category="structure",
                message="No functional requirements section found. PRDs must list what the product must do.",
            )
        )
        report.score -= 15
    else:
        body = section_content(lines, s, e).strip()
        if len(body) < 20:
            report.issues.append(
                Issue(
                    severity="error",
                    category="structure",
                    message="Functional requirements section is too brief.",
                    line=s,
                )
            )
            report.score -= 10


def check_requirement_ids(lines: list[str], report: ValidationReport) -> None:
    """Check 5: Each requirement has an ID (FR-001 format or similar)."""
    content = "\n".join(lines)
    req_ids = re.findall(r"\bFR-\d{3}\b", content)
    if not req_ids:
        # Also accept other ID formats
        alt_ids = re.findall(r"\b(?:REQ|FEAT|US)-\d{3}\b", content)
        if not alt_ids:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="specificity",
                    message="No requirement IDs found (expected FR-001 format). Requirements should have unique identifiers for traceability.",
                )
            )
            report.score -= 5


def check_acceptance_criteria(lines: list[str], report: ValidationReport) -> None:
    """Check 6: Requirements have acceptance criteria."""
    content = "\n".join(lines).lower()
    has_ac = bool(
        re.search(r"acceptance\s+criteria", content)
        or re.search(r"\bdone\s+when\b", content)
        or re.search(r"\bverif(?:y|ication)\b.*\brequirement", content)
    )
    # Also count bulleted sub-items under requirements as implicit acceptance criteria
    req_ids = re.findall(r"\bFR-\d{3}\b", "\n".join(lines))
    if not has_ac and len(req_ids) > 0:
        report.issues.append(
            Issue(
                severity="warning",
                category="completeness",
                message="No acceptance criteria found for requirements. Each requirement should describe what 'done' looks like.",
            )
        )
        report.score -= 8
    elif not has_ac and len(req_ids) == 0:
        report.issues.append(
            Issue(
                severity="warning",
                category="completeness",
                message="No acceptance criteria found. Requirements should describe what 'done' looks like.",
            )
        )
        report.score -= 5


def check_nonfunctional_requirements(lines: list[str], report: ValidationReport) -> None:
    """Check 7: Non-functional requirements section exists."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:non-?functional\s+requirements?|nfrs?|quality\s+attributes?|system\s+requirements?)",
    )
    if s == 0:
        # Check for inline NFR mentions
        content = "\n".join(lines).lower()
        nfr_keywords = ["performance", "scalability", "security", "reliability", "accessibility"]
        found = sum(1 for kw in nfr_keywords if kw in content)
        if found < 2:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="No non-functional requirements section found. Consider documenting performance, security, scalability, and accessibility expectations.",
                )
            )
            report.score -= 5


def check_scope_boundary(lines: list[str], report: ValidationReport) -> None:
    """Check 8: Scope boundary section exists with both in-scope and out-of-scope."""
    s, e = find_section(lines, r"^#{1,3}\s+(?:scope|scope\s+boundary)")
    content_lower = "\n".join(lines).lower()

    if s == 0:
        # Check for inline scope mentions
        has_scope = "in scope" in content_lower or "in-scope" in content_lower
        has_out = "out of scope" in content_lower or "out-of-scope" in content_lower
        if not has_scope and not has_out:
            report.issues.append(
                Issue(
                    severity="error",
                    category="structure",
                    message="No scope boundary found. PRDs must explicitly state what is in scope and what is out of scope.",
                )
            )
            report.score -= 10
        elif not has_out:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="completeness",
                    message="In-scope items found but no out-of-scope exclusions. Explicitly state what is NOT being built.",
                )
            )
            report.score -= 5
    else:
        body = section_content(lines, s, e).lower()
        if "out of scope" not in body and "out-of-scope" not in body and "not included" not in body and "excluded" not in body:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="completeness",
                    message="Scope section exists but does not list out-of-scope exclusions.",
                    line=s,
                )
            )
            report.score -= 5


def check_dependencies(lines: list[str], report: ValidationReport) -> None:
    """Check 9: Dependencies section exists."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:dependenc(?:y|ies)|external\s+dependenc|blockers?)",
    )
    if s == 0:
        content_lower = "\n".join(lines).lower()
        if "depends on" not in content_lower and "dependency" not in content_lower and "blocked by" not in content_lower:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="No dependencies section found. Document external systems, teams, data sources, or APIs this work depends on.",
                )
            )
            report.score -= 3


def check_milestones(lines: list[str], report: ValidationReport) -> None:
    """Check 10: Milestones/phases section exists."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:milestones?|phases?|delivery\s+phases?|release\s+plan|rollout)",
    )
    if s == 0:
        # Check for phase references in content
        content = "\n".join(lines)
        has_phases = bool(re.search(r"\bphase\s+\d\b|\bP\d+-[A-Z]\b|\bmilestone\s+\d\b", content, re.IGNORECASE))
        if not has_phases:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="No milestones or phases section found. PRDs should describe how the work will be delivered incrementally.",
                )
            )
            report.score -= 5


def check_milestone_deliverables(lines: list[str], report: ValidationReport) -> None:
    """Check 11: Each milestone has a deliverable statement."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:milestones?|phases?|delivery\s+phases?|release\s+plan|rollout)",
    )
    if s == 0:
        return

    body = section_content(lines, s, e).lower()
    has_deliverable = bool(
        re.search(r"\bdeliver(?:able|s)\b", body)
        or re.search(r"\boutcome\b", body)
        or re.search(r"\bresult(?:s|ing)?\b", body)
        or re.search(r"\busers?\s+can\b", body)
    )
    if not has_deliverable:
        report.issues.append(
            Issue(
                severity="warning",
                category="completeness",
                message="Milestones section does not describe deliverables. Each milestone should state what users can do when it ships.",
                line=s,
            )
        )
        report.score -= 3


VAGUE_PHRASES = [
    r"\bTBD\b(?!\s*[-—:]\s*\w)",  # TBD without an owner/date following
    r"\bshould work\b",
    r"\bmight need\b",
    r"\bprobably\b",
    r"\bas needed\b",
    r"\betc\.?\b",
    r"\bsomehow\b",
    r"\bas appropriate\b",
    r"\bif necessary\b",
    r"\band so on\b",
    r"\bmaybe\b",
]


def check_vague_language(lines: list[str], report: ValidationReport) -> None:
    """Check 12: Flag vague language."""
    hits = 0
    in_code_block = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block or stripped.startswith("|"):
            continue
        for phrase_pattern in VAGUE_PHRASES:
            if re.search(phrase_pattern, line, re.IGNORECASE):
                if hits < 5:
                    found = re.search(phrase_pattern, line, re.IGNORECASE)
                    phrase_text = found.group() if found else phrase_pattern
                    report.issues.append(
                        Issue(
                            severity="warning",
                            category="vagueness",
                            message=f'Vague language: "{phrase_text}"',
                            line=i,
                        )
                    )
                hits += 1
    if hits > 0:
        report.score -= min(hits * 2, 10)


def check_oversized_code_blocks(lines: list[str], report: ValidationReport) -> None:
    """Check 13: Detect code blocks >15 lines (PRDs describe, not implement)."""
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
                        message=f"Code block at line {block_start} is {block_lines} lines. PRDs should describe behavior, not implement it.",
                        line=block_start,
                    )
                )
                report.score -= 3
        elif in_block:
            block_lines += 1


def check_success_metrics(lines: list[str], report: ValidationReport) -> None:
    """Check 14: Success metrics section exists with measurable outcomes."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:success\s+metrics?|metrics?|kpis?|success\s+criteria|how\s+we.ll\s+measure)",
    )
    if s == 0:
        content_lower = "\n".join(lines).lower()
        has_metrics = bool(
            re.search(r"\bmeasur(?:e|able|ement)\b", content_lower)
            or re.search(r"\bmetric\b", content_lower)
            or re.search(r"\bkpi\b", content_lower)
        )
        if not has_metrics:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="structure",
                    message="No success metrics found. PRDs should define how success will be measured.",
                )
            )
            report.score -= 5
    else:
        body = section_content(lines, s, e).strip()
        if len(body) < 15:
            report.issues.append(
                Issue(
                    severity="warning",
                    category="completeness",
                    message="Success metrics section exists but is too brief. Include at least one measurable outcome.",
                    line=s,
                )
            )
            report.score -= 3


def check_open_questions(lines: list[str], report: ValidationReport) -> None:
    """Check 15: Open questions section exists."""
    s, e = find_section(
        lines,
        r"^#{1,3}\s+(?:open\s+questions?|unresolved|unknowns?|questions?)",
    )
    if s == 0:
        report.issues.append(
            Issue(
                severity="info",
                category="structure",
                message="No open questions section found. Consider documenting unresolved items with owners and target dates.",
            )
        )


def check_requirement_id_consistency(lines: list[str], report: ValidationReport) -> None:
    """Check 16: Requirement IDs follow a consistent pattern."""
    content = "\n".join(lines)

    fr_ids = re.findall(r"\bFR-(\d{3})\b", content)
    nfr_ids = re.findall(r"\bNFR-(\d{3})\b", content)

    if fr_ids:
        nums = [int(n) for n in fr_ids]
        # Check for gaps > 1 in the sequence
        sorted_nums = sorted(set(nums))
        if len(sorted_nums) > 1:
            for i in range(1, len(sorted_nums)):
                if sorted_nums[i] - sorted_nums[i - 1] > 1:
                    report.issues.append(
                        Issue(
                            severity="info",
                            category="consistency",
                            message=f"Gap in requirement IDs: FR-{sorted_nums[i-1]:03d} to FR-{sorted_nums[i]:03d}. This may indicate removed requirements.",
                        )
                    )
                    break

    # Check for mixed ID formats
    alt_formats = re.findall(r"\b(?:REQ|FEAT|US)-\d{3}\b", content)
    if fr_ids and alt_formats:
        report.issues.append(
            Issue(
                severity="warning",
                category="consistency",
                message="Mixed requirement ID formats found (FR-xxx and other formats). Use a single consistent format.",
            )
        )
        report.score -= 3


def check_implementation_leakage(lines: list[str], report: ValidationReport) -> None:
    """Check 17: Detect implementation details that belong in PLAN.md."""
    hits = 0
    in_code_block = False

    # Detect "Files to change/modify" headings
    files_heading_re = re.compile(
        r"^\*{0,2}files?\s+to\s+(?:change|modify|update|edit)\*{0,2}\s*:?\s*$",
        re.IGNORECASE,
    )

    # Detect source code file paths (src/, apps/, packages/, components/, internal/, cmd/)
    source_path_re = re.compile(
        r"(?:^|\s)(?:`)?(?:src|apps|packages|components|internal|cmd|lib|libs|services)/\S+\.\w{1,4}(?:`)?",
    )

    # Detect line number references
    line_ref_re = re.compile(
        r"\(lines?\s+\d+|:\s*line\s+\d+|\(lines?\s+\d+[\s,\-]+\d+",
        re.IGNORECASE,
    )

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        if files_heading_re.match(stripped):
            report.issues.append(
                Issue(
                    severity="warning",
                    category="abstraction",
                    message='"Files to change" section belongs in PLAN.md, not the PRD. PRDs describe what to build, not which files to modify.',
                    line=i,
                )
            )
            hits += 1

        elif source_path_re.search(line):
            if hits < 5:
                report.issues.append(
                    Issue(
                        severity="warning",
                        category="abstraction",
                        message="Source code file path detected. Implementation file references belong in PLAN.md.",
                        line=i,
                    )
                )
            hits += 1

        elif line_ref_re.search(line):
            if hits < 5:
                report.issues.append(
                    Issue(
                        severity="warning",
                        category="abstraction",
                        message="Line number reference detected. Code-level references belong in PLAN.md.",
                        line=i,
                    )
                )
            hits += 1

    if hits > 0:
        report.score -= min(hits * 3, 10)


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------


def render_text(report: ValidationReport, verbose: bool = False) -> str:
    """Render the validation report as human-readable text."""
    out = []
    status = "PASS" if report.passed else "NEEDS WORK"
    mode = " (draft mode)" if report.threshold < 70 else ""
    out.append(f"{'=' * 60}")
    out.append(f"PRD Validation: {status}{mode}")
    out.append(f"File: {report.path}")
    out.append(f"Score: {max(0, report.score)}/100 (threshold: {report.threshold})")
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
        "threshold": report.threshold,
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


def validate_prd(path: Path, draft: bool = False) -> ValidationReport:
    """Run all checks on a PRD file and return the aggregated report."""
    threshold = 50 if draft else 70
    report = ValidationReport(path=str(path), threshold=threshold)

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

    check_problem_statement(lines, report)
    check_personas_section(lines, report)
    check_persona_detail(lines, report)
    check_functional_requirements(lines, report)
    check_requirement_ids(lines, report)
    check_acceptance_criteria(lines, report)
    check_nonfunctional_requirements(lines, report)
    check_scope_boundary(lines, report)
    check_dependencies(lines, report)
    check_milestones(lines, report)
    check_milestone_deliverables(lines, report)
    check_vague_language(lines, report)
    check_oversized_code_blocks(lines, report)
    check_success_metrics(lines, report)
    check_open_questions(lines, report)
    check_requirement_id_consistency(lines, report)
    check_implementation_leakage(lines, report)

    report.score = max(0, report.score)
    return report


def main() -> int:
    """Entry point."""
    parser = argparse.ArgumentParser(
        description="Validate a PRD for structural completeness and specificity.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("prd_path", help="Path to the PRD.md file")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show additional detail")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument(
        "--draft",
        action="store_true",
        help="Draft mode: relaxed threshold (PASS >= 50) for work-in-progress PRDs",
    )
    args = parser.parse_args()

    path = Path(args.prd_path)
    report = validate_prd(path, draft=args.draft)

    if args.json:
        print(render_json(report))
    else:
        print(render_text(report, verbose=args.verbose))

    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
