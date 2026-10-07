'use strict';
/**
 * Tests for hooks/lib/session.js (the session resolver) and the one consumer
 * whose behavior changes with it, context-snapshot.js, run as a real hook.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { HOOKS_DIR, makeTmp, hookEnv, runHook } = require('./helpers');
const lib = require('../lib/session');
const {
  sessionRoot, today, parseFrontmatter, inferPhase, isValidSessionId,
  pointerPath, readPointer, bindSession, resolveSessionDir,
} = lib;

// The status line of skills/writing-plans/references/PLAN-TEMPLATE.md.
const TEMPLATE_STATUS = 'status: draft            # draft | awaiting-approval | approved | in-progress | complete';

function stamped(id) {
  return `---\nschema: v1\ndate: 2026-10-06\nslug: s\nsession_id: ${id}\n---\n\n# Session\n`;
}

/** A session dir under root; SESSION.md carries `id` when given. Returns the dir. */
function makeSessionDir(root, name, { id, mtime } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SESSION.md');
  fs.writeFileSync(file, id ? stamped(id) : '# Session without frontmatter\n');
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return dir;
}

/** A dir holding the given {filename: content} files. */
function makeDir(files) {
  const dir = makeTmp();
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const planWith = status => `---\nschema: plan/v2\nstatus: ${status}\n---\n\n# PLAN\n`;

test('today uses local date at 21:00 New York', () => {
  const probe = (tz, iso) => spawnSync(process.execPath, [
    '-e', `process.stdout.write(require(${JSON.stringify(path.join(HOOKS_DIR, 'lib', 'session.js'))}).today(new Date(${JSON.stringify(iso)})))`,
  ], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });

  // 01:00 UTC on the 7th is 21:00 on the 6th in New York; toISOString says the 7th.
  assert.equal(probe('America/New_York', '2026-10-07T01:00:00Z').stdout, '2026-10-06');
  // And the other direction: 23:00 UTC on the 6th is already the 7th at UTC+14.
  assert.equal(probe('Pacific/Kiritimati', '2026-10-06T23:00:00Z').stdout, '2026-10-07');
});

test('sessionRoot honors SESSION_ROOT per call; empty falls back', () => {
  const home = makeTmp();
  const saved = { HOME: process.env.HOME, SESSION_ROOT: process.env.SESSION_ROOT };
  try {
    process.env.HOME = home;
    assert.equal(os.homedir(), home);
    const fallback = path.join(home, 'src', '.ai', 'sessions');

    process.env.SESSION_ROOT = path.join(home, 'first');
    assert.equal(sessionRoot(), path.join(home, 'first'));
    process.env.SESSION_ROOT = path.join(home, 'second');
    assert.equal(sessionRoot(), path.join(home, 'second'));
    process.env.SESSION_ROOT = '';
    assert.equal(sessionRoot(), fallback);
    delete process.env.SESSION_ROOT;
    assert.equal(sessionRoot(), fallback);

    // The default argument of resolveSessionDir reads the root per call too.
    process.env.SESSION_ROOT = path.join(home, 'second');
    const dir = makeSessionDir(path.join(home, 'second'), '2026-10-06_a', { id: 'id1' });
    assert.equal(resolveSessionDir(undefined, { sessionId: 'id1' }), dir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('two same-day sessions resolve to their own dirs', () => {
  const root = makeTmp();
  const older = new Date('2026-10-06T08:00:00Z');
  const newer = new Date('2026-10-06T09:00:00Z');
  const a = makeSessionDir(root, '2026-10-06_alpha', { id: 'id1', mtime: older });
  const b = makeSessionDir(root, '2026-10-06_beta', { id: 'id2', mtime: newer });

  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), a);
  assert.equal(resolveSessionDir(root, { sessionId: 'id2' }), b);
  assert.equal(resolveSessionDir(root, { sessionId: 'id3' }), null);
  assert.equal(resolveSessionDir(root, {}), null);
  assert.equal(resolveSessionDir(root), null);
});

test('resumed session resolves across dates', () => {
  const root = makeTmp();
  const resumed = makeSessionDir(root, '2026-10-05_yesterday', { id: 'id1', mtime: new Date('2026-10-05T08:00:00Z') });
  // A newer dir dated today that belongs to nobody must not win by date or mtime.
  makeSessionDir(root, `${today()}_unrelated`, { id: 'id2' });
  makeSessionDir(root, `${today()}_unstamped`);

  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), resumed);
});

