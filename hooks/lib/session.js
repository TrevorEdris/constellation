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
 *
 * A session with no dir yet can still be matched to one: a first prompt that
 * names a PLAN inside the root (sessionDirFromPrompt), or a dir the agent made
 * by hand this session (findAdoptableDir, then stampSessionId).
 *
 * The agent is told where its journal is once per session: <root>/.sessions/<id>.announced
 * holds the dir it was told about, or `pending` (readMarker, writeMarker).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HEAD_BYTES = 4096;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

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
  const m = FRONTMATTER_RE.exec(text || '');
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

/** <root>/.sessions/<id>.announced. A valid id has no dot, so this never names a pointer. */
function markerPath(root, id) {
  return isValidSessionId(id) ? path.join(root, '.sessions', `${id}.announced`) : null;
}

/** What the agent was last told about `id`'s journal: a dir, or `pending`. null when nothing, or for an invalid id. */
function readMarker(root, id) {
  const file = markerPath(root, id);
  return file ? readSafe(file) : null;
}

/** Records what the agent was just told: the journal's dir, or `pending`. Returns false, writing nothing, for an invalid id. */
function writeMarker(root, id, value) {
  const file = markerPath(root, id);
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return true;
  } catch { return false; }
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

// A transcript entry's `entrypoint` names the client that wrote it. sdk-cli is
// what `claude -p` reports; sdk-py and sdk-ts are the Agent SDK clients.
const HEADLESS_ENTRYPOINTS = new Set(['sdk-cli', 'sdk-py', 'sdk-ts']);

/** The `entrypoint` of the first transcript entry that carries one, or null. */
function transcriptEntrypoint(transcriptPath) {
  for (const line of readLines(transcriptPath)) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj && typeof obj.entrypoint === 'string' && obj.entrypoint) return obj.entrypoint;
  }
  return null;
}

/**
 * True for a run no person is watching (`claude -p`, the Agent SDK), which
 * should not litter the sessions root with a journal. CLAUDE_CODE_ENTRYPOINT
 * decides when set; otherwise the transcript's first entrypoint does.
 * CONSTELLATION_SCAFFOLD=always turns the skip off.
 */
function isHeadless(env, transcriptPath) {
  if (env.CONSTELLATION_SCAFFOLD === 'always') return false;
  const entrypoint = env.CLAUDE_CODE_ENTRYPOINT || transcriptEntrypoint(transcriptPath);
  return HEADLESS_ENTRYPOINTS.has(entrypoint);
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

// --- What the agent is told ---------------------------------------------------

/** The line that tells the agent where its journal is. */
function journalLine(dir) {
  return `Session journal: ${path.join(dir, 'SESSION.md')}. Journal there; do not create another session dir. Keep '## Decisions' and '## Status' current.`;
}

/** The line for a session with no journal yet: one is coming, or the agent's own dir will be adopted. */
function pendingLine(root) {
  return `Session journal: not created yet. Constellation creates it under ${root} when this turn ends, or adopts a session dir you create there this turn.`;
}

// --- Matching a session to a dir that already exists -------------------------

/** When a path was created: its birthtime, or its ctime where the filesystem has none. */
const createdMs = st => st.birthtimeMs || st.ctimeMs;

/**
 * When the session began, in ms: the `timestamp` of the first transcript entry
 * that carries a parseable one (the leading bridge-session line has none), else
 * the transcript file's own creation time. null when neither can be found.
 */
function sessionStartMs(transcriptPath) {
  for (const line of readLines(transcriptPath)) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const ms = obj && typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
    if (!Number.isNaN(ms)) return ms;
  }
  try { return createdMs(fs.statSync(transcriptPath)); } catch { return null; }
}

/** True when `dir` has no SESSION.md, or one whose session_id is missing, empty or not a UUID. */
function isUnstamped(dir) {
  const file = path.join(dir, 'SESSION.md');
  const text = readSafe(file);
  if (text === null) return !fs.existsSync(file); // unreadable is not the same as absent
  return !UUID_RE.test(parseFrontmatter(text).session_id || '');
}

/** The JSON text of every assistant tool_use input in the transcript, whatever the tool. */
function toolInputText(transcriptPath) {
  const parts = [];
  for (const line of readLines(transcriptPath)) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const content = obj && obj.type === 'assistant' && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use') parts.push(JSON.stringify(block.input));
    }
  }
  return parts.join('\n');
}

/** True when `name` occurs in `text` and is not just the start of a longer name (`<d>` in `<d>-2`). */
function mentionsName(text, name) {
  const needle = JSON.stringify(name).slice(1, -1); // `text` is JSON, so escape the same way
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (!/[A-Za-z0-9_-]/.test(text.charAt(i + needle.length))) return true;
  }
  return false;
}

