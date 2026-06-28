---
name: update-docs
description: "Use when syncing documentation with code changes -- after completing a feature, fixing a bug, or before a release; detecting stale docs and updating READMEs, changelogs, or API docs."
user-invocable: true
argument-hint: "[readme|changelog|api-docs|all]"
context: fork
agent: documentation-sync
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status), Bash(python:*), Grep, Glob, LS, Read, Write
tags: [documentation]
tier: core
---

# Update Docs

Analyze recent code changes and synchronize documentation to match the current state of the codebase.

---

## Context

GIT STATUS:

```
!`git status`
```

RECENT COMMITS (last 20):

```
!`git log --oneline -20`
```

FILES CHANGED SINCE LAST TAG:

```
!`git diff --name-only $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD 2>/dev/null || git diff --name-only HEAD~10..HEAD`
```

EXISTING DOCUMENTATION FILES:

```
!`find . -maxdepth 3 \( -name "README.md" -o -name "CHANGELOG.md" -o -name "*.api.md" \) | grep -v node_modules | grep -v .git | head -30`
```

---

## Mode Selection

Select the mode that matches the current task. Default to **Post-implementation sync** when invoked without arguments.

| Mode | When to Use | Trigger phrase |
|------|-------------|----------------|
| **Post-implementation sync** | After completing a feature, fix, or refactor | (default) |
| **Staleness audit** | Periodic check of all docs, pre-release | "audit docs" or "check staleness" |
| **Changelog generation** | Cut a release, document a commit range | "generate changelog" or "changelog since v1.2" |
| **Full doc refresh** | Regenerate all auto-generated sections from scratch | "full refresh" or "rebuild docs" |

---

## Post-Implementation Sync Workflow

### Phase 1 — Analyze Changes

Run `scripts/scan_doc_targets.py` to identify which documentation files are affected by recent file changes:

```bash
python scripts/scan_doc_targets.py --since $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~10")
```

Then read the diff to classify the semantic nature of changes:
- New feature: new exported functions, new routes, new CLI commands
- Bug fix: corrected logic with no API surface change
- Refactor: restructured internals, no behavior change
- Breaking change: removed or renamed public API, changed required parameters

Map changed files to documentation owners using the file-to-doc mapping table in the agent definition.

### Phase 2 — Detect Staleness

Run `scripts/detect_staleness.py` to classify current doc freshness:

```bash
python scripts/detect_staleness.py --path .
```

Flag all docs classified as STALE or VERY_STALE. SLIGHTLY_STALE docs are noted but not automatically updated unless they fall within the affected set from Phase 1.

### Phase 3 — Generate Updates

For each affected doc:

1. Read the existing file.
2. Identify `<!-- AUTO-GENERATED:START -->` / `<!-- AUTO-GENERATED:END -->` markers.
3. Generate updated content for each marked section based on the current code state.
4. Write only inside the markers. Do not touch content outside them.
5. If markers do not exist on a doc that needs updating, propose adding them to the user before writing.

By change type:
- **New feature:** Add section to README, add changelog entry under `Added`.
- **Breaking change:** Update affected README sections, add changelog entry under `Changed` with migration note.
- **Bug fix:** Add changelog entry under `Fixed`. Update README examples only if they demonstrated the bug.
- **Refactor:** Add changelog entry under `Changed` if the public interface or behavior changed.

### Phase 4 — Validate

Before finalizing output:
- Verify all file paths referenced in generated docs exist.
- Confirm code examples match current function/method signatures.
- Ensure no `TODO`, `TBD`, `FIXME`, or `<placeholder>` strings appear in generated sections.
- Confirm every `AUTO-GENERATED:START` marker has a matching `AUTO-GENERATED:END` marker.

### Phase 5 — Report

Produce the documentation sync report (format defined in the agent). Include:
- All docs updated (with rationale)
- All docs created
- Stale docs that require manual attention
- Docs that required no changes

---

## Staleness Audit Mode

Scan all documentation files in the repository and classify their freshness:

```bash
python scripts/detect_staleness.py --path . --output markdown
```

Present results as a sorted table: VERY_STALE first, then STALE, SLIGHTLY_STALE, FRESH. For each stale doc, identify what source file(s) have changed since the doc was last updated.

---

## Changelog Generation Mode

Generate changelog entries for a specific commit range:

```bash
python scripts/scan_doc_targets.py --since <ref>
```

Then group commits by classification (Added / Changed / Fixed / etc.) and write entries to the `[Unreleased]` section of `CHANGELOG.md`.

If no `CHANGELOG.md` exists, create one using `references/CHANGELOG_TEMPLATE.md` as the base.

---

## Full Doc Refresh Mode

Regenerate all auto-generated sections across all docs:

1. Run `scripts/scan_doc_targets.py --since $(git rev-list --max-parents=0 HEAD)` to get the full file list.
2. For each doc with `AUTO-GENERATED` markers, regenerate each section from current source.
3. Validate all generated content (paths, signatures, links, placeholders).
4. Produce a full report of what was regenerated.

---

## Scripts

```bash
python scripts/detect_staleness.py [--path <dir>] [--output json|markdown]
python scripts/scan_doc_targets.py [--since <ref>] [--output json|markdown]
```

---

## References

- `references/README_TEMPLATE.md` — Standard README structure with auto-generated markers
- `references/CHANGELOG_TEMPLATE.md` — Keep a Changelog format template
- `references/DOC_STYLE_GUIDE.md` — Writing standards for generated documentation
