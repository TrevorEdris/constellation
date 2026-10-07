#!/usr/bin/env node
/**
 * Session Reminder - UserPromptSubmit Hook (constellation)
 * Tells the agent where its session journal is, once per session rather than
 * on every prompt. <root>/.sessions/<id>.announced records what it was last
 * told: a dir, or `pending`.
 *
 *   - a session dir resolves and differs from the marker: say where it is, and
 *     record the dir (this also fires when the session is bound to a new dir)
 *   - no dir, no marker, and not a headless run: promise that one is coming
 *     (the Stop hook scaffolds it or adopts the agent's own), and record `pending`
 *   - anything else: stay silent
 *
 * session-start.js says the journal line again after a compaction, which wipes
 * what this hook said. A missing or invalid session id prints {} and touches nothing.
 *
 * @hook {"event":"UserPromptSubmit","matcher":"","description":"Tells the agent where its SESSION.md is, once per session"}
 */
const {
  sessionRoot, resolveSessionDir, isValidSessionId, isHeadless,
  readMarker, writeMarker, journalLine, pendingLine,
} = require('./lib/session');

const PENDING = 'pending';

function emit(message) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message } }));
}

/** The line to tell the agent now, or null when it already knows. Records what it returns. */
function nextAnnouncement(root, sessionId, transcriptPath) {
  const marker = readMarker(root, sessionId);
  const dir = resolveSessionDir(root, { sessionId });
  if (dir) {
    if (dir === marker) return null;
    writeMarker(root, sessionId, dir);
    return journalLine(dir);
  }
  if (marker !== null || isHeadless(process.env, transcriptPath)) return null;
  writeMarker(root, sessionId, PENDING);
  return pendingLine(root);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try { payload = JSON.parse(input || '{}'); } catch { payload = {}; }
  if (!payload || typeof payload !== 'object') payload = {};

  let message = null;
  try {
    if (isValidSessionId(payload.session_id)) {
      message = nextAnnouncement(sessionRoot(), payload.session_id, payload.transcript_path);
    }
  } catch { /* a reminder cannot block the prompt */ }
  if (message) emit(message); else console.log('{}');
}

if (require.main === module) main();
else module.exports = { main };
