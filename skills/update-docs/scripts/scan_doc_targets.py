#!/usr/bin/env python3
"""
scan_doc_targets.py — Map changed source files to their documentation owners.

Given a git ref (defaults to the last tag or HEAD~10), runs `git diff --name-only`
to get all changed files since that ref, then applies mapping rules to determine
which documentation files should be reviewed and potentially updated.

Output is a list of records:
  {
    "changed_file": "src/api/users.ts",
    "affected_docs": ["README.md", "docs/api/users.md"],
    "change_type": "api"
  }
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Mapping rules
# ---------------------------------------------------------------------------
# Each rule is a tuple of (pattern, affected_docs, change_type).
# pattern: a callable(str) -> bool, or a regex string matched against the file path.
# affected_docs: list of doc paths (relative, may be globs).
# change_type: semantic label for the kind of change.

MAPPING_RULES = [
    # API / route files → API docs and README API section
    {
        "pattern": re.compile(r"^(src/api|routes|handlers|controllers)/"),
        "affected_docs": ["README.md", "docs/api/"],
        "change_type": "api",
    },
    # Dependency manifests → README setup/installation section
    {
        "pattern": re.compile(r"^(package\.json|pyproject\.toml|go\.mod|Gemfile|Cargo\.toml|requirements.*\.txt)$"),
        "affected_docs": ["README.md"],
        "change_type": "dependencies",
    },
    # Docker / container files → deployment docs and README setup
    {
        "pattern": re.compile(r"^(Dockerfile|docker-compose.*|compose.*|\.dockerignore)"),
        "affected_docs": ["README.md", "docs/deployment.md"],
        "change_type": "infrastructure",
    },
    # Environment / configuration files → README configuration section
    {
        "pattern": re.compile(r"^(\.env\.example|config/)"),
        "affected_docs": ["README.md"],
        "change_type": "configuration",
    },
    # Contributing guide changes
    {
        "pattern": re.compile(r"^CONTRIBUTING\.md$"),
        "affected_docs": ["README.md"],
        "change_type": "contributing",
    },
    # Any source code file → CHANGELOG.md (always), README.md (if in primary src)
    {
        "pattern": re.compile(r"\.(py|ts|js|go|rb|rs|java|cs|cpp|c|swift|kt)$"),
        "affected_docs": ["CHANGELOG.md"],
        "change_type": "source",
    },
    # Primary source directories also trigger README
    {
        "pattern": re.compile(r"^(src|lib|pkg|app|cmd)/.*\.(py|ts|js|go|rb|rs|java|cs)$"),
        "affected_docs": ["README.md", "CHANGELOG.md"],
        "change_type": "source",
    },
    # CI / workflow configuration
    {
        "pattern": re.compile(r"^\.github/workflows/"),
        "affected_docs": ["README.md"],
        "change_type": "ci",
    },
    # Makefile / Taskfile → README build commands section
    {
        "pattern": re.compile(r"^(Makefile|Taskfile\.yml|Taskfile\.yaml)$"),
        "affected_docs": ["README.md"],
        "change_type": "build",
    },
]


# ---------------------------------------------------------------------------
# Git utilities
# ---------------------------------------------------------------------------


def get_default_since_ref() -> str:
    """Return the last tag, or HEAD~10 if no tags exist."""
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return "HEAD~10"


def get_changed_files(since_ref: str) -> list[str]:
    """Return list of files changed between since_ref and HEAD."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{since_ref}..HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        files = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        return files
    except subprocess.CalledProcessError as e:
        print(f"Error running git diff: {e.stderr}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Mapping logic
# ---------------------------------------------------------------------------


def apply_mapping_rules(changed_file: str) -> list[dict]:
    """
    Apply all mapping rules to a single changed file.

    Returns a list of (affected_docs, change_type) dicts for each matching rule.
    Multiple rules can match a single file (e.g., a .ts file in src/api/ matches
    both the API rule and the source rule).
    """
    matches = []
    for rule in MAPPING_RULES:
        pattern = rule["pattern"]
        if isinstance(pattern, re.Pattern):
            if pattern.search(changed_file):
                matches.append({
                    "affected_docs": rule["affected_docs"],
                    "change_type": rule["change_type"],
                })
        elif callable(pattern):
            if pattern(changed_file):
                matches.append({
                    "affected_docs": rule["affected_docs"],
                    "change_type": rule["change_type"],
                })
    return matches


def build_file_record(changed_file: str) -> dict | None:
    """
    Build a scan record for a changed file.

    Returns None if no mapping rules matched (file has no doc impact).
    """
    rule_matches = apply_mapping_rules(changed_file)
    if not rule_matches:
        return None

    # Merge affected_docs from all matching rules, deduplicate
    all_docs: list[str] = []
    seen: set[str] = set()
    change_types: list[str] = []

    for match in rule_matches:
        for doc in match["affected_docs"]:
            if doc not in seen:
                seen.add(doc)
                all_docs.append(doc)
        ct = match["change_type"]
        if ct not in change_types:
            change_types.append(ct)

    # Primary change type: use the most specific one (first match that is not "source")
    primary_type = next((ct for ct in change_types if ct != "source"), change_types[0])

    return {
        "changed_file": changed_file,
        "affected_docs": all_docs,
        "change_type": primary_type,
        "all_change_types": change_types,
    }


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------


def format_json(results: list[dict]) -> str:
    """Render results as JSON."""
    return json.dumps(results, indent=2)


def format_markdown(results: list[dict], since_ref: str) -> str:
    """Render results as a markdown report."""
    if not results:
        return "No documentation-impacting changes found."

    # Collect unique affected docs and their triggering files
    doc_to_files: dict[str, list[str]] = {}
    for record in results:
        for doc in record["affected_docs"]:
            doc_to_files.setdefault(doc, []).append(record["changed_file"])

    lines = [
        "## Documentation Scan Report",
        "",
        f"_Changes since: `{since_ref}`_",
        "",
        "### Files Changed with Documentation Impact",
        "",
        "| Changed File | Affected Docs | Change Type |",
        "|-------------|--------------|-------------|",
    ]
    for record in results:
        docs_str = ", ".join(f"`{d}`" for d in record["affected_docs"])
        lines.append(
            f"| `{record['changed_file']}` | {docs_str} | {record['change_type']} |"
        )

    lines += [
        "",
        "### Documentation Files to Review",
        "",
        "| Documentation File | Triggered By |",
        "|-------------------|-------------|",
    ]
    for doc, files in sorted(doc_to_files.items()):
        triggers = ", ".join(f"`{f}`" for f in files[:3])
        if len(files) > 3:
            triggers += f" (+{len(files) - 3} more)"
        lines.append(f"| `{doc}` | {triggers} |")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Map changed source files to their affected documentation targets."
    )
    parser.add_argument(
        "--since",
        default=None,
        help=(
            "Git ref to diff against (e.g. HEAD~10, v1.2.3, main). "
            "Defaults to the last tag, or HEAD~10 if no tags exist."
        ),
    )
    parser.add_argument(
        "--output",
        choices=["json", "markdown"],
        default="markdown",
        help="Output format (default: markdown).",
    )
    args = parser.parse_args()

    since_ref = args.since or get_default_since_ref()
    changed_files = get_changed_files(since_ref)

    if not changed_files:
        print(f"No changed files found since `{since_ref}`.", file=sys.stderr)
        return 0

    results = []
    for changed_file in changed_files:
        record = build_file_record(changed_file)
        if record is not None:
            results.append(record)

    if args.output == "json":
        print(format_json(results))
    else:
        print(format_markdown(results, since_ref))

    return 0


if __name__ == "__main__":
    sys.exit(main())
