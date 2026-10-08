#!/usr/bin/env node
/**
 * Context Snapshot - PreCompact Hook (constellation)
 * Before compaction, writes CONTEXT_SNAPSHOT.md to the ACTIVE session dir
 * (resolved by the session_id pointer or SESSION.md scan; the legacy .active file is never read).
 *
 * @hook {"event":"PreCompact","matcher":"","description":"Saves context snapshot to the active session before compaction"}
 */
const fs = require('fs');
const path = require('path');
const { sessionRoot, resolveSessionDir, inferPhase, readSafe, sessionIdFromStdin } = require('./lib/session');

const SESSION_FILES = ['SESSION.md', 'DISCOVERY.md'];

function extractHeadings(content) {
  return content.split('\n').map(l => (l.match(/^##\s+(.+)/) || [])[1]).filter(Boolean).map(s => s.trim());
}

function createSnapshot(root, sessionId) {
  const sessionDir = resolveSessionDir(root, { sessionId });
  if (!sessionDir) return null;
  const phase = inferPhase(sessionDir);
  if (!phase) return null;

  const ts = new Date().toISOString();
  const out = ['# Context Snapshot', `> Generated: ${ts}`, `> Phase: **${phase}**`, `> Session: \`${path.basename(sessionDir)}\``, ''];

  // include any PLAN*.md (multi-PLAN aware) plus SESSION/DISCOVERY
  let planFiles = [];
  try { planFiles = fs.readdirSync(sessionDir).filter(f => /^PLAN.*\.md$/.test(f)).sort(); } catch { /* none */ }
  for (const filename of [...SESSION_FILES, ...planFiles]) {
    const content = readSafe(path.join(sessionDir, filename));
    if (!content) continue;
    const headings = extractHeadings(content);
    out.push(`## ${filename}`);
    if (headings.length) out.push(`Sections: ${headings.join(', ')}`);
    out.push('', '```', content.split('\n').slice(0, 30).join('\n'), '```', '');
  }
  fs.writeFileSync(path.join(sessionDir, 'CONTEXT_SNAPSHOT.md'), out.join('\n'));
  return { phase, sessionDir };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try { createSnapshot(sessionRoot(), sessionIdFromStdin(input)); } catch { /* PreCompact cannot block */ }
  console.log('{}');
}

if (require.main === module) main();
else module.exports = { createSnapshot, extractHeadings };
