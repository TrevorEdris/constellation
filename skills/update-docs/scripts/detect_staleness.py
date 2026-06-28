#!/usr/bin/env python3
"""
detect_staleness.py — Compare documentation freshness against source code.

For each documentation file found, uses `git log` to determine the last commit
date for the doc and its associated source files. Classifies staleness as:
  FRESH         — doc was committed at or after the most recent source change
  SLIGHTLY_STALE — source changed < 30 days ago, doc not updated
  STALE         — source changed 30–90 days ago, doc not updated
  VERY_STALE    — source changed > 90 days ago, doc not updated
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DOC_PATTERNS = [
    "README.md",
    "CHANGELOG.md",
    "*.api.md",
]

DOC_GLOB_PATTERNS = [
    "**/*.api.md",
    "**/README.md",
    "**/CHANGELOG.md",
    "docs/**/*.md",
]

# Source directories to associate with each doc, by heuristic
SOURCE_ASSOCIATIONS = {
    "README.md": ["src", "lib", "pkg", "app", "cmd"],
    "CHANGELOG.md": ["src", "lib", "pkg", "app", "cmd"],
    "CONTRIBUTING.md": [],
}

STALENESS_THRESHOLDS = {
    "SLIGHTLY_STALE": 30,
    "STALE": 90,
}

IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}


# ---------------------------------------------------------------------------
# Git utilities
# ---------------------------------------------------------------------------


def git_last_commit_date(filepath: str) -> datetime | None:
    """Return the UTC datetime of the most recent commit that touched filepath."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ci", "--", filepath],
            capture_output=True,
            text=True,
            check=True,
        )
        raw = result.stdout.strip()
        if not raw:
            return None
        # git outputs: "2025-10-31 14:30:00 +0000"
        dt = datetime.fromisoformat(raw)
        return dt.astimezone(timezone.utc)
    except subprocess.CalledProcessError:
        return None


def find_associated_source_files(doc_path: Path, repo_root: Path) -> list[str]:
    """
    Return a list of source file paths that are logically associated with a doc.

    Association heuristics:
    - For a README in a subdirectory, the source files in that same directory.
    - For a top-level README/CHANGELOG, files in common source root dirs.
    - For *.api.md files, the corresponding source file with the same stem.
    """
    associated = []
    doc_dir = doc_path.parent

    doc_name = doc_path.name

    # *.api.md → look for matching source file
    if doc_name.endswith(".api.md"):
        stem = doc_path.stem.replace(".api", "")
        for ext in [".py", ".ts", ".js", ".go", ".rb", ".rs"]:
            candidate = doc_dir / (stem + ext)
            if candidate.exists():
                associated.append(str(candidate.relative_to(repo_root)))
        return associated

    # README.md or CHANGELOG.md in a subdirectory → use that directory
    if doc_dir != repo_root:
        for child in doc_dir.iterdir():
            if child.suffix in {".py", ".ts", ".js", ".go", ".rb", ".rs", ".java"}:
                associated.append(str(child.relative_to(repo_root)))
        return associated

    # Top-level README / CHANGELOG → use common source roots
    source_roots = SOURCE_ASSOCIATIONS.get(doc_name, ["src", "lib", "pkg", "app", "cmd"])
    for root_name in source_roots:
        source_root = repo_root / root_name
        if source_root.is_dir():
            for src_file in source_root.rglob("*"):
                if src_file.is_file() and src_file.suffix in {
                    ".py", ".ts", ".js", ".go", ".rb", ".rs", ".java", ".cs"
                }:
                    associated.append(str(src_file.relative_to(repo_root)))

    return associated


# ---------------------------------------------------------------------------
# Staleness classification
# ---------------------------------------------------------------------------


