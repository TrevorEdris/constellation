#!/usr/bin/env node
/**
 * Session Bootstrap - Stop Hook (constellation)
 * Gives a session its journal: scaffolds <root>/<DATE>_<TICKET?>_<Slug>/SESSION.md,
 * named from Claude Code's own custom-title (not an agent-invented slug), stamped
 * with the session_id and bound through <root>/.sessions/<id>. Stop is used
 * because custom-title is written on turn 1 before the first assistant reply.
 *
 * Order: no valid session id or no transcript does nothing; a session that
 * already resolves (rebinding its pointer if only a scan found it) is left
 * alone; headless runs (`claude -p`, the Agent SDK) get no journal and do
 * nothing more, unless CONSTELLATION_SCAFFOLD=always; anything else goes to
 * ensureJournal (PLAN binding, then adoption, then new-session.sh).
 *
 * Stop does not run when a turn is interrupted. session-reminder.js covers
 * that case by calling ensureJournal on the next prompt.
 *
 * @hook {"event":"Stop","matcher":"","description":"Auto-scaffolds a SESSION.md from the real session title"}
 */
const {
  sessionRoot, isValidSessionId, readPointer, bindSession, resolveSessionDir,
  isHeadless, ensureJournal,
} = require('./lib/session');

const FAILURE_PREFIX = 'Constellation session journal not created: ';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try { payload = JSON.parse(input || '{}'); } catch { payload = {}; }
  if (!payload || typeof payload !== 'object') payload = {};
  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;

  if (!isValidSessionId(sessionId) || typeof transcriptPath !== 'string' || !transcriptPath) {
    console.log('{}');
    return;
  }

  const root = sessionRoot();
  const resolved = resolveSessionDir(root, { sessionId });
  if (resolved) {
    // Only a scan can have found it without a pointer; bind so the next lookup is direct.
    if (!readPointer(root, sessionId)) bindSession(root, sessionId, resolved);
    console.log('{}');
    return;
  }

  // Headless runs get no journal. This comes before PLAN binding and adoption:
  // workflow subagents are briefed with a PLAN path under the root, and binding
  // each of them would aim all of them at that one dir's SESSION.md.
  if (isHeadless(process.env, transcriptPath)) { console.log('{}'); return; }

  const { failure } = ensureJournal(root, sessionId, transcriptPath);
  console.log(failure ? JSON.stringify({ systemMessage: FAILURE_PREFIX + failure }) : '{}');
}

if (require.main === module) main();
else module.exports = { main };