/**
 * The dir this session made by hand under `root`, or null. A dir qualifies when
 * it is a direct, non-dot child of the root, was created no earlier than a
 * second before the session began, has no SESSION.md or one not yet stamped
 * with a session UUID, and is named by a tool call in this session's own
 * transcript. The mention is what keeps a parallel session's fresh dir out;
 * with several candidates the newest wins.
 */
function findAdoptableDir(root, transcriptPath) {
  const start = sessionStartMs(transcriptPath);
  if (start === null) return null;
  let names;
  try { names = fs.readdirSync(root).sort(); } catch { return null; }

  const fresh = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const dir = path.join(root, name);
    let st;
    try { st = fs.lstatSync(dir); } catch { continue; }
    if (!st.isDirectory() || createdMs(st) < start - 1000 || !isUnstamped(dir)) continue;
    fresh.push({ dir, name, created: createdMs(st) });
  }
  if (!fresh.length) return null;

  const used = toolInputText(transcriptPath);
  let best = null;
  for (const c of fresh) {
    if (mentionsName(used, c.name) && (!best || c.created > best.created)) best = c;
  }
  return best && best.dir;
}

/**
 * Gives `dir`'s SESSION.md `sessionId` as its session_id: replaces the top-level
 * line, inserts one at the end of the frontmatter, or prepends a frontmatter
 * block. Every other byte stays as it was. Returns true when it wrote; false for
 * an unsafe id, a missing or unwritable SESSION.md. A dir without one is left
 * without one (the pointer alone binds it). Callers decide what may be stamped.
 */
function stampSessionId(dir, sessionId) {
  if (!isValidSessionId(sessionId)) return false;
  const file = path.join(dir, 'SESSION.md');
  let text;
  // latin1 maps bytes to chars one to one, so whatever the file holds comes back unchanged.
  try { text = fs.readFileSync(file, 'latin1'); } catch { return false; }

  const line = `session_id: ${sessionId}`;
  const fm = FRONTMATTER_RE.exec(text);
  let stamped;
  if (fm) {
    const lines = fm[1].split('\n');
    const at = lines.findIndex(l => /^session_id\s*:/.test(l));
    if (at === -1) lines.push(line); else lines[at] = line;
    const bodyAt = '---\n'.length;
    stamped = text.slice(0, bodyAt) + lines.join('\n') + text.slice(bodyAt + fm[1].length);
  } else {
    stamped = `---\n${line}\n---\n\n${text}`;
  }
  try { fs.writeFileSync(file, stamped, 'latin1'); return true; } catch { return false; }
}

// A path the first prompt can name: absolute or ~/, ending in a PLAN*.md file.
const PLAN_PATH_RE = /(?:~\/|\/)[^\s'"<>()\[\]`]*\/PLAN[^\s\/'"<>()\[\]`]*\.md/g;
// Characters no PLAN_PATH_RE match can contain, so splitting on them keeps every match whole.
const PATH_BREAK_RE = /[\s'"<>()\[\]`]+/;
// PLAN_PATH_RE backtracks quadratically inside one long token with many slashes
// (28 s at 100 KB), and no real path is longer than this (macOS PATH_MAX).
const MAX_PATH_CHARS = 1024;

/**
 * The session dir under `root` that a prompt's PLAN path lives in, or null. The
 * first PLAN*.md the prompt names that exists as a file inside the root, once
 * symlinks and `..` are resolved, decides: its first path segment below the
 * root is the dir, unless that segment is dot-prefixed or is the file itself.
 * Nothing is modified.
 */
function sessionDirFromPrompt(root, prompt) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return null; }
  for (const token of String(prompt || '').split(PATH_BREAK_RE)) {
    if (token.length > MAX_PATH_CHARS) continue;
    for (const m of token.matchAll(PLAN_PATH_RE)) {
      const named = m[0].startsWith('~/') ? path.join(os.homedir(), m[0].slice(2)) : m[0];
      let file;
      try {
        file = fs.realpathSync(named);
        if (!fs.statSync(file).isFile()) continue;
      } catch { continue; }
      const [first, ...rest] = path.relative(realRoot, file).split(path.sep);
      if (rest.length && !first.startsWith('.')) return path.join(root, first);
    }
  }
  return null;
}

module.exports = {
  sessionRoot, today, parseFrontmatter, readSafe, readHead,
  isValidSessionId, pointerPath, readPointer, bindSession,
  readMarker, writeMarker, journalLine, pendingLine,
  resolveSessionDir, inferPhase, sessionIdFromStdin,
  isHeadless, latestCustomTitle, firstRealPromptText, detectTicket, slugifyTitle, extractText,
  sessionStartMs, findAdoptableDir, stampSessionId, sessionDirFromPrompt,
};
