# Claude Code ↔ Codex parity matrix

Constellation targets Claude Code and Codex. Skills are portable; everything else degrades gracefully.

| Feature | Claude Code | Codex | Notes |
|---|---|---|---|
| Skills (`skills/<name>/SKILL.md`) | ✅ plugin manifest | ✅ `~/.agents/skills/constellation` symlink | Both read `name`+`description`; body progressive-disclosed |
| Skill auto-trigger | ✅ description match | ✅ description match | Description quality drives both — keep it WHEN-only |
| Subagents (`agents/`) | ✅ | ⚠️ needs `multi_agent=true`; else single-session | `Task` → `spawn_agent`/`wait`/`close_agent` |
| Slash commands (`commands/`) | ✅ | ❌ use skill or AGENTS.md | — |
| Hooks (`hooks/`) | ✅ | ❌ | Session bootstrap + safety + session-doc automation are CC-only; intent mirrored in AGENTS.md/rules |
| Output styles / personas | not shipped | not shipped | Personas are a fellowship-of-the-workflows feature; constellation only keeps the rule that personas apply to live chat, never committed files |
| Rules (`rules/`) | ✅ via CLAUDE.md | ✅ via AGENTS.md | Same body; emitted into each bootstrap |
| Tool names | native | translate via `skills/_shared/platform/codex-tools.md` | `TodoWrite`→`update_plan`, etc. |
| `Workflow` JS orchestration | ✅ | ❌ | Codex falls back to sequential `spawn_agent` |

## Degradation principle
A skill must still be correct on Codex even when CC-only machinery is absent — it just runs without the automation (e.g. no SessionStart injection, no parallel fan-out). Author skill bodies so they never hard-depend on a hook or a slash command.

## Open Knowledge Format (OKF) seam
OKF v0.1 (Google, ~June 2026) is a knowledge/context format, not a skills format. Constellation skills are already Agent Skills/SKILL.md compliant (zero migration). If a curated reference corpus is later added, the per-skill `references/` dirs are the OKF surface: add `type:` frontmatter + markdown cross-links there. Do not adopt OKF v0.1 now.
