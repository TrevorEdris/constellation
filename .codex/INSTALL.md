# Installing constellation for Codex

Codex discovers skills from `.agents/skills/` (NOT `.codex/skills/`). Scan order: repo `.agents/skills` (cwd up to repo root), then user `~/.agents/skills`, then admin `/etc/codex/skills`.

## User-scope install (all projects)

```bash
mkdir -p ~/.agents/skills
ln -s /Users/tedris/src/constellation/skills ~/.agents/skills/constellation
```

Or run the installer, which links both Claude Code and Codex targets:

```bash
bash /Users/tedris/src/constellation/scripts/install.sh
```

## Project-scope install (one repo)

```bash
mkdir -p .agents/skills
ln -s /Users/tedris/src/constellation/skills .agents/skills/constellation
```

## Enable subagent skills

Skills that dispatch subagents (`dispatching-parallel-agents`, `subagent-driven-development`, `orchestrate`) need:

```toml
# ~/.codex/config.toml
[features]
multi_agent = true
```

## Instruction file

Codex reads `AGENTS.md` at the repo root and `~/.codex/AGENTS.md` globally. Point it at this plugin by copying or sourcing the contents of `/Users/tedris/src/constellation/AGENTS.md`.

## Verify

```bash
ls -l ~/.agents/skills/constellation        # symlink resolves to the plugin skills/
```
Then in Codex: `/skills` should list constellation skills.
