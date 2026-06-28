#!/usr/bin/env bash
# Install constellation for Codex (local, symlink-based).
#
#   scripts/install.sh            # link skills into ~/.agents/skills/constellation
#   scripts/install.sh --dry-run  # print what would happen, change nothing
#
# Claude Code does NOT need this script — it loads the plugin natively:
#     /plugin marketplace add  <this repo path>
#     /plugin install constellation@constellation
# That wires skills + agents + commands + hooks via the manifest. Symlinking
# skills into ~/.claude/skills would double-register them and skip hook/agent
# wiring, so we don't.
#
# Codex has no plugin system; it discovers skills via the official ~/.agents/skills
# path, which this script links.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
run() { if [ "$DRY" -eq 1 ]; then echo "DRY  $*"; else echo "RUN  $*"; eval "$@"; fi; }

CODEX_SKILLS="${HOME}/.agents/skills"
echo "== Codex: ${CODEX_SKILLS}/constellation -> ${PLUGIN_ROOT}/skills"
run "mkdir -p '${CODEX_SKILLS}'"
run "ln -sfn '${PLUGIN_ROOT}/skills' '${CODEX_SKILLS}/constellation'"

cat <<EOF

Codex next steps:
  - add [features] multi_agent = true to ~/.codex/config.toml (for subagent skills)
  - point Codex at ${PLUGIN_ROOT}/AGENTS.md

Claude Code (no script needed):
  /plugin marketplace add ${PLUGIN_ROOT}
  /plugin install constellation@constellation
EOF
