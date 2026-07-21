#!/usr/bin/env node
/**
 * Session Reminder - UserPromptSubmit Hook (constellation)
 * Points the agent at the active SESSION.md once session-bootstrap.js
 * (Stop hook) has scaffolded it; on turn 1 injects a heads-up instead of
 * instructing the agent to run a script by hand.
 *
 * @hook {"event":"UserPromptSubmit","matcher":"","description":"Points the agent at the active SESSION.md"}
 */
const { DEFAULT_SESSION_ROOT, resolveSessionDir, sessionIdFromStdin } = require('./lib/session');
const path = require('path');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const sessionDir = resolveSessionDir(DEFAULT_SESSION_ROOT, { sessionId: sessionIdFromStdin(input) });
  const message = sessionDir
    ? `Session journal: ${path.join(sessionDir, 'SESSION.md')} (auto-scaffolded). Keep '## Decisions' and '## Status' current.`
    : 'A session journal will be scaffolded automatically after this turn, named from this session\'s title.';
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message } }));
}

if (require.main === module) main();
else module.exports = { main };
