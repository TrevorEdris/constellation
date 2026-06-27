#!/usr/bin/env bash
# Install constellation for Claude Code and Codex (local, symlink-based).
#
#   scripts/install.sh            # link skills for both CC and Codex
#   scripts/install.sh --dry-run  # print what would happen, change nothing
#
# Claude Code: links each skill into ~/.claude/skills so skills are available
#   immediately. For full plugin features (hooks, commands, agents), also add
#   the local marketplace (printed at the end).
# Codex: links skills/ into ~/.agents/skills/constellation (official path).

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

run() { if [ "$DRY" -eq 1 ]; then echo "DRY  $*"; else echo "RUN  $*"; eval "$@"; fi; }

CC_SKILLS="${HOME}/.claude/skills"
CODEX_SKILLS="${HOME}/.agents/skills"

echo "== Codex target: ${CODEX_SKILLS}/constellation -> ${PLUGIN_ROOT}/skills"
run "mkdir -p '${CODEX_SKILLS}'"
run "ln -sfn '${PLUGIN_ROOT}/skills' '${CODEX_SKILLS}/constellation'"

echo "== Claude Code target: per-skill symlinks under ${CC_SKILLS}"
run "mkdir -p '${CC_SKILLS}'"
for d in "${PLUGIN_ROOT}"/skills/*/; do
  name="$(basename "$d")"
  [ "$name" = "_shared" ] && continue
  [ -f "${d}SKILL.md" ] || continue
  run "ln -sfn '${d%/}' '${CC_SKILLS}/${name}'"
done

cat <<EOF

Next steps:
  Claude Code (full plugin: hooks/commands/agents):
    /plugin marketplace add ${PLUGIN_ROOT}
    /plugin install constellation@constellation-dev
  Codex:
    add [features] multi_agent = true to ~/.codex/config.toml (for subagent skills)
    point Codex at ${PLUGIN_ROOT}/AGENTS.md
EOF
