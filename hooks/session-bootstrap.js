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
 * alone; a first prompt that names a PLAN inside the root binds the session to
 * that PLAN's dir; a dir the agent made by hand this session is stamped with
 * the session id and bound; headless runs (`claude -p`, the Agent SDK) are
 * skipped unless CONSTELLATION_SCAFFOLD=always; anything else is scaffolded by
 * new-session.sh.
 *
 * @hook {"event":"Stop","matcher":"","description":"Auto-scaffolds a SESSION.md from the real session title"}
 */
const { execFileSync } = require('child_process');
const path = require('path');
const {
  sessionRoot, today, isValidSessionId, readPointer, bindSession, resolveSessionDir,
  sessionDirFromPrompt, findAdoptableDir, stampSessionId,
  isHeadless, latestCustomTitle, firstRealPromptText, detectTicket, slugifyTitle,
} = require('./lib/session');

const PLUGIN_ROOT = path.dirname(__dirname);
const FAILURE_PREFIX = 'Constellation session journal not created: ';

function firstLine(text) {
  return String(text || '').split('\n').map(l => l.trim()).find(Boolean) || '';
}

/** Runs new-session.sh; returns null on success or the first line saying why it failed. */
function scaffold({ slug, ticket, sessionId }) {
  const script = path.join(PLUGIN_ROOT, 'scripts', 'new-session.sh');
  try {
    // The script writes the pointer too, so there is nothing to bind afterwards.
    // Its stdout (the new dir) is piped away: a hook prints exactly one JSON object.
    execFileSync('bash', [script, slug, ticket || '', sessionId], {
      env: { ...process.env, SESSION_DATE: today() },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return null;
  } catch (err) {
    return firstLine(err.stderr) || firstLine(err.message) || 'new-session.sh failed';
  }
}

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

  // A first prompt that names a PLAN inside the root puts the session in that
  // PLAN's dir. Binding comes first (and stamping, below, only after it), so a
  // pointer that cannot be written leaves the dir untouched and falls through.
  const firstPrompt = firstRealPromptText(transcriptPath) || '';
  const planDir = sessionDirFromPrompt(root, firstPrompt);
  if (planDir && bindSession(root, sessionId, planDir)) { console.log('{}'); return; }

  // A dir the agent made by hand this session is the session's journal.
  const adopted = findAdoptableDir(root, transcriptPath);
  if (adopted && bindSession(root, sessionId, adopted)) {
    stampSessionId(adopted, sessionId);
    console.log('{}');
    return;
  }

  if (isHeadless(process.env, transcriptPath)) { console.log('{}'); return; }

  const title = latestCustomTitle(transcriptPath) || firstPrompt;
  if (!title) { console.log('{}'); return; }

  const ticket = detectTicket(title) || detectTicket(firstPrompt);
  const failure = scaffold({ slug: slugifyTitle(title, ticket), ticket, sessionId });

  console.log(failure ? JSON.stringify({ systemMessage: FAILURE_PREFIX + failure }) : '{}');
}

if (require.main === module) main();
else module.exports = { main };
