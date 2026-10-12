'use strict';
/**
 * Tests for scripts/state.js, the JSON view of one session's workflow state
 * that the console pane draws. The script runs for real as a child process
 * against a temp SESSION_ROOT. A fake validator (CONSTELLATION_VALIDATOR)
 * stands in for validate_plan.py so scores are fixed and every run is logged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { makeTmp, hookEnv } = require('./helpers');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'state.js');
const SESSION = '7d2c9e14-5b3a-4f61-8e0d-2a9b4c6d8e1f';

/** A fake validator: logs each plan it is run on, prints `report`, exits `code`. */
function fakeValidator(report, code) {
  const dir = makeTmp('constellation-validator-');
  const log = path.join(dir, 'runs.log');
  const script = path.join(dir, 'validate.py');
  fs.writeFileSync(script, [
    'import sys',
    `open(${JSON.stringify(log)}, "a").write(sys.argv[1] + "\\n")`,
    `print(${JSON.stringify(typeof report === 'string' ? report : JSON.stringify(report))})`,
    `sys.exit(${code})`,
  ].join('\n'));
  const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return { script, runs };
}

/** An env whose SESSION_ROOT holds a session dir bound to SESSION, with `files` in it. */
function session(files, validator = fakeValidator({ score: 90, passed: true }, 0)) {
  const env = hookEnv({ CONSTELLATION_VALIDATOR: validator.script });
  const dir = path.join(env.SESSION_ROOT, '2026-10-12_Console');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(env.SESSION_ROOT, '.sessions'), { recursive: true });
  fs.writeFileSync(path.join(env.SESSION_ROOT, '.sessions', SESSION), `${dir}\n`);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return { env, dir, validator };
}

function run(env, { args = [], stdin = '' } = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, '--session-id', SESSION, ...args], { env, input: stdin, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* left null */ }
  return { status: res.status, stderr: res.stderr, json };
}

const plan = (status, body = '') => `---\nschema: plan/v3\nstatus: ${status}\ntags: []\n---\n\n# PLAN: Console pane\n${body}`;

const BRIEF = [
  '',
  '## Brief',
  '**Needs your call:**',
  '1. Auto-open on start? → **no** (quiet by default; if wrong: one flag)',
  '2. Run → you: **inline** (two tasks; or subagent-driven)',
  '**Ships as:** 1 PR, feat/console → origin/main',
  '**Size:** ~420 lines · 6 files · 9 tasks · 1 PR',
  '**Flags:** none',
  '',
  '## Global Constraints',
  '',
].join('\n');

test('no session dir: exits 0 with nulls and empty lists', () => {
  const env = hookEnv();
  const { status, json } = run(env);
  assert.equal(status, 0);
  assert.equal(json.sessionDir, null);
  assert.equal(json.phase, null);
  assert.equal(json.gate, null);
  assert.deepEqual(json.plans, []);
  assert.deepEqual(json.docs, []);
  assert.equal(json.root, env.SESSION_ROOT);
});

test('a .jsonl suffix on the id is ignored', () => {
  const { env, dir } = session({ 'SESSION.md': '# s\n' });
  const res = spawnSync(process.execPath, [SCRIPT, '--session-id', `${SESSION}.jsonl`], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(res.stdout).sessionDir, dir);
});

test('SESSION.md only: discover', () => {
  const { env, dir } = session({ 'SESSION.md': '# s\n' });
  const { json } = run(env);
  assert.equal(json.sessionDir, dir);
  assert.equal(json.phase, 'discover');
  assert.deepEqual(json.docs.map(d => d.name), ['SESSION.md']);
});

test('DISCOVERY.md with no plan: plan, no gate', () => {
  const { env } = session({ 'SESSION.md': '# s\n', 'DISCOVERY.md': '# d\n' });
  const { json } = run(env);
  assert.equal(json.phase, 'plan');
  assert.equal(json.gate, null);
});

test('awaiting-approval plan: plan phase with the gate set', () => {
  const { env } = session({ 'PLAN.md': plan('awaiting-approval', BRIEF) });
  const { json } = run(env);
  assert.equal(json.phase, 'plan');
  assert.equal(json.gate, 'awaiting-approval');
});

test('approved plan: implement; complete plan: complete', () => {
  assert.equal(run(session({ 'PLAN.md': plan('approved') }).env).json.phase, 'implement');
  assert.equal(run(session({ 'PLAN.md': plan('complete') }).env).json.phase, 'complete');
});

test('two plans: least advanced first, and it sets the phase', () => {
  const { env, dir } = session({ 'PLAN-1-cli.md': plan('approved'), 'PLAN-2-mod.md': plan('draft'), 'PLAN-INDEX.md': '# index\n' });
  const { json } = run(env);
  assert.equal(json.phase, 'plan');
  assert.deepEqual(json.plans.map(p => path.basename(p.path)), ['PLAN-2-mod.md', 'PLAN-1-cli.md']);
  assert.equal(json.plans[0].path, path.join(dir, 'PLAN-2-mod.md'));
});

