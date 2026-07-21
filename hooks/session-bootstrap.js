#!/usr/bin/env node
/**
 * Session Bootstrap - Stop Hook (constellation)
 * Scaffolds .ai/sessions/<DATE>_<TICKET?>_<Slug>/ from Claude Code's own
 * custom-title (not an agent-invented slug). Stop is used because
 * custom-title is written on turn 1 before the first assistant reply.
 *
 * @hook {"event":"Stop","matcher":"","description":"Auto-scaffolds session dir from the real session title"}
 */
const { execFileSync } = require('child_process');
const path = require('path');
const {
  DEFAULT_SESSION_ROOT, resolveSessionDir, sessionIdFromStdin,
  latestCustomTitle, firstRealPromptText, detectTicket, slugifyTitle,
} = require('./lib/session');

const PLUGIN_ROOT = path.dirname(__dirname);

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try { payload = JSON.parse(input || '{}'); } catch { payload = {}; }
  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;

  if (!transcriptPath || resolveSessionDir(DEFAULT_SESSION_ROOT, { sessionId })) {
    console.log('{}');
    return;
  }

  const title = latestCustomTitle(transcriptPath) || firstRealPromptText(transcriptPath);
  if (!title) { console.log('{}'); return; }

  const firstPrompt = firstRealPromptText(transcriptPath) || '';
  const ticket = detectTicket(title) || detectTicket(firstPrompt);
  const slug = slugifyTitle(title, ticket);
  const script = path.join(PLUGIN_ROOT, 'scripts', 'new-session.sh');
  const args = ticket ? [slug, ticket, sessionId || ''] : [slug, '', sessionId || ''];

  try {
    execFileSync(script, args, { stdio: 'ignore' });
  } catch { /* Stop hook cannot block */ }

  console.log('{}');
}

if (require.main === module) main();
else module.exports = { main };
