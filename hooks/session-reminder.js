#!/usr/bin/env node
/**
 * Session Reminder - UserPromptSubmit Hook (constellation)
 * If no session dir exists for today, nudge the agent to scaffold one via the
 * constellation:session-bootstrap skill (which CREATES the dir + docs from
 * templates and sets the .active pointer) rather than just hand-creating it.
 *
 * @fotw-hook {"event":"UserPromptSubmit","matcher":"","description":"Nudges agent to scaffold a session via session-bootstrap"}
 */
const fs = require('fs');
const { DEFAULT_SESSION_ROOT, today } = require('./lib/session');

function checkSession(sessionRoot = DEFAULT_SESSION_ROOT) {
  try {
    if (fs.readdirSync(sessionRoot).some(e => e.startsWith(today() + '_'))) return { remind: false, message: '' };
  } catch { /* dir missing */ }
  return {
    remind: true,
    message: `REMINDER: No session directory for ${today()}. Invoke the constellation:session-bootstrap skill to scaffold ${sessionRoot}/${today()}_<TICKET>_<TITLE_SLUG>/ (SESSION.md, DISCOVERY.md, PLAN.md from templates) and set the .active pointer.`,
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const r = checkSession();
    if (r.remind) {
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: r.message } }));
      return;
    }
  } catch { /* fall through */ }
  console.log('{}');
}

if (require.main === module) main();
else module.exports = { checkSession };
