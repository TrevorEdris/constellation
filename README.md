# Constellation

A local Claude Code + Codex skills plugin: **superpowers' bulletproofed discipline** merged with the **fellowship-of-the-workflows** skills and customizations actually used in this workspace.

## Why
- **superpowers** is exceptional at making skills *trigger reliably* and *resist agent rationalization under pressure* (Iron Laws, harvested rationalization tables, verification gates, adversarial review). See `docs/SUPERPOWERS-EFFECTIVENESS.md`.
- **fellowship-of-the-workflows** brings the breadth, the spec-driven planning pipeline, automated session documentation, and the customizations that fit this workflow.

Constellation takes the best of both: superpowers' discipline applied to a curated, usage-driven set of fotw skills.

## Layout
- `skills/<name>/SKILL.md` — portable skills (one source, read by both CC and Codex). Full list: `CATALOG.md`.
- `agents/`, `commands/`, `hooks/` — Claude Code subagents, slash commands, and hooks (session bootstrap, safety, session-doc automation).
- `rules/` — standing conventions. `docs/` — distillation doc, PLAN v2 template, CC↔Codex parity matrix.
- `scripts/` — `install.sh`, `gen-catalog.py`, `gen-bootstrap`.

## Install
```bash
bash scripts/install.sh            # symlink skills for Claude Code + Codex
bash scripts/install.sh --dry-run  # preview
```
Codex uses the official `~/.agents/skills/` discovery path. See `.codex/INSTALL.md`.

## Adding a skill
Drop `skills/<name>/SKILL.md` (frontmatter: `name` + `description` only, description starts with "Use when …"). Run `python scripts/gen-catalog.py` to register it. No manifest edit needed.

## Design principles
1. One portable `SKILL.md` per skill — no per-platform forks.
2. `description` = WHEN to trigger, never a workflow summary.
3. Discipline skills carry an Iron Law + rationalization table + verification gate.
4. CC-only machinery (hooks, commands, subagents) degrades gracefully on Codex.

Status: in active build. See the build session under `~/src/.ai/sessions/2026-06-26_Constellation-Plugin-Build/`.
