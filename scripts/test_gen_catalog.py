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


def write_skill(root, name, description="Use when testing the catalog generator", fm_name=None):
    """Write skills/<name>/SKILL.md; description=None omits the field."""
    d = root / "skills" / name
    d.mkdir(parents=True, exist_ok=True)
    lines = ["---", f"name: {fm_name or name}"]
    if description is not None:
        lines.append(f"description: {description}")
    lines += ["---", "", f"# {name}", ""]
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
    # Two signs on line 2 still yield a single violation for that line.
    body = f"clean line\ntwo {SECTION_SIGN} signs {SECTION_SIGN} here\nclean line\n"
    (root / "docs" / "x.md").write_text(body, encoding="utf-8")

    proc = run(root, "--check")
    lines = check_lines(proc)
    assert proc.returncode == 1
    hits = [ln for ln in lines if ln.startswith("docs/x.md:")]
    assert len(hits) == 1, lines
    assert hits[0].startswith("docs/x.md:2: section-sign:"), hits[0]
    assert SECTION_SIGN not in proc.stdout
    assert lines[-1] == "LINT FAILED (1)"


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
