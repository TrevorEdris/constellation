'use strict';
/**
 * Shared session-resolution helpers for constellation session-doc hooks.
 *
 * A session is identified by Claude Code's session_id. Resolution order:
 *   1. <root>/.sessions/<id>, a pointer file holding the session dir's realpath
 *      (the only key a dir bound by PLAN path has)
 *   2. a scan of the root's direct child dirs for a SESSION.md whose top-level
 *      session_id matches; if several match, the newest SESSION.md wins
 *   3. null
 * There is no date filter and no mtime fallback, and the legacy <root>/.active
 * file is never read, written or deleted, so a session never falls back to
 * another session's dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HEAD_BYTES = 4096;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** SESSION_ROOT when set and non-empty, else ~/src/.ai/sessions. Read per call. */
function sessionRoot() {
  return process.env.SESSION_ROOT || path.join(os.homedir(), 'src', '.ai', 'sessions');
}

/** Local calendar date (YYYY-MM-DD), the same one `date +%F` gives. */
function today(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A frontmatter value without its quotes or its trailing `# comment`. */
function parseScalar(raw) {
  const v = raw.trim();
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1);
    if (end > 0 && /^\s*(#.*)?$/.test(v.slice(end + 1))) return v.slice(1, end);
  }
  const comment = /(^|\s)#/.exec(v);
  return (comment ? v.slice(0, comment.index) : v).trim();
}

/**
 * The top-level `key: value` pairs of a leading `---` block. Indented lines
 * (list items and nested keys such as delivery[].status) never count.
 */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text || '');
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    if (/^[\s#-]/.test(line)) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    fm[line.slice(0, i).trim()] = parseScalar(line.slice(i + 1));
  }
  return fm;
}

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

/** The first `bytes` bytes of a file as text, or null if it cannot be read. */
function readHead(file, bytes = HEAD_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, bytes, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* nothing to release */ } }
  }
}

/** Ids become file names, so only a conservative charset is accepted. */
function isValidSessionId(id) { return typeof id === 'string' && SESSION_ID_RE.test(id); }

/** <root>/.sessions/<id>, or null for an invalid id. */
function pointerPath(root, id) {
  return isValidSessionId(id) ? path.join(root, '.sessions', id) : null;
}

/** The session dir the pointer for `id` names, or null unless it is an absolute path to an existing dir. */
function readPointer(root, id) {
  const file = pointerPath(root, id);
  if (!file) return null;
  const raw = readHead(file);
  if (raw === null) return null;
  const target = raw.trim();
  if (!path.isAbsolute(target)) return null;
  try { return fs.statSync(target).isDirectory() ? target : null; } catch { return null; }
}

/**
 * Points `id` at `dir` by writing its realpath plus a newline to a temp file
 * inside .sessions/ and renaming it over the pointer. Returns false, touching
 * nothing, for an invalid id or a dir that does not exist.
 */
function bindSession(root, id, dir) {
  if (!isValidSessionId(id)) return false;
  let real;
  try {
    real = fs.realpathSync(dir);
    if (!fs.statSync(real).isDirectory()) return false;
  } catch { return false; }

  const pointers = path.join(root, '.sessions');
  // A leading dot keeps the temp name out of the valid-id namespace.
  const tmp = path.join(pointers, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(pointers, { recursive: true });
    fs.writeFileSync(tmp, `${real}\n`, { flag: 'wx' });
    fs.renameSync(tmp, pointerPath(root, id));
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    return false;
  }
}

/** The root's direct, non-dot child dir whose SESSION.md carries `sessionId`; newest SESSION.md wins. */
function scanForSession(root, sessionId) {
  let names;
  try { names = fs.readdirSync(root).sort(); } catch { return null; }
  let best = null;
  let bestMtime = -Infinity;
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const file = path.join(root, name, 'SESSION.md');
    const head = readHead(file);
    // The substring test is only a cheap filter; the parse decides.
    if (head === null || !head.includes(sessionId)) continue;
    if (parseFrontmatter(head).session_id !== sessionId) continue;
    let mtime;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (mtime > bestMtime) { best = path.join(root, name); bestMtime = mtime; }
  }
  return best;
}

function resolveSessionDir(root = sessionRoot(), { sessionId } = {}) {
  if (!isValidSessionId(sessionId)) return null;
  return readPointer(root, sessionId) || scanForSession(root, sessionId);
}

const PHASE_BY_STATUS = new Map([
  ...['draft', 'awaiting-approval', 'planning', 'plan'].map(s => [s, 'plan']),
  ...['approved', 'in-progress', 'implementing', 'implement'].map(s => [s, 'implement']),
  ...['complete', 'completed', 'done'].map(s => [s, 'complete']),
]);
const PHASE_ORDER = ['plan', 'implement', 'complete'];

function inferPhase(sessionDir) {
  // PLAN frontmatter status decides; with several plans the least advanced wins.
  // PLAN-INDEX.md only lists plans, so it never counts.
  let planFiles = [];
  try {
    planFiles = fs.readdirSync(sessionDir).filter(f => /^PLAN.*\.md$/.test(f) && f !== 'PLAN-INDEX.md');
  } catch { /* none */ }
  if (planFiles.length) {
    const rank = f => {
      const status = (parseFrontmatter(readSafe(path.join(sessionDir, f))).status || '').toLowerCase();
      return PHASE_ORDER.indexOf(PHASE_BY_STATUS.get(status) || 'implement'); // unknown status: past planning
    };
    return PHASE_ORDER[Math.min(...planFiles.map(rank))];
  }
  if (fs.existsSync(path.join(sessionDir, 'DISCOVERY.md'))) return 'plan';
  if (fs.existsSync(path.join(sessionDir, 'SESSION.md'))) return 'discover';
  return null;
}

function sessionIdFromStdin(input) {
  try { return JSON.parse(input || '{}').session_id; } catch { return undefined; }
}

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  } catch { return []; }
}

function latestCustomTitle(transcriptPath) {
  let title = null;
  for (const line of readLines(transcriptPath)) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'custom-title' && obj.customTitle) title = obj.customTitle;
  }
  return title;
}

const NOISE_RE = /^(<local-command|<command-name|<command-message|<command-args|Caveat:|<system-reminder|\[Request interrupted)/;
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some(b => b && b.type === 'tool_result')) return null;
    return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n') || null;
  }
  return null;
}

function firstRealPromptText(transcriptPath) {
  for (const line of readLines(transcriptPath)) {
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'user' || obj.isSidechain) continue;
    const text = extractText(obj.message && obj.message.content);
    if (text && !NOISE_RE.test(text.trimStart())) return text.trim();
  }
  return null;
}

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;
function detectTicket(text) { const m = TICKET_RE.exec(text || ''); return m ? m[1] : null; }
function slugifyTitle(title, ticket) {
  let text = ticket ? title.replace(ticket, ' ') : title;
  text = text.replace(/[^\w\s-]/g, ' ');
  const words = text.split(/[\s_-]+/).filter(Boolean);
  return words.join('-').slice(0, 60).replace(/-+$/, '') || 'session';
}

module.exports = {
  sessionRoot, today, parseFrontmatter, readSafe, readHead,
  isValidSessionId, pointerPath, readPointer, bindSession,
  resolveSessionDir, inferPhase, sessionIdFromStdin,
  latestCustomTitle, firstRealPromptText, detectTicket, slugifyTitle, extractText,
};
