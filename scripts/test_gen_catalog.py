"""Tests for scripts/gen-catalog.py, driven through the real CLI on temp trees.

Each test builds a small repo layout under tmp_path and runs the script with
--root, so no test reads or writes the real repository.

  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider scripts/test_gen_catalog.py
"""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "gen-catalog.py"
# Built at runtime so this file never holds the character itself.
SECTION_SIGN = chr(0xA7)
STALE_SUFFIX = "run python3 scripts/gen-catalog.py"


def run(root, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args],
        capture_output=True,
        text=True,
    )


def write_skill(root, name, description="Use when testing the catalog generator", fm_name=None,
                body=None):
    """Write skills/<name>/SKILL.md; description=None omits the field.

    A body lands after the heading, so its first line is line 8 of the file.
    """
    d = root / "skills" / name
    d.mkdir(parents=True, exist_ok=True)
    lines = ["---", f"name: {fm_name or name}"]
    if description is not None:
        lines.append(f"description: {description}")
    lines += ["---", "", f"# {name}", ""]
    if body is not None:
        lines.append(body)
    (d / "SKILL.md").write_text("\n".join(lines), encoding="utf-8")


def regen(root):
    """Run non-check mode, which writes root/CATALOG.md and always exits 0."""
    proc = run(root)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return proc


def make_tree(tmp_path):
    write_skill(tmp_path, "alpha")
    (tmp_path / "agents").mkdir()
    (tmp_path / "agents" / "beta.md").write_text("# beta\n", encoding="utf-8")
    regen(tmp_path)
    return tmp_path


def check_lines(proc):
    return proc.stdout.splitlines()