test('Brief fields: title, size and needsCall with ** and the (…) tail stripped', () => {
  const { env } = session({ 'PLAN.md': plan('draft', BRIEF) });
  const [p] = run(env).json.plans;
  assert.equal(p.title, 'Console pane');
  assert.equal(p.status, 'draft');
  assert.equal(p.size, '~420 lines · 6 files · 9 tasks · 1 PR');
  assert.deepEqual(p.needsCall, [
    { n: 1, text: 'Auto-open on start?', default: 'no' },
    { n: 2, text: 'Run', default: 'inline' },
  ]);
});

test('malformed plan: fields are null or empty, exit 0', () => {
  const { env } = session({ 'PLAN.md': 'no frontmatter, no headings\n' });
  const { status, json } = run(env);
  assert.equal(status, 0);
  const [p] = json.plans;
  assert.equal(p.title, null);
  assert.equal(p.status, null);
  assert.equal(p.size, null);
  assert.deepEqual(p.needsCall, []);
  assert.deepEqual(p.delivery, []);
});

test('delivery block list: every repo item, prs as a number', () => {
  const fm = [
    '---', 'schema: plan/v3', 'status: draft', 'delivery:',
    '  - repo: /src/constellation', '    mode: stack', '    branch: feat/state-cli', '    base: main', '    remote: origin', '    prs: 2',
    '  - repo: /src/other', '    mode: local-only', '    branch: n/a', '    base: main', '    remote: none', '    prs: 0',
    'tags: []', '---', '', '# PLAN: Two repos', '',
  ].join('\n');
  const { env } = session({ 'PLAN.md': fm });
  assert.deepEqual(run(env).json.plans[0].delivery, [
    { repo: '/src/constellation', mode: 'stack', branch: 'feat/state-cli', base: 'main', remote: 'origin', prs: 2 },
    { repo: '/src/other', mode: 'local-only', branch: 'n/a', base: 'main', remote: 'none', prs: 0 },
  ]);
});

test('NEEDS WORK: validator exit 1 still yields the score with passed false', () => {
  const { env } = session({ 'PLAN.md': plan('draft') }, fakeValidator({ score: 55, passed: false }, 1));
  const [p] = run(env).json.plans;
  assert.equal(p.score, 55);
  assert.equal(p.passed, false);
});

test('validator crash (exit 2) or junk output: score null', () => {
  assert.equal(run(session({ 'PLAN.md': plan('draft') }, fakeValidator({ score: 80, passed: true }, 2)).env).json.plans[0].score, null);
  assert.equal(run(session({ 'PLAN.md': plan('draft') }, fakeValidator('not json', 0)).env).json.plans[0].score, null);
});

test('score cache: a matching mtime skips the validator, a stale one re-scores', () => {
  const { env, dir, validator } = session({ 'PLAN.md': plan('draft') });
  const file = path.join(dir, 'PLAN.md');
  const mtimeMs = fs.statSync(file).mtimeMs;

  const fresh = JSON.stringify({ scores: { [file]: { mtimeMs, score: 77, passed: true } } });
  const hit = run(env, { args: ['--cache-stdin'], stdin: fresh }).json.plans[0];
  assert.equal(hit.score, 77);
  assert.equal(validator.runs().length, 0);

  const stale = JSON.stringify({ scores: { [file]: { mtimeMs: mtimeMs - 1000, score: 77, passed: true } } });
  const miss = run(env, { args: ['--cache-stdin'], stdin: stale }).json.plans[0];
  assert.equal(miss.score, 90);
  assert.deepEqual(validator.runs(), [file]);
});

test('docs: every top-level .md, newest first', () => {
  const { env, dir } = session({ 'SESSION.md': '# s\n', 'DISCOVERY.md': '# d\n', 'notes.txt': 'x' });
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'SESSION.md'), old, old);
  assert.deepEqual(run(env).json.docs.map(d => d.name), ['DISCOVERY.md', 'SESSION.md']);
});

test('git: toplevel realpath and branch inside a repo, null outside', () => {
  const env = hookEnv();
  const repo = makeTmp('constellation-repo-');
  spawnSync('git', ['init', '-q', '-b', 'feat/console', repo]);
  assert.deepEqual(run(env, { args: ['--cwd', repo] }).json.git, { toplevel: repo, branch: 'feat/console' });
  assert.equal(run(env, { args: ['--cwd', makeTmp('constellation-norepo-')] }).json.git, null);
});

test('usage: no --session-id exits 2 with one stderr line', () => {
  const res = spawnSync(process.execPath, [SCRIPT], { env: hookEnv(), encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /^state: --session-id is required\n/);
});
