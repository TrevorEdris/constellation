# Constellation

A Claude Code + Codex skills plugin: a curated set of skills that work together for a complete dev workflow — brainstorm, plan, TDD, debug, review, ship — with reliable triggering, enforced discipline, and automated session documentation.

## What you get
- **Discipline that holds under pressure** — TDD, systematic debugging, and verification skills with bright-line rules, rationalization tables, and verification gates, so steps don't get skipped.
- **A spec-driven delivery loop** — PRD → roadmap → plan (scored gate) → TDD build → review (code / security / chaos) → ship.
- **Parallel execution** — orchestration and subagent-driven development for fan-out work.
- **Automated session docs** — `.ai/sessions/` scaffolding named automatically from Claude Code's own session title, pre-compact snapshots, and handoffs, maintained by hooks.
- **One portable source for Claude Code and Codex.**

## Layout
- `skills/<name>/SKILL.md` — portable skills (one source, read by both CC and Codex). Full list: `CATALOG.md`.
- `agents/` — specialist subagents for dispatched review and debugging.
- `hooks/` — session bootstrap, safety guards, and session-doc automation.
- `rules/` — standing conventions. `docs/` — design notes, PLAN v2 template, CC↔Codex parity matrix.
- `scripts/` — `install.sh`, `gen-catalog.py`, `gen-bootstrap.py`, `new-session.sh`, `state.js` (a session's workflow state as JSON).

## Install

**Claude Code** — load as a plugin:
```
/plugin marketplace add TrevorEdris/constellation
/plugin install constellation@constellation
```
This wires skills, agents, and hooks from the manifest.

**Codex** — symlink skills into the official `~/.agents/skills/` path:
```bash
bash scripts/install.sh            # link skills for Codex
bash scripts/install.sh --dry-run  # preview
```
See `.codex/INSTALL.md`.

## Console pane
Claude Code only. `/constellation` opens a pane beside the transcript (inline above the prompt where the terminal cannot dock it) that shows the session's workflow state: the session dir, the phases drawn as a small star chart with the approval gate, each plan's validator score, size and open questions, the session files with their ages, the skills used, and each plan's delivery branch with a warning when you are on another one. Click a session file or a plan to read it in the pane; a delivery branch with a pull request links to it (looked up with `gh`). Its buttons steer the work by prompting Claude: validate or render the plan card, continue, save a handoff. Approve and Request changes only fill the prompt, so you finish the reply yourself. The status line shows the phase even with the pane closed. `/constellation open` and `/constellation close` force either state.

The pane reads `node scripts/state.js --session-id <id>`, which prints the same state as JSON.

## Adding a skill
Drop `skills/<name>/SKILL.md` (frontmatter: `name` + `description` only; description starts with "Use when …"). Run `python scripts/gen-catalog.py` to register it. No manifest edit needed.

## Design principles
1. One portable `SKILL.md` per skill — no per-platform forks.
2. `description` = WHEN to trigger, never a workflow summary.
3. Discipline skills carry an Iron Law + rationalization table + verification gate.
4. CC-only machinery (hooks, subagents) degrades gracefully on Codex.

## Credits
Builds on ideas from [superpowers](https://github.com/obra/superpowers) (skill-effectiveness discipline) and fellowship-of-the-workflows (spec-driven planning and session automation).