test('duplicate session_id takes newest SESSION.md mtime', () => {
  const root = makeTmp();
  const a = makeSessionDir(root, '2026-10-06_a', { id: 'id1' });
  const b = makeSessionDir(root, '2026-10-06_b', { id: 'id1' });
  const old = new Date('2026-10-06T08:00:00Z');
  const recent = new Date('2026-10-06T09:00:00Z');

  fs.utimesSync(path.join(a, 'SESSION.md'), old, old);
  fs.utimesSync(path.join(b, 'SESSION.md'), recent, recent);
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), b);

  fs.utimesSync(path.join(a, 'SESSION.md'), recent, recent);
  fs.utimesSync(path.join(b, 'SESSION.md'), old, old);
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), a);
});

test('scan matches only an exact top-level session_id', () => {
  const root = makeTmp();
  const decoys = new Date('2026-10-06T09:00:00Z');
  const real = new Date('2026-10-06T08:00:00Z');

  // Every decoy mentions id1 inside the first 4096 bytes, so only the parsed
  // top-level session_id can keep it out. Each is newer than the real dir will
  // be, so an accepted decoy would also win on mtime.
  const decoy = (name, text) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const file = path.join(dir, 'SESSION.md');
    fs.writeFileSync(file, text);
    fs.utimesSync(file, decoys, decoys);
  };
  // The id appears in the body, but the session_id belongs to another session.
  decoy('2026-10-06_body-mention', '---\nschema: v1\nsession_id: other\n---\n\n# Session\n\nResumed from id1\n');
  // The id appears as a nested key; the top-level session_id is another one.
  decoy('2026-10-06_nested', [
    '---', 'schema: v1', 'session_id: zzz', 'delivery:', '  - repo: /x', '    session_id: id1', '---', '', '# Session', '',
  ].join('\n'));
  // The wanted id is a prefix of this one.
  decoy('2026-10-06_longer-id', '---\nschema: v1\nsession_id: id10\n---\n\n# Session\n');

  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), null);

  const owner = makeSessionDir(root, '2026-10-06_owner', { id: 'id1', mtime: real });
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), owner);
});

test('legacy .active file or dir is ignored and preserved', () => {
  const root = makeTmp();
  makeSessionDir(root, '2026-10-06_decoy', { id: 'someone-else' });
  const active = path.join(root, '.active');

  // As a file naming a dir (the old layout).
  fs.writeFileSync(active, '2026-10-06_decoy\n');
  const before = fs.readFileSync(active);
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), null);
  assert.equal(resolveSessionDir(root), null);
  assert.deepEqual(fs.readFileSync(active), before);

  // As a dir that carries a SESSION.md stamped with the id: dot dirs are not scanned.
  fs.rmSync(active);
  fs.mkdirSync(active);
  fs.writeFileSync(path.join(active, 'SESSION.md'), stamped('id1'));
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), null);
  assert.deepEqual(fs.readdirSync(active), ['SESSION.md']);
});

test('pointer wins; stale, relative or file pointers fall through to scan', () => {
  const root = makeTmp();
  const scanned = makeSessionDir(root, '2026-10-05_scanned', { id: 'id1' });
  const bound = makeSessionDir(root, '2026-10-06_bound');
  const pointer = path.join(root, '.sessions', 'id1');

  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), scanned);

  // A valid pointer beats the stamped dir the scan would find.
  assert.equal(bindSession(root, 'id1', bound), true);
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), bound);

  // Every kind of unusable pointer gives the scan result, never the pointer's target.
  const unusable = {
    'missing dir': `${path.join(root, 'gone')}\n`,
    'relative path': 'relative/dir\n',
    'relative name that exists under the root': '2026-10-06_bound\n',
    'relative path that exists from the cwd': `${path.relative(process.cwd(), bound)}\n`,
    'regular file': `${path.join(bound, 'SESSION.md')}\n`,
    'blank line': '\n',
    empty: '',
  };
  for (const [label, content] of Object.entries(unusable)) {
    fs.writeFileSync(pointer, content);
    assert.equal(readPointer(root, 'id1'), null, label);
    assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), scanned, label);
  }
  fs.rmSync(pointer);
  fs.mkdirSync(pointer);
  assert.equal(readPointer(root, 'id1'), null, 'pointer is a dir');
  assert.equal(resolveSessionDir(root, { sessionId: 'id1' }), scanned, 'pointer is a dir');

  // Surrounding whitespace is trimmed.
  fs.rmdirSync(pointer);
  fs.writeFileSync(pointer, `  ${bound}  \n\n`);
  assert.equal(readPointer(root, 'id1'), bound);
});

