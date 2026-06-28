#!/usr/bin/env node
/**
 * SessionStart hook for the constellation plugin (Node).
 * Injects the using-constellation router skill verbatim at startup|clear|compact
 * so the skill that tells the agent to use skills is always present.
 *
 * @hook {"event":"SessionStart","matcher":"startup|clear|compact","description":"Injects the using-constellation router at session start"}
 */
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.dirname(__dirname);

function main() {
  let router;
  try {
    router = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'using-constellation', 'SKILL.md'), 'utf8');
  } catch {
    router = 'Error reading using-constellation skill';
  }

  const context =
    '<EXTREMELY_IMPORTANT>\n' +
    'You have constellation skills.\n\n' +
    "**Below is the full content of your 'constellation:using-constellation' skill - your introduction to using skills. " +
    "For all other skills, use the 'Skill' tool (Claude Code) or native skill discovery (Codex). " +
    'The full catalog is in CATALOG.md at the plugin root.**\n\n' +
    router +
    '\n</EXTREMELY_IMPORTANT>';

  // Emit only the field the current platform consumes (avoid double injection).
  // JSON.stringify handles all escaping — no manual escape passes needed.
  let payload;
  if (process.env.CURSOR_PLUGIN_ROOT) {
    payload = { additional_context: context };
  } else if (process.env.CLAUDE_PLUGIN_ROOT) {
    payload = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
  } else {
    payload = { additional_context: context };
  }
  process.stdout.write(JSON.stringify(payload));
}

main();
