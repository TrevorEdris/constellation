# How constellation skills adapt per platform

Constellation targets **Claude Code** and **Codex**. Skills are authored once as portable `SKILL.md` files (frontmatter limited to `name` + `description` — the field intersection both tools read). Platform variation is isolated here, not duplicated into every skill.

## What each platform gets

| Artifact | Claude Code | Codex |
|---|---|---|
| `skills/<name>/SKILL.md` | via plugin manifest | via `~/.agents/skills/constellation` symlink |
| `agents/*.md` (subagents) | yes | degrades to single-session (needs `multi_agent=true`) |
| `commands/*.md` (slash commands) | yes | use the skill or AGENTS.md instead |
| `hooks/*` | yes | not supported — equivalent intent lives in AGENTS.md/rules |
| `rules/*.md` | via CLAUDE.md | via AGENTS.md |

## Tool names

Skills name Claude Code tools (`Task`, `TodoWrite`, `Read`/`Write`/`Edit`, `Bash`). On Codex, translate via `codex-tools.md` in this directory.

## Adding a platform later

Add a manifest + a tool-mapping file here; do not edit every skill. SKILL.md bodies stay portable. The per-skill `references/` directory is the seam for later Open Knowledge Format (OKF) alignment — add `type:` frontmatter + markdown cross-links there without touching SKILL.md.