def write(root, rel, text):
    """Write root/rel (creating parent dirs) and return its path."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def assert_stale(proc):
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    stale = [ln for ln in lines if ln.startswith("CATALOG.md:1: catalog-stale:")]
    assert len(stale) == 1, lines
    assert stale[0].endswith(STALE_SUFFIX), stale[0]
    assert lines[-1] == "LINT FAILED (1)"


def test_root_flag_writes_only_tmp_tree(tmp_path):
    root = make_tree(tmp_path)
    catalog = root / "CATALOG.md"
    assert catalog.is_file()
    text = catalog.read_text(encoding="utf-8")
    assert "1 skills." in text
    assert "| `alpha` |" in text


def test_check_passes_on_fresh_tree(tmp_path):
    proc = run(make_tree(tmp_path), "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert check_lines(proc) == ["LINT OK (1 skills)"]


def test_check_flags_stale_catalog(tmp_path):
    root = make_tree(tmp_path)
    with open(root / "CATALOG.md", "a", encoding="utf-8") as f:
        f.write("an extra line\n")
    assert_stale(run(root, "--check"))


def test_check_flags_missing_catalog(tmp_path):
    root = make_tree(tmp_path)
    (root / "CATALOG.md").unlink()
    assert_stale(run(root, "--check"))


def test_frontmatter_violation_has_file_and_line(tmp_path):
    root = make_tree(tmp_path)
    write_skill(root, "alpha", description="Helps with things")
    warned = regen(root)
    assert "skills/alpha/SKILL.md:1: frontmatter:" in warned.stdout

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1
    assert lines[0].startswith("skills/alpha/SKILL.md:1: frontmatter:"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_frontmatter_missing_description_and_name_mismatch(tmp_path):
    root = make_tree(tmp_path)
    write_skill(root, "nodesc", description=None)
    write_skill(root, "mismatch", fm_name="other")
    regen(root)

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1
    assert any(ln.startswith("skills/nodesc/SKILL.md:1: frontmatter:") and "description" in ln for ln in lines), lines
    assert any(ln.startswith("skills/mismatch/SKILL.md:1: frontmatter:") and "'other'" in ln for ln in lines), lines
    assert lines[-1] == "LINT FAILED (2)"


def test_section_sign_reports_line(tmp_path):
    root = make_tree(tmp_path)
    (root / "docs").mkdir()
    # Two signs on line 2 still yield a single violation for that line; line 4
    # holds its own, so the rule is one violation per offending line, not per file.
    body = (
        "clean line\n"
        f"two {SECTION_SIGN} signs {SECTION_SIGN} here\n"
        "clean line\n"
        f"another {SECTION_SIGN} here\n"
    )
    (root / "docs" / "x.md").write_text(body, encoding="utf-8")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1
    hits = [ln for ln in lines if ln.startswith("docs/x.md:")]
    assert len(hits) == 2, lines
    assert hits[0].startswith("docs/x.md:2: section-sign:"), hits[0]
    assert hits[1].startswith("docs/x.md:4: section-sign:"), hits[1]
    assert SECTION_SIGN not in proc.stdout
    assert lines[-1] == "LINT FAILED (2)"


def test_failures_sorted_and_counted(tmp_path):
    root = make_tree(tmp_path)
    write_skill(root, "alpha", fm_name="other")
    (root / "docs").mkdir()
    (root / "docs" / "a.md").write_text(f"bad {SECTION_SIGN}\n", encoding="utf-8")
    regen(root)

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1
    assert len(lines) == 3, lines
    assert lines[0].startswith("docs/a.md:1: section-sign:"), lines
    assert lines[1].startswith("skills/alpha/SKILL.md:1: frontmatter:"), lines
    assert lines[-1] == "LINT FAILED (2)"


def test_unknown_skill_ref_reports_file_and_line(tmp_path):
    root = make_tree(tmp_path)
    write(root, "docs/x.md", "# Notes\n\nSee constellation:not-a-skill for details.\n")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert lines[0].startswith("docs/x.md:3: unknown-skill-ref: constellation:not-a-skill"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_unknown_ref_in_hook_js(tmp_path):
    root = make_tree(tmp_path)
    write(root, "hooks/h.js", "// hook\nconsole.log('run constellation:ghost-skill first');\n")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert lines[0].startswith("hooks/h.js:2: unknown-skill-ref: constellation:ghost-skill"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_skill_and_agent_refs_pass(tmp_path):
    root = make_tree(tmp_path)
    write(root, "docs/x.md", "Use constellation:alpha, then hand off to constellation:beta.\n")

    proc = run(root, "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert check_lines(proc) == ["LINT OK (1 skills)"]


def test_nested_reference_skill_is_not_a_target(tmp_path):
    root = make_tree(tmp_path)
    write(root, "skills/alpha/references/sub/SKILL.md", "# sub\n")
    write(root, "docs/x.md", "Load constellation:sub now.\n")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert lines[0].startswith("docs/x.md:1: unknown-skill-ref: constellation:sub"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_excluded_files_not_scanned(tmp_path):
    root = make_tree(tmp_path)
    bad = "constellation:not-a-skill\n"
    for rel in (
        "skills/alpha/scripts/fixtures/f.md",
        "CHANGELOG.md",
        "scripts/test_x.py",
        "hooks/h.test.js",
        "skills/alpha/scripts/test-x.sh",
        "hooks/node_modules/pkg/x.js",
        "scripts/__pycache__/x.py",
        "docs/.worktrees/x.md",
        "docs/.git/x.md",
    ):
        write(root, rel, bad)

    proc = run(root, "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert check_lines(proc) == ["LINT OK (1 skills)"]


def test_root_inside_dot_worktrees_dir_is_still_scanned(tmp_path):
    root = make_tree(tmp_path / ".worktrees" / "w")
    write(root, "docs/x.md", "# Notes\nSee constellation:not-a-skill.\n")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert lines[0].startswith("docs/x.md:2: unknown-skill-ref:"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_ref_scope_covers_listed_dirs_and_suffixes(tmp_path):
    root = make_tree(tmp_path)
    in_scope = (
        "skills/alpha/references/g.md",
        "agents/beta.md",
        "hooks/lib/l.cjs",
        "docs/d.md",
        "scripts/s.py",
        "scripts/s.sh",
        ".codex/INSTALL.md",
        ".claude-plugin/plugin.json",
        "README.md",
    )
    out_of_scope = ("other/o.md", "docs/d.txt", "package.json", "hooks/h.txt")
    for rel in in_scope + out_of_scope:
        write(root, rel, "constellation:not-a-skill\n")

    proc = run(root, "--check")
    flagged = sorted(ln.split(":", 1)[0] for ln in check_lines(proc) if "unknown-skill-ref" in ln)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert flagged == sorted(in_scope), flagged


def test_ref_pattern_boundaries_and_one_violation_per_ref(tmp_path):
    root = make_tree(tmp_path)
    write(root, "docs/x.md", (
        "a/constellation:foo b.constellation:bar c-constellation:baz d_constellation:qux\n"
        "constellation:one and constellation:two, then constellation:alpha\n"
    ))

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert [ln.split(": ", 2)[0] for ln in lines[:-1]] == ["docs/x.md:2", "docs/x.md:2"], lines
    assert lines[0].startswith("docs/x.md:2: unknown-skill-ref: constellation:one"), lines
    assert lines[1].startswith("docs/x.md:2: unknown-skill-ref: constellation:two"), lines
    assert lines[-1] == "LINT FAILED (2)"


# --- path and bundled-script lints in code spans and fences -------------------------------

DOC = "skills/alpha/references/g.md"


def add_scripts(root):
    """Create the bundled scripts the docs below mention, so only the lint under test fires."""
    for name in ("x.sh", "y.py", "z.cjs"):
        write(root, f"skills/alpha/scripts/{name}", "")


def bare(rel, line, token, interp):
    return f'{rel}:{line}: bare-script: {token} must be run as "{interp} {token}"'


def assert_fails(proc, *expected):
    """Exit 1 with exactly these violation lines, then the count line."""
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert check_lines(proc) == [*expected, f"LINT FAILED ({len(expected)})"]


def assert_clean(proc, skills=1):
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert check_lines(proc) == [f"LINT OK ({skills} skills)"]


def test_bare_script_in_span(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, "Intro.\n\nRun `scripts/x.sh --flag` first.\n")
    assert_fails(run(root, "--check"), bare(DOC, 3, "scripts/x.sh", "bash"))


def test_bare_script_in_fence(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, "Run:\n\n```sh\nscripts/x.sh\n```\n")
    assert_fails(run(root, "--check"), bare(DOC, 4, "scripts/x.sh", "bash"))


def test_python_must_be_python3(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, "Run `python scripts/y.py` first.\n")
    assert_fails(run(root, "--check"), bare(DOC, 1, "scripts/y.py", "python3"))


def test_wrong_interpreter(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, "Run `python3 scripts/x.sh` first.\n")
    assert_fails(run(root, "--check"), bare(DOC, 1, "scripts/x.sh", "bash"))


def test_interpreted_scripts_pass(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "Spans: `bash scripts/x.sh`, `sh scripts/x.sh`, `$ bash scripts/x.sh`,\n"
        "`python3 -u scripts/y.py`, `node scripts/z.cjs` and\n"
        '`python3 "${CLAUDE_PLUGIN_ROOT}/skills/alpha/scripts/y.py"`.\n'
        "\n"
        "```\n"
        "$ bash scripts/x.sh\n"
        "python3 -u scripts/y.py\n"
        "```\n"
    ))
    assert_clean(run(root, "--check"))


def test_prefixed_bare_scripts_flagged(tmp_path):
    """C5 binds every path-prefix form by name; each must be flagged when no interpreter leads."""
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "Spans:\n"
        "`${CLAUDE_PLUGIN_ROOT}/skills/alpha/scripts/y.py`\n"
        "`$CLAUDE_PLUGIN_ROOT/skills/alpha/scripts/y.py`\n"
        "`./scripts/x.sh`\n"
        "\n"
        "```\n"
        "../scripts/x.sh\n"
        "~/scripts/x.sh\n"
        "/abs/skills/alpha/scripts/z.cjs\n"
        "```\n"
    ))
    assert_fails(
        run(root, "--check"),
        bare(DOC, 2, "${CLAUDE_PLUGIN_ROOT}/skills/alpha/scripts/y.py", "python3"),
        bare(DOC, 3, "$CLAUDE_PLUGIN_ROOT/skills/alpha/scripts/y.py", "python3"),
        bare(DOC, 4, "./scripts/x.sh", "bash"),
        bare(DOC, 7, "../scripts/x.sh", "bash"),
        bare(DOC, 8, "~/scripts/x.sh", "bash"),
        bare(DOC, 9, "/abs/skills/alpha/scripts/z.cjs", "node"),
    )


def test_placeholder_prefixed_script_with_interpreter_passes(tmp_path):
    root = make_tree(tmp_path)
    write(root, DOC, (
        "`python3 <plugin root>/skills/alpha/scripts/y.py render <abs PLAN>`\n"
        '`python3 "<root>/skills/alpha/scripts/y.py" render "<path>"`\n'
        '`GITHUB_TOKEN= gh pr create --body "$(bash <git-workflow>/scripts/x.sh)"`\n'
    ))
    assert_clean(run(root, "--check"))


def test_placeholder_prefixed_script_without_interpreter_flagged(tmp_path):
    root = make_tree(tmp_path)
    write(root, DOC, (
        "`<plugin root>/skills/alpha/scripts/y.py render`\n"
        '`"<root>/skills/alpha/scripts/y.py"`\n'
    ))
    assert_fails(
        run(root, "--check"),
        bare(DOC, 1, "<plugin root>/skills/alpha/scripts/y.py", "python3"),
        bare(DOC, 2, "<root>/skills/alpha/scripts/y.py", "python3"),
    )


def test_prose_and_later_mentions_not_flagged(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "The scripts/x.sh helper does the work.\n"
        "\n"
        "Run `cd skills/alpha && scripts/x.sh` from the repo root.\n"
    ))
    assert_clean(run(root, "--check"))


def test_exempt_file_skipped(tmp_path):
    root = make_tree(tmp_path)
    write(root, "skills/brainstorming/scripts/x.sh", "")
    write(root, "skills/brainstorming/references/visual-companion.md", "Run `scripts/x.sh`.\n")
    assert_clean(run(root, "--check"))


def test_missing_reference_path(tmp_path):
    root = make_tree(tmp_path)
    write_skill(root, "alpha", body="Read `references/nope.md` for details.\n")
    proc = run(root, "--check")
    assert proc.returncode == 1, proc.stdout + proc.stderr
    lines = check_lines(proc)
    assert lines[0].startswith("skills/alpha/SKILL.md:8: missing-path: references/nope.md"), lines
    assert lines[-1] == "LINT FAILED (1)"


def test_path_resolves_via_named_skill(tmp_path):
    root = make_tree(tmp_path)
    write_skill(root, "gamma")
    write(root, "skills/gamma/references/guide.md", "# guide\n")
    write_skill(root, "alpha", body="See the `references/guide.md` guide in `constellation:gamma`.\n")
    regen(root)
    assert_clean(run(root, "--check"), skills=2)


def test_prompts_assignments_and_flags_do_not_hide_scripts(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "```\n"
        "$ scripts/x.sh\n"
        "> python scripts/y.py\n"
        "NODE_ENV=test scripts/z.cjs\n"
        "python -u scripts/y.py\n"
        "```\n"
    ))
    assert_fails(
        run(root, "--check"),
        bare(DOC, 2, "scripts/x.sh", "bash"),
        bare(DOC, 3, "scripts/y.py", "python3"),
        bare(DOC, 4, "scripts/z.cjs", "node"),
        bare(DOC, 5, "scripts/y.py", "python3"),
    )


def test_tilde_and_nested_fences_hold_code(tmp_path):
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "~~~\n"
        "scripts/x.sh\n"
        "~~~\n"
        "\n"
        "````md\n"
        "```\n"
        "scripts/y.py\n"
        "```\n"
        "````\n"
    ))
    assert_fails(
        run(root, "--check"),
        bare(DOC, 2, "scripts/x.sh", "bash"),
        bare(DOC, 7, "scripts/y.py", "python3"),
    )


def test_fence_closes_only_on_matching_bare_fence(tmp_path):
    """A closer carries no info string, so ```js stays code; once closed, prose and spans are normal again."""
    root = make_tree(tmp_path)
    add_scripts(root)
    write(root, DOC, (
        "```\n"
        "~~~\n"
        "```js\n"
        "scripts/x.sh\n"
        "```\n"
        "\n"
        "scripts/y.py is prose after the fence.\n"
        "Run `scripts/x.sh` now.\n"
        "```code``` then `scripts/z.cjs`.\n"
    ))
    assert_fails(
        run(root, "--check"),
        bare(DOC, 4, "scripts/x.sh", "bash"),
        bare(DOC, 8, "scripts/x.sh", "bash"),
        bare(DOC, 9, "scripts/z.cjs", "node"),
    )


def test_agent_files_are_linted(tmp_path):
    """Both lints cover agents/*.md, not only skills/**."""
    root = make_tree(tmp_path)
    write(root, "agents/beta.md", "Run `python scripts/y.py` and read `references/nope.md`.\n")
    assert_fails(
        run(root, "--check"),
        bare("agents/beta.md", 1, "scripts/y.py", "python3"),
        "agents/beta.md:1: missing-path: references/nope.md not found in agents",
        "agents/beta.md:1: missing-path: scripts/y.py not found in agents",
    )