def classify_staleness(doc_date: datetime | None, source_date: datetime | None) -> str:
    """Classify staleness given the last-updated dates of a doc and its source."""
    if source_date is None:
        # No source history — cannot determine staleness
        return "FRESH"

    if doc_date is None:
        # Doc has never been committed — definitely stale
        return "VERY_STALE"

    if doc_date >= source_date:
        return "FRESH"

    now = datetime.now(timezone.utc)
    days_stale = (now - source_date).days

    if days_stale > STALENESS_THRESHOLDS["STALE"]:
        return "VERY_STALE"
    if days_stale > STALENESS_THRESHOLDS["SLIGHTLY_STALE"]:
        return "STALE"
    return "SLIGHTLY_STALE"


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def find_doc_files(root: Path) -> list[Path]:
    """Walk the repo tree and return all documentation files."""
    docs = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored directories in-place
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for filename in filenames:
            filepath = Path(dirpath) / filename
            rel = filepath.relative_to(root)
            parts = rel.parts
            if any(p in IGNORED_DIRS for p in parts):
                continue
            if filename in ("README.md", "CHANGELOG.md", "CONTRIBUTING.md"):
                docs.append(filepath)
            elif filename.endswith(".api.md"):
                docs.append(filepath)
            elif "docs" in parts and filename.endswith(".md"):
                docs.append(filepath)
    return docs


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def analyze_doc(doc_path: Path, repo_root: Path) -> dict:
    """Return a staleness record for a single documentation file."""
    rel_doc = str(doc_path.relative_to(repo_root))
    doc_date = git_last_commit_date(rel_doc)

    source_files = find_associated_source_files(doc_path, repo_root)
    source_dates = [d for f in source_files if (d := git_last_commit_date(f)) is not None]
    latest_source_date = max(source_dates) if source_dates else None

    staleness = classify_staleness(doc_date, latest_source_date)

    now = datetime.now(timezone.utc)
    days_stale = None
    if latest_source_date and doc_date and doc_date < latest_source_date:
        days_stale = (now - latest_source_date).days

    return {
        "doc": rel_doc,
        "staleness": staleness,
        "doc_last_updated": doc_date.isoformat() if doc_date else None,
        "source_last_updated": latest_source_date.isoformat() if latest_source_date else None,
        "days_stale": days_stale,
        "source_file_count": len(source_files),
    }


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

STALENESS_ORDER = ["VERY_STALE", "STALE", "SLIGHTLY_STALE", "FRESH"]


def format_markdown(results: list[dict]) -> str:
    """Render staleness results as a markdown table, worst first."""
    results = sorted(results, key=lambda r: STALENESS_ORDER.index(r["staleness"]))
    lines = [
        "## Documentation Staleness Report",
        "",
        f"_Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_",
        "",
        "| Staleness | Document | Doc Last Updated | Source Last Updated | Days Stale |",
        "|-----------|----------|-----------------|---------------------|------------|",
    ]
    for r in results:
        doc_date = r["doc_last_updated"][:10] if r["doc_last_updated"] else "never"
        src_date = r["source_last_updated"][:10] if r["source_last_updated"] else "n/a"
        days = str(r["days_stale"]) if r["days_stale"] is not None else "—"
        lines.append(
            f"| {r['staleness']} | `{r['doc']}` | {doc_date} | {src_date} | {days} |"
        )
    return "\n".join(lines)


def format_json(results: list[dict]) -> str:
    """Render staleness results as JSON."""
    return json.dumps(results, indent=2)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect documentation staleness by comparing git commit dates."
    )
    parser.add_argument(
        "--path",
        default=".",
        help="Root directory to scan (default: current directory).",
    )
    parser.add_argument(
        "--output",
        choices=["json", "markdown"],
        default="markdown",
        help="Output format (default: markdown).",
    )
    args = parser.parse_args()

    repo_root = Path(args.path).resolve()
    if not repo_root.is_dir():
        print(f"Error: path '{args.path}' is not a directory.", file=sys.stderr)
        return 1

    doc_files = find_doc_files(repo_root)
    if not doc_files:
        print("No documentation files found.", file=sys.stderr)
        return 0

    results = [analyze_doc(doc, repo_root) for doc in doc_files]

    if args.output == "json":
        print(format_json(results))
    else:
        print(format_markdown(results))

    return 0


if __name__ == "__main__":
    sys.exit(main())
