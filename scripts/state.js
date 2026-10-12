#!/usr/bin/env node
'use strict';
/**
 * Prints the constellation workflow state of one Claude Code session as one
 * JSON object: its session dir, phase, approval gate, plans, docs and git
 * branch. The console pane reads it; any script may.
 *
 *   node scripts/state.js --session-id <id> [--cwd <dir>] [--cache-stdin]
 *
 * Phase and session resolution come from hooks/lib/session.js, so this script
 * never disagrees with the hooks. Validator scores are the expensive part:
 * with --cache-stdin, stdin holds {"scores": {"<plan path>": {mtimeMs, score,
 * passed}}} and a plan whose mtime matches its cache entry is not re-scored.
 *
 * Exit codes: 0 with the JSON on stdout (also when the session has no dir
 * yet), 1 on an internal error, 2 on a usage error; both errors print one
 * line on stderr.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  sessionRoot, resolveSessionDir, inferPhase, parseFrontmatter, readSafe, phaseOfStatus, phaseRank,
} = require('../hooks/lib/session');

const VALIDATOR = process.env.CONSTELLATION_VALIDATOR
  || path.join(__dirname, '..', 'skills', 'plan-validator', 'scripts', 'validate_plan.py');
const CHILD_TIMEOUT_MS = 5000;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function usage(message) {
  process.stderr.write(`state: ${message}\nusage: node scripts/state.js --session-id <id> [--cwd <dir>] [--cache-stdin]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { sessionId: null, cwd: process.cwd(), cacheStdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session-id') args.sessionId = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--cache-stdin') args.cacheStdin = true;
    else usage(`unknown argument ${a}`);
  }
  if (!args.sessionId) usage('--session-id is required');
  if (!args.cwd) usage('--cwd needs a value');
  // $.session.id() names the transcript file; the hooks key on the bare id.
  args.sessionId = args.sessionId.replace(/\.jsonl$/, '');
  return args;
}

/** The score cache from stdin, or {} when it is empty or not JSON. */
function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(0, 'utf8'));
    return parsed && typeof parsed.scores === 'object' && parsed.scores ? parsed.scores : {};
  } catch {
    return {};
  }
}

/** The text of `## <heading>` up to the next `## `, or ''. */
function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const body = text.slice(start + heading.length + 5);
  const end = body.indexOf('\n## ');
  return end === -1 ? body : body.slice(0, end);
}

function planTitle(text) {
  const m = /^# (.+)$/m.exec(text);
  return m ? m[1].replace(/^PLAN:\s*/, '').trim() : null;
}

function briefSize(brief) {
  const m = /^\*\*Size:\*\*\s*(.+)$/m.exec(brief);
  return m ? m[1].trim() : null;
}

/** The numbered `**Needs your call:**` lines: question text and its bolded default. */
function needsCall(brief) {
  const start = brief.indexOf('**Needs your call:**');
  if (start === -1) return [];
  const calls = [];
  for (const line of brief.slice(start).split('\n').slice(1)) {
    if (line.startsWith('**')) break;
    const m = /^(\d+)\.\s+(.*?)\s*→\s*(?:you:\s*)?\*\*(.+?)\*\*/.exec(line);
    if (m) calls.push({ n: Number(m[1]), text: m[2].trim(), default: m[3].trim() });
  }
  return calls;
}

/**
 * The `delivery:` block list of the frontmatter. parseFrontmatter skips
 * indented lines on purpose, so the list is read here: each `- key: value`
 * starts an item and each deeper `key: value` adds to it.
 */
function delivery(text) {
  const fm = FRONTMATTER_RE.exec(text);
  if (!fm) return [];
  const items = [];
  let inside = false;
  for (const line of fm[1].split('\n')) {
    if (!inside) { inside = /^delivery:\s*$/.test(line); continue; }
    if (!/^\s/.test(line)) break;
    const m = /^\s+(-\s+)?([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1]) items.push({});
    const item = items[items.length - 1];
    if (!item) continue;
    item[m[2]] = m[2] === 'prs' ? Number(m[3]) : m[3].trim();
  }
  return items;
}

/** Runs the validator: exit 0 (PASS) and 1 (NEEDS WORK) both print the JSON report. */
function score(planPath) {
  const res = spawnSync('python3', [VALIDATOR, planPath, '--json'], { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  if (res.status !== 0 && res.status !== 1) return { score: null, passed: null };
  try {
    const report = JSON.parse(res.stdout);
    return typeof report.score === 'number' ? { score: report.score, passed: report.passed === true } : { score: null, passed: null };
  } catch {
    return { score: null, passed: null };
  }
}

function readPlan(file, cache) {
  const text = readSafe(file) || '';
  const mtimeMs = fs.statSync(file).mtimeMs;
  const status = parseFrontmatter(text).status || null;
  const cached = cache[file];
  const scored = cached && cached.mtimeMs === mtimeMs && typeof cached.score === 'number'
    ? { score: cached.score, passed: cached.passed === true }
    : score(file);
  const brief = section(text, 'Brief');
  return {
    path: file,
    mtimeMs,
    title: planTitle(text),
    status,
    phase: phaseOfStatus(status),
    score: scored.score,
    passed: scored.passed,
    size: briefSize(brief),
    needsCall: needsCall(brief),
    delivery: delivery(text),
  };
}

function listDir(dir) {
  try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

function plans(dir, cache) {
  return listDir(dir)
    .filter(f => /^PLAN.*\.md$/.test(f) && f !== 'PLAN-INDEX.md')
    .map(f => readPlan(path.join(dir, f), cache))
    .sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.path.localeCompare(b.path));
}

function docs(dir) {
  return listDir(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

function git(cwd) {
  const run = args => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  const top = run(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return null;
  const branch = run(['branch', '--show-current']);
  let toplevel = top.stdout.trim();
  try { toplevel = fs.realpathSync(toplevel); } catch { /* keep git's spelling */ }
  return { toplevel, branch: branch.status === 0 ? branch.stdout.trim() || null : null };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cache = args.cacheStdin ? readCache() : {};
  const root = sessionRoot();
  const sessionDir = resolveSessionDir(root, { sessionId: args.sessionId });
  const planList = sessionDir ? plans(sessionDir, cache) : [];
  const state = {
    root,
    sessionDir,
    phase: sessionDir ? inferPhase(sessionDir) : null,
    gate: planList.some(p => p.status === 'awaiting-approval') ? 'awaiting-approval' : null,
    plans: planList,
    docs: sessionDir ? docs(sessionDir) : [],
    git: git(args.cwd),
  };
  process.stdout.write(`${JSON.stringify(state)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`state: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
}
