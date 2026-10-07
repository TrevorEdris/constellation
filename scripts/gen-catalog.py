#!/usr/bin/env python3
"""Generate CATALOG.md from skills/ and lint the plugin tree.

  python3 scripts/gen-catalog.py                # regenerate CATALOG.md; violations print as warnings
  python3 scripts/gen-catalog.py --check        # lint only; exit 1 on any violation
  python3 scripts/gen-catalog.py --root DIR     # operate on DIR instead of the repo root

Every violation prints as <relpath>:<line>: <rule>: <message>. Lints (constellation house rules):
  - frontmatter: every skill has a description that starts with "Use when" (triggering
    conditions only, no workflow summary), and its name matches its directory
  - section-sign: no section-sign character in skill bodies or docs/*.md (one violation per line)
  - catalog-stale: CATALOG.md is missing or differs from what this script would generate
  - unknown-skill-ref: every constellation:<x> reference in the plugin's skills, agents, hooks,
    docs, scripts and config names a top-level skills/<x>/SKILL.md or an agents/<x>.md
Adding a skill = drop skills/<name>/SKILL.md; the catalog auto-registers it. No manifest edit.
"""
import argparse
import fnmatch
import re
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
# Built from its code point so this source never holds the character it forbids.
SECTION_SIGN = chr(0xA7)
REGEN_HINT = "run python3 scripts/gen-catalog.py"

# Scan scopes, each a list of (glob relative to the root, file suffixes to keep).
# "ref" feeds the skill-ref lint; "markdown" is the prose the path and script lints read.
REF_SUFFIXES = {".md", ".js", ".cjs", ".py", ".sh", ".json"}
REF_DIRS = ("skills", "agents", "hooks", "docs", "scripts", ".codex", ".claude-plugin")
SCAN_SCOPES = {
    "ref": [(f"{d}/**/*", REF_SUFFIXES) for d in REF_DIRS] + [("*", {".md"})],
    "markdown": [("skills/**/*", {".md"}), ("agents/*", {".md"})],
}
# Test data and history are not plugin content. Parts are matched on the path relative to
# the scan root, never the absolute path, so a root under <repo>/.worktrees/ is still scanned.
EXCLUDED_PARTS = {"fixtures", "node_modules", "__pycache__", ".git", ".worktrees"}
EXCLUDED_NAMES = ("CHANGELOG.md", "test_*.py", "*.test.js", "test-*.sh")

# Only a bare constellation:<name> counts. A preceding word character, slash, dot or hyphen
# means the text is part of a path, URL or longer identifier, not a skill reference.
SKILL_REF = re.compile(r"(?<![\w/.-])constellation:([A-Za-z0-9][A-Za-z0-9_-]*)")


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            fm[k.strip()] = v.strip()
    return fm


def discover(root):
    """Return (dir name, frontmatter name, description) for each skills/<name>/SKILL.md."""
    out = []
    for d in sorted((root / "skills").iterdir(), key=lambda p: p.name):
        sk = d / "SKILL.md"
        if d.name == "_shared" or not sk.is_file():
            continue
        fm = parse_frontmatter(sk.read_text(encoding="utf-8"))
        out.append((d.name, fm.get("name", d.name), fm.get("description", "")))
    return out


def lint_frontmatter(skills):
    out = []
    for name, sk_name, desc in skills:
        rel = f"skills/{name}/SKILL.md"
        if not desc:
            out.append((rel, 1, "frontmatter", "missing description"))
        elif not desc.lower().startswith("use when"):
            out.append((rel, 1, "frontmatter",
                        "description must start with 'Use when' (triggering conditions only)"))
        if sk_name != name:
            out.append((rel, 1, "frontmatter", f"name '{sk_name}' != directory name '{name}'"))
    return out


