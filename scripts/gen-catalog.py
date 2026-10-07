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
  - missing-path: every references/, scripts/ or assets/ path in a code span or fence of a skill
    or agent file exists next to that file, in its skill directory, or in a skill the same
    line names as constellation:<x>
  - bare-script: a code span or fence line that starts with a bundled scripts/<name>.(sh|py|js|cjs)
    path, or runs one with the wrong interpreter, must name bash/sh, python3 or node first
  - upstream-missing / upstream-missing-row / upstream-bad-row: UPSTREAM.md exists, has the
    exact table header, gives every top-level skill a row, and every table line below the header
    is a well-formed row with an existing path, a known origin and a Synced cell that fits it
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

# Path lint: a code-formatted token that looks like a bundled file reference.
PATH_TOKEN = re.compile(r"^(?:\.\./)*(?:references|scripts|assets)/[A-Za-z0-9_./-]+$")

# Script lint: a bundled script path, optionally behind a <placeholder>, ${VAR}, ~, /, ./ or ../.
SCRIPT_TOKEN = re.compile(
    r"^(?:<[^<>\n]*>/|\$\{?\w+\}?/|~/|/|\./|(?:\.\./)+)?"
    r"(?:[\w.-]+/)*scripts/[\w.-]+\.(sh|py|js|cjs)$"
)
# Interpreter words that take a script operand, and which of them each extension accepts.
# The first accepted word is the one the violation message recommends.
INTERPRETERS = {"bash", "sh", "zsh", "python", "python2", "python3", "node"}
SCRIPT_INTERPRETERS = {"sh": ("bash", "sh"), "py": ("python3",), "js": ("node",), "cjs": ("node",)}
# Files that name bundled scripts bare on purpose; S12 deletes the file and this entry.
SCRIPT_LINT_EXEMPT = {"skills/brainstorming/references/visual-companion.md"}

# UPSTREAM.md provenance table. A row is | `path` | origin | upstream path | synced | notes |
UPSTREAM_HEADER = "| Constellation path | Origin | Upstream path | Synced | Notes |"
UPSTREAM_ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*([a-z+]+)\s*\|[^|]*\|\s*(\S+)\s*\|")
# The divider under the header, e.g. | --- | :-: |; the only table line that is not a row.
UPSTREAM_DIVIDER = re.compile(r"^\|[\s:|-]+$")
UPSTREAM_ROW_SHAPE = "row does not match | `path` | origin | upstream path | synced | notes |"
UPSTREAM_ORIGINS = ("superpowers", "superpowers+fotw", "fotw", "constellation")
COMMIT = re.compile(r"^[0-9a-f]{7,40}$")

FENCE_OPEN = re.compile(r"^\s*(`{3,}(?=[^`]*$)|~{3,})")
CODE_SPAN = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)")
# A whitespace-separated token, except that a <placeholder> (which may hold spaces) is one piece.
TOKEN = re.compile(r"(?:<[^<>\n]*>|\S)+")
TOKEN_LEAD = re.compile(r"^(?:\$\(|[\"'(])+")
TOKEN_TRAIL = re.compile(r"[\"');,.:]+$")
ASSIGNMENT = re.compile(r"^[A-Za-z_]\w*=")


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


def iter_code_segments(text):
    """Yield (line_no, segment, full_line) for each code unit in Markdown text.

    A unit is one line inside a fenced block (the fence lines themselves excluded) or one
    inline code span outside fences. full_line is the whole source line, so a lint can read
    context that sits outside the backticks, such as a constellation:<x> naming the skill.
    A fence closes on a line of the same character at least as long as its opener, so a
    shorter fence nested in a longer one stays code.
    """
    fence = None  # (character, length) while inside a fenced block
    for n, line in enumerate(text.split("\n"), 1):
        m = FENCE_OPEN.match(line)
        if fence is None:
            if m:
                fence = (m.group(1)[0], len(m.group(1)))
            else:
                for span in CODE_SPAN.finditer(line):
                    yield n, span.group(2), line
        elif m and m.group(1)[0] == fence[0] and len(m.group(1)) >= fence[1] \
                and not line.strip().strip(fence[0]):
            fence = None
        else:
            yield n, line, line


def tokens(segment):
    """Split a code segment into shell-ish words with surrounding quotes and punctuation trimmed.

    A <placeholder> stays one word even when it holds spaces. Words that become empty are dropped.
    """
    words = (TOKEN_TRAIL.sub("", TOKEN_LEAD.sub("", w)) for w in TOKEN.findall(segment))
    return [w for w in words if w]


def iter_markdown_units(root):
    """Yield (relpath, line_no, segment, full_line) for each code unit in skill and agent docs."""
    for p in iter_files(root, "markdown"):
        rel = p.relative_to(root)
        text = p.read_text(encoding="utf-8", errors="ignore")
        for n, segment, full_line in iter_code_segments(text):
            yield rel, n, segment, full_line


