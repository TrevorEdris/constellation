#!/usr/bin/env node
/**
 * Post-Compact Logger - SessionStart(compact) Hook (constellation)
 * After compaction, appends the compact summary to the ACTIVE session's SESSION.md
 * (resolved by session_id / .active pointer / mtime). Preserves decisions across
 * compaction boundaries.
 *
 * @hook {"event":"SessionStart","matcher":"compact","description":"Appends compact summary to the active SESSION.md"}
 */
const fs = require('fs');
const path = require('path');
const { DEFAULT_SESSION_ROOT, resolveSessionDir, sessionIdFromStdin } = require('./lib/session');

function appendCompactSummary(sessionDir, summary) {
  const sessionMd = path.join(sessionDir, 'SESSION.md');
  if (!fs.existsSync(sessionMd)) return;
  const block = ['', '## Compact Summary', `> Recorded: ${new Date().toISOString()}`, '', summary.trim(), ''].join('\n');
  fs.appendFileSync(sessionMd, block);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input || '{}');
    // SessionStart(compact) exposes the summary as `compact_summary` (or nested under source).
    const summary = payload.compact_summary || (payload.hookSpecificOutput && payload.hookSpecificOutput.compact_summary);
    if (summary) {
      const sessionDir = resolveSessionDir(DEFAULT_SESSION_ROOT, { sessionId: sessionIdFromStdin(input) });
      if (sessionDir) appendCompactSummary(sessionDir, summary);
    }
  } catch { /* cannot block */ }
  console.log('{}');
}

if (require.main === module) main();
else module.exports = { appendCompactSummary };