test('invalid id never touches disk', () => {
  const root = makeTmp();
  const dir = makeSessionDir(root, '2026-10-06_real', { id: 'id1' });
  // Dirs stamped with ids that are not valid must not be found by a scan either.
  makeSessionDir(root, '2026-10-06_spaced', { id: 'a b' });
  makeSessionDir(root, '2026-10-06_blank');
  fs.writeFileSync(path.join(root, '2026-10-06_blank', 'SESSION.md'), '---\nsession_id:\n---\n');
  const listing = fs.readdirSync(root).sort();

  const invalid = ['../x', '', '.hidden', 'a/b', 'a b', '-lead', 'x'.repeat(129), 'abc\n', null, undefined, 42, {}];
  for (const id of invalid) {
    const label = JSON.stringify(id);
    assert.equal(isValidSessionId(id), false, label);
    assert.equal(pointerPath(root, id), null, label);
    assert.equal(readPointer(root, id), null, label);
    assert.equal(bindSession(root, id, dir), false, label);
    assert.equal(resolveSessionDir(root, { sessionId: id }), null, label);
  }

  assert.equal(fs.existsSync(path.join(root, '.sessions')), false);
  assert.equal(fs.existsSync(path.join(root, 'x')), false);
  assert.deepEqual(fs.readdirSync(root).sort(), listing);

  for (const id of ['x'.repeat(128), 'a', '0abc', 'a_b-c', '5b1f6a0e-9c1d-4d3b-8a52-0f6a1c2d3e4f']) {
    assert.equal(isValidSessionId(id), true, id);
  }
});

test('bindSession writes realpath plus newline atomically', () => {
  const root = makeTmp();
  const real = makeSessionDir(root, '2026-10-06_real');
  const other = makeSessionDir(root, '2026-10-06_other');
  const link = path.join(makeTmp(), 'link');
  fs.symlinkSync(real, link);
  const pointer = path.join(root, '.sessions', 'id1');

  assert.equal(bindSession(root, 'id1', link), true);
  assert.equal(fs.readFileSync(pointer, 'utf8'), `${real}\n`);
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['id1']);

  // Rebinding replaces the pointer in place and leaves no temp file behind.
  assert.equal(bindSession(root, 'id1', other), true);
  assert.equal(fs.readFileSync(pointer, 'utf8'), `${other}\n`);
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['id1']);

  // A missing dir or a regular file is refused and the pointer stays as it was.
  assert.equal(bindSession(root, 'id1', path.join(root, 'gone')), false);
  assert.equal(bindSession(root, 'id1', path.join(other, 'SESSION.md')), false);
  assert.equal(fs.readFileSync(pointer, 'utf8'), `${other}\n`);
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['id1']);

  // A refusal on a fresh root creates nothing.
  const fresh = makeTmp();
  assert.equal(bindSession(fresh, 'id1', path.join(fresh, 'gone')), false);
  assert.deepEqual(fs.readdirSync(fresh), []);
});

test('frontmatter strips inline comments', () => {
  assert.equal(parseFrontmatter(`---\n${TEMPLATE_STATUS}\n---\n`).status, 'draft');

  const fm = parseFrontmatter([
    '---',
    'a: "a # b"',
    "b: 'x # y' # trailing",
    'c: plain # note',
    'd: # only a comment',
    'e: http://host/p#frag',
    'f: "q"',
    'g: tab\t# note',
    'h: no comment',
    '---',
    '',
  ].join('\n'));
  assert.deepEqual(fm, {
    a: 'a # b', b: 'x # y', c: 'plain', d: '', e: 'http://host/p#frag', f: 'q', g: 'tab', h: 'no comment',
  });

  assert.deepEqual(parseFrontmatter('no frontmatter here\nstatus: complete\n'), {});
});

test('frontmatter ignores indented keys', () => {
  const text = [
    '---',
    'status: draft',
    'delivery:',
    '  - repo: /x',
    '    status: complete',
    '    session_id: nested',
    'targets:',
    '- repo: /y',
    '  status: complete',
    '---',
    '',
  ].join('\n');
  const fm = parseFrontmatter(text);
  assert.equal(fm.status, 'draft');
  assert.equal(fm.session_id, undefined);
});