def lint_paths(root):
    """One violation per references/, scripts/ or assets/ token that names no existing file.

    A token resolves next to its file, in its top skill directory, or in skills/<x>/ for any
    constellation:<x> on the same line. Placeholder-prefixed tokens never match, so are not checked.
    """
    out = []
    for rel, n, segment, full_line in iter_markdown_units(root):
        candidates = [t for t in tokens(segment) if PATH_TOKEN.match(t)]
        if not candidates:
            continue
        bases = [(root / rel).parent]
        if rel.parts[0] == "skills" and len(rel.parts) > 2:
            bases.append(root / "skills" / rel.parts[1])
        bases += [root / "skills" / m.group(1) for m in SKILL_REF.finditer(full_line)]
        for t in candidates:
            if not any((b / t).exists() for b in bases):
                where = ", ".join(sorted({b.relative_to(root).as_posix() for b in bases}))
                out.append((rel.as_posix(), n, "missing-path", f"{t} not found in {where}"))
    return out


def bare_script(segment):
    """Return (script, recommended interpreter) if the segment runs a script wrongly, else None.

    Only the first word is judged: the script itself, or an interpreter whose first operand is a
    script the interpreter does not run. Later words and prose are not checked.
    """
    words = tokens(segment)
    while words and (words[0] in ("$", ">") or ASSIGNMENT.match(words[0])):
        words.pop(0)
    if not words:
        return None
    if SCRIPT_TOKEN.match(words[0]):
        script, runner = words[0], None
    elif words[0] in INTERPRETERS:
        operand = next((w for w in words[1:] if not w.startswith("-")), "")
        if not SCRIPT_TOKEN.match(operand):
            return None
        script, runner = operand, words[0]
    else:
        return None
    accepted = SCRIPT_INTERPRETERS[script.rsplit(".", 1)[1]]
    return None if runner in accepted else (script, accepted[0])


def lint_scripts(root):
    """One violation per code unit that starts with a bundled script path or runs one wrongly."""
    out = []
    for rel, n, segment, _ in iter_markdown_units(root):
        if rel.as_posix() in SCRIPT_LINT_EXEMPT:
            continue
        found = bare_script(segment)
        if found:
            script, interp = found
            out.append((rel.as_posix(), n, "bare-script",
                        f'{script} must be run as "{interp} {script}"'))
    return out


def upstream_row_problems(root, path, origin, synced):
    """Return what is wrong with one UPSTREAM.md row, as messages; an empty list means valid."""
    problems = []
    if not (root / path).exists():
        problems.append(f"{path} does not exist")
    if origin not in UPSTREAM_ORIGINS:
        problems.append(f"origin {origin} must be one of {', '.join(UPSTREAM_ORIGINS)}")
    elif origin.startswith("superpowers"):
        if not COMMIT.match(synced):
            problems.append(f"Synced {synced} must be a bare 7 to 40 character hex commit"
                            f" for origin {origin}")
    elif synced != "-":
        problems.append(f"Synced {synced} must be - for origin {origin}")
    return problems


def lint_upstream(root, skills):
    """Check UPSTREAM.md: the table header, each row, and a row for every top-level skill.

    A missing or changed header is one violation at line 1. Skills without a row are reported at
    the header line, or at line 1 when there is no header. Below the header, a table line that is
    neither the divider nor a well-formed row is a violation too, so a malformed row cannot hide.
    """
    path = root / "UPSTREAM.md"
    if not path.is_file():
        return [("UPSTREAM.md", 1, "upstream-missing",
                 "UPSTREAM.md is missing; it records where each skill came from")]
    lines = path.read_text(encoding="utf-8", errors="ignore").split("\n")
    out = []
    header_line = next((n for n, line in enumerate(lines, 1) if line.rstrip() == UPSTREAM_HEADER), None)
    # Without a header there is no table to hold lines to, so only the one header violation shows.
    table_start = header_line
    if header_line is None:
        header_line = 1
        out.append(("UPSTREAM.md", 1, "upstream-bad-row",
                    f'table header must be exactly "{UPSTREAM_HEADER}"'))
    covered = set()
    for n, line in enumerate(lines, 1):
        m = UPSTREAM_ROW.match(line)
        if m:
            covered.add(m.group(1))
            out += [("UPSTREAM.md", n, "upstream-bad-row", msg)
                    for msg in upstream_row_problems(root, *m.groups())]
        elif (table_start is not None and n > table_start and line.startswith("|")
              and not UPSTREAM_DIVIDER.match(line)):
            out.append(("UPSTREAM.md", n, "upstream-bad-row", UPSTREAM_ROW_SHAPE))
    for name, _, _ in skills:
        if f"skills/{name}/" not in covered:
            out.append(("UPSTREAM.md", header_line, "upstream-missing-row",
                        f"no row for skills/{name}/"))
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
        + lint_paths(root)
        + lint_scripts(root)
        + lint_upstream(root, skills)
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
