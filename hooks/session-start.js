#!/usr/bin/env node
/**
 * SessionStart hook for the constellation plugin (Node).
 * Injects the using-constellation router skill verbatim at startup|clear|compact
 * so the skill that tells the agent to use skills is always present.
 *
 * When the session already has a journal dir, the journal line follows the
 * router and the dir is recorded as announced. This is what restores the line
 * after a compaction, which drops the one the prompt hook said earlier. With a
 * missing or invalid session id, or no dir, there is no journal line and no marker.
 *
 * @hook {"event":"SessionStart","matcher":"startup|clear|compact","description":"Injects the using-constellation router at session start"}
 */
const fs = require('fs');
const path = require('path');
const {
  sessionRoot, resolveSessionDir, isValidSessionId, writeMarker, journalLine,
} = require('./lib/session');

const PLUGIN_ROOT = path.dirname(__dirname);

/** The journal line for this session, or '' when it has no id or no dir yet. Records the dir as announced. */
function journalSuffix(input) {
  let payload;
  try { payload = JSON.parse(input || '{}'); } catch { return ''; }
  const sessionId = payload && payload.session_id;
  if (!isValidSessionId(sessionId)) return '';
  const root = sessionRoot();
  const dir = resolveSessionDir(root, { sessionId });
  if (!dir) return '';
  writeMarker(root, sessionId, dir);
  return `\n\n${journalLine(dir)}`;
}

async function main() {
  let input = '';
  if (!process.stdin.isTTY) {
    try { for await (const chunk of process.stdin) input += chunk; } catch { /* no stdin: no journal line */ }
  }
  let journal = '';
  try { journal = journalSuffix(input); } catch { /* the router matters more than the journal line */ }

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
    '\n</EXTREMELY_IMPORTANT>' +
    journal;

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