def lint_section_sign(root, skills):
    # Scan AUTHORED content only (skill bodies + our docs). Vendored third-party
    # reference material (e.g. bundled Wikipedia guides) is exempt: the rule governs
    # authored output, not vendored data.
    paths = [root / "skills" / name / "SKILL.md" for name, _, _ in skills]
    docs = root / "docs"
    if docs.is_dir():
        paths += sorted(p for p in docs.glob("*.md") if p.is_file())
    out = []
    for p in paths:
        text = p.read_text(encoding="utf-8", errors="ignore")
        for n, line in enumerate(text.split("\n"), 1):
            if SECTION_SIGN in line:
                out.append((p.relative_to(root).as_posix(), n, "section-sign",
                            "contains the section-sign character; write 'section' instead"))
    return out


def lint_catalog(root, skills):
    catalog = root / "CATALOG.md"
    if not catalog.is_file():
        return [("CATALOG.md", 1, "catalog-stale", f"CATALOG.md is missing; {REGEN_HINT}")]
    if catalog.read_bytes() != render(skills).encode("utf-8"):
        return [("CATALOG.md", 1, "catalog-stale",
                 f"CATALOG.md does not match skills/; {REGEN_HINT}")]
    return []


def is_excluded(rel):
    return bool(EXCLUDED_PARTS.intersection(rel.parts)) or any(
        fnmatch.fnmatchcase(rel.name, glob) for glob in EXCLUDED_NAMES
    )


def iter_files(root, scope):
    """Return the files in SCAN_SCOPES[scope] under root, sorted, minus excluded ones."""
    found = []
    for pattern, suffixes in SCAN_SCOPES[scope]:
        for p in root.glob(pattern):
            if p.suffix in suffixes and p.is_file() and not is_excluded(p.relative_to(root)):
                found.append(p)
    return sorted(found)


def skill_ref_targets(root):
    """Names a constellation:<name> reference may use: top-level skills and agents.

    A SKILL.md nested under a skill's references/ is a guide, not a registered skill,
    so only direct children of skills/ count.
    """
    names = set()
    if (root / "skills").is_dir():
        names |= {d.name for d in (root / "skills").iterdir() if (d / "SKILL.md").is_file()}
    if (root / "agents").is_dir():
        names |= {p.stem for p in (root / "agents").glob("*.md") if p.is_file()}
    return names


def lint_skill_refs(root):
    """One violation per constellation:<x> reference that is not a skill or an agent."""
    valid = skill_ref_targets(root)
    out = []
    for p in iter_files(root, "ref"):
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding="utf-8", errors="ignore")
        for n, line in enumerate(text.split("\n"), 1):
            for m in SKILL_REF.finditer(line):
                x = m.group(1)
                if x not in valid:
                    out.append((rel, n, "unknown-skill-ref",
                                f"constellation:{x} is not a skill (skills/{x}/SKILL.md)"
                                f" or agent (agents/{x}.md)"))
    return out


def render(skills):
    lines = [
        "# Constellation Catalog",
        "",
        "Generated by `scripts/gen-catalog.py` from `skills/`. Do not edit by hand.",
        "",
        f"{len(skills)} skills.",
        "",
        "| Skill | Triggers on |",
        "|---|---|",
    ]
    for name, _, desc in skills:
        lines.append(f"| `{name}` | {desc} |")
    lines.append("")
    return "\n".join(lines)


def format_violation(v):
    rel, line, rule, message = v
    return f"{rel}:{line}: {rule}: {message}"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate CATALOG.md and lint the plugin tree.")
    ap.add_argument("--check", action="store_true", help="lint only; exit 1 on any violation")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                    help="repo root to operate on (default: parent of scripts/)")
    args = ap.parse_args(argv)
    root = args.root

    skills = discover(root)
    if not args.check:
        (root / "CATALOG.md").write_bytes(render(skills).encode("utf-8"))
        print(f"Wrote CATALOG.md ({len(skills)} skills)")
    violations = sorted(
        lint_frontmatter(skills)
        + lint_section_sign(root, skills)
        + lint_catalog(root, skills)
        + lint_skill_refs(root)
    )

    if not args.check:
        if violations:
            print("WARNINGS:")
            for v in violations:
                print("  - " + format_violation(v))
        return 0
    for v in violations:
        print(format_violation(v))
    if violations:
        print(f"LINT FAILED ({len(violations)})")
        return 1
    print(f"LINT OK ({len(skills)} skills)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
