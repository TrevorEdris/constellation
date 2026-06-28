'use strict';
/**
 * Shared session-resolution helpers for constellation session-doc hooks.
 *
 * Fixes the fotw wrong-session bug: findTodaySessionDir picked the last
 * dir alphabetically among same-day dirs, so with many same-day sessions the
 * snapshot/summary could land in the wrong one. Resolution order here:
 *   1. .ai/sessions/.active pointer file (explicit active session)
 *   2. SESSION.md frontmatter session_id matching the hook's session_id
 *   3. most-recently-MODIFIED today-dated dir (mtime, not alphabetical)
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SESSION_ROOT = path.join(process.env.HOME, 'src', '.ai', 'sessions');

function today() { return new Date().toISOString().slice(0, 10); }

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text || '');
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    let v = line.slice(i + 1).trim();
    if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
    fm[line.slice(0, i).trim()] = v;
  }
  return fm;
}

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function todayDirs(sessionRoot) {
  try {
    return fs.readdirSync(sessionRoot)
      .filter(e => e.startsWith(today() + '_'))
      .map(e => path.join(sessionRoot, e))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

function resolveSessionDir(sessionRoot = DEFAULT_SESSION_ROOT, opts = {}) {
  const sessionId = opts.sessionId;

  // 1. explicit .active pointer
  const activePtr = readSafe(path.join(sessionRoot, '.active'));
  if (activePtr) {
    const name = activePtr.trim();
    const abs = path.isAbsolute(name) ? name : path.join(sessionRoot, name);
    try { if (fs.statSync(abs).isDirectory()) return abs; } catch { /* stale pointer */ }
  }

  const dirs = todayDirs(sessionRoot);
  if (dirs.length === 0) return null;

  // 2. session_id match
  if (sessionId) {
    for (const d of dirs) {
      const fm = parseFrontmatter(readSafe(path.join(d, 'SESSION.md')));
      if (fm.session_id && fm.session_id === sessionId) return d;
    }
  }

  // 3. most-recently-modified
  return dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function inferPhase(sessionDir) {
  // Prefer PLAN frontmatter status (handles multi-PLAN via glob); fall back to
  // file presence. A plan awaiting approval is still in Plan phase.
  let planFiles = [];
  try { planFiles = fs.readdirSync(sessionDir).filter(f => /^PLAN.*\.md$/.test(f)); } catch { /* none */ }
  if (planFiles.length) {
    const fm = parseFrontmatter(readSafe(path.join(sessionDir, planFiles.sort()[0])));
    const s = (fm.status || '').toLowerCase();
    if (s.includes('complete')) return 'complete';
    if (s.includes('await') || s === 'draft' || s === 'plan') return 'plan';
    if (s.includes('approve') || s.includes('progress') || s === 'implement') return 'implement';
    return 'implement'; // PLAN exists, status unknown
  }
  if (fs.existsSync(path.join(sessionDir, 'DISCOVERY.md'))) return 'plan';
  if (fs.existsSync(path.join(sessionDir, 'SESSION.md'))) return 'discover';
  return null;
}

function sessionIdFromStdin(input) {
  try { return JSON.parse(input || '{}').session_id; } catch { return undefined; }
}

module.exports = {
  DEFAULT_SESSION_ROOT, today, parseFrontmatter, readSafe, todayDirs,
  resolveSessionDir, inferPhase, sessionIdFromStdin,
};