test('inferPhase exact tokens', () => {
  const cases = [
    ['draft', 'plan'], ['awaiting-approval', 'plan'], ['planning', 'plan'], ['plan', 'plan'],
    ['approved', 'implement'], ['in-progress', 'implement'], ['implementing', 'implement'], ['implement', 'implement'],
    ['complete', 'complete'], ['completed', 'complete'], ['done', 'complete'],
    // Substring matching would send these to complete / plan.
    ['incomplete', 'implement'], ['awaiting-approvals', 'implement'], ['undone', 'implement'],
    ['mystery', 'implement'],
    ['Awaiting-Approval', 'plan'], ['DONE', 'complete'],
    ['awaiting-approval # x', 'plan'], ['"draft"', 'plan'],
    [TEMPLATE_STATUS.slice('status: '.length), 'plan'],
  ];
  for (const [status, phase] of cases) {
    assert.equal(inferPhase(makeDir({ 'PLAN.md': planWith(status) })), phase, status);
  }
  // A PLAN with no status at all is past planning.
  assert.equal(inferPhase(makeDir({ 'PLAN.md': '---\nschema: plan/v2\n---\n# PLAN\n' })), 'implement');
});

test('inferPhase without a PLAN falls back to file presence', () => {
  assert.equal(inferPhase(makeDir({ 'DISCOVERY.md': '# d\n', 'SESSION.md': '# s\n' })), 'plan');
  assert.equal(inferPhase(makeDir({ 'SESSION.md': '# s\n' })), 'discover');
  assert.equal(inferPhase(makeDir({})), null);
});

test('inferPhase skips PLAN-INDEX and reports least advanced', () => {
  // The index is less advanced than every plan; counting it would give plan.
  assert.equal(inferPhase(makeDir({
    'PLAN-INDEX.md': planWith('draft'), 'PLAN-a.md': planWith('complete'), 'PLAN-b.md': planWith('complete'),
  })), 'complete');

  // Reading only the first plan would give complete.
  assert.equal(inferPhase(makeDir({
    'PLAN-a.md': planWith('complete'), 'PLAN-b.md': planWith('in-progress'),
  })), 'implement');
  assert.equal(inferPhase(makeDir({
    'PLAN-a.md': planWith('complete'), 'PLAN-b.md': planWith('in-progress'), 'PLAN-c.md': planWith('draft'),
  })), 'plan');
  assert.equal(inferPhase(makeDir({
    'PLAN-c.md': planWith('draft'), 'PLAN.md': planWith('approved'), 'PLAN-2.md': planWith('done'),
  })), 'plan');

  // An index alone is not a plan.
  assert.equal(inferPhase(makeDir({ 'PLAN-INDEX.md': planWith('draft'), 'SESSION.md': '# s\n' })), 'discover');
});

test('context-snapshot writes only to the bound dir with phase plan', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const id = 'snapshot-session-1';

  // The session's dir: dated yesterday, template-status PLAN, bound by pointer.
  const bound = makeSessionDir(root, '2026-10-05_bound-session');
  fs.writeFileSync(path.join(bound, 'PLAN.md'), planWith(TEMPLATE_STATUS.slice('status: '.length)));
  fs.mkdirSync(path.join(root, '.sessions'));
  fs.writeFileSync(path.join(root, '.sessions', id), `${bound}\n`);

  // Another session's dir: dated today, newer, and named by the legacy .active file.
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const other = makeSessionDir(root, `${today()}_other-session`, { id: 'someone-else', mtime: future });
  fs.writeFileSync(path.join(other, 'PLAN.md'), planWith('complete'));
  fs.writeFileSync(path.join(root, '.active'), `${path.basename(other)}\n`);

  const res = runHook('context-snapshot.js', { session_id: id }, env);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), '{}');
  const snapshot = path.join(bound, 'CONTEXT_SNAPSHOT.md');
  assert.ok(fs.existsSync(snapshot), 'snapshot missing from the bound dir');
  assert.ok(fs.readFileSync(snapshot, 'utf8').includes('Phase: **plan**'));
  assert.equal(fs.existsSync(path.join(other, 'CONTEXT_SNAPSHOT.md')), false);
  assert.equal(fs.readFileSync(path.join(root, '.active'), 'utf8'), `${path.basename(other)}\n`);
});
