#!/usr/bin/env node
/**
 * Post-Compact Logger - PostCompact Hook (constellation)
 * After compaction, appends the compact summary to COMPACT-LOG.md in the
 * session's dir (resolved by the session_id pointer or SESSION.md scan), so
 * decisions survive the compaction boundary. Claude Code sends `compact_summary`
 * only on PostCompact, which is why this is not a SessionStart hook. SESSION.md
 * is never written: it is the agent's own journal. A missing or invalid session
 * id, no resolvable dir, or no summary prints {} and writes nothing.
 *
 * @hook {"event":"PostCompact","matcher":"","description":"Appends the compact summary to COMPACT-LOG.md in the session dir"}
 */
const fs = require('fs');
const path = require('path');
const { sessionRoot, today, resolveSessionDir } = require('./lib/session');

/** Local time as ISO 8601 with its UTC offset, e.g. 2026-10-07T09:30:00-05:00. */
function localIso(now) {
  const pad = n => String(n).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${today(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function appendCompactSummary(sessionDir, summary, now = new Date()) {
  const block = `\n## Compact summary (${localIso(now)})\n\n${summary.trim()}\n`;
  fs.appendFileSync(path.join(sessionDir, 'COMPACT-LOG.md'), block);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input || '{}');
    const summary = payload && payload.compact_summary;
    if (typeof summary === 'string' && summary.trim()) {
      const sessionDir = resolveSessionDir(sessionRoot(), { sessionId: payload.session_id });
      if (sessionDir) appendCompactSummary(sessionDir, summary);
    }
  } catch { /* cannot block */ }
  console.log('{}');
}

if (require.main === module) main();
else module.exports = { appendCompactSummary };
