'use strict';
/**
 * Tests for the Stop hook session-bootstrap.js and scripts/new-session.sh.
 * Both run for real: the hook as a child node process, the script through bash.
 * Every fixture lives under a temp SESSION_ROOT, never the real one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { HOOKS_DIR, makeTmp, hookEnv, runHook } = require('./helpers');
const { isHeadless } = require('../lib/session');

const SCRIPT = path.resolve(HOOKS_DIR, '..', 'scripts', 'new-session.sh');
const MESSAGE_PREFIX = 'Constellation session journal not created: ';

/**
 * A transcript file. Like a real one it opens with a timestamp-less
 * bridge-session line; then come the first prompt, an optional custom title and
 * a reply, each user or assistant entry carrying its `entrypoint`.
 */
function writeTranscript({ title, prompt = 'Fix the login bug', entrypoint = 'cli' } = {}) {
  const entries = [{ type: 'bridge-session' }];
  if (prompt) {
    entries.push({
      type: 'user', entrypoint, timestamp: '2026-10-07T12:00:00.000Z',
      message: { role: 'user', content: prompt },
    });
  }
  if (title) entries.push({ type: 'custom-title', customTitle: title });
  entries.push({
    type: 'assistant', entrypoint, timestamp: '2026-10-07T12:00:05.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] },
  });
  const file = path.join(makeTmp(), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

function stop(env, sessionId, transcriptPath) {
  return runHook('session-bootstrap.js', {
    hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcriptPath,
  }, env);
}

function runScript(args, env) {
  const res = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, lastLine: res.stdout.trimEnd().split('\n').pop() };
}

/**
 * The local calendar date in `tz` (or the test process's own zone), asked of a
 * child node so the zone is applied the way the hook process sees it. Written
 * with Intl rather than the lib's getDate arithmetic, so the two can disagree.
 */
function localDate(tz) {
  const res = spawnSync(process.execPath, ['-e', "process.stdout.write(new Date().toLocaleDateString('en-CA'))"], {
    env: tz ? { ...process.env, TZ: tz } : process.env, encoding: 'utf8',
  });
  return res.stdout;
}

const utcDate = () => new Date().toISOString().slice(0, 10);

/** The root's visible (non-dot) entries. */
const visible = root => fs.readdirSync(root).filter(n => !n.startsWith('.')).sort();

/** The top-level frontmatter lines of a SESSION.md. */
function frontmatter(file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file} has no frontmatter`);
  return m[1].split('\n');
}

const pointerOf = (root, id) => fs.readFileSync(path.join(root, '.sessions', id), 'utf8');

/** Every path under `dir` with its content, to prove a call changed nothing. */
function tree(dir) {
  const out = {};
  const walk = rel => {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isDirectory()) {
      out[rel + '/'] = null;
      for (const name of fs.readdirSync(full)) walk(path.join(rel, name));
    } else {
      out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk('');
  return out;
}

/** A pre-existing session of another id, so a hook that wrongly reuses it is visible. */
function seedOtherSession(root, name = '2026-01-01_Old') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SESSION.md'), '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
  return dir;
}

test('scaffolds only SESSION.md, stamped and bound', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const transcript = writeTranscript({ title: 'PROJ-42 Fix login bug' });

  const before = localDate();
  const res = stop(env, 'sess-1', transcript);
  const after = localDate();

  assert.equal(res.status, 0);
  assert.deepEqual(res.json, {});
  const dirs = visible(root);
  assert.equal(dirs.length, 1, `expected one session dir, got ${dirs}`);
  const m = /^(\d{4}-\d{2}-\d{2})_PROJ-42_Fix-login-bug$/.exec(dirs[0]);
  assert.ok(m, `unexpected dir name ${dirs[0]}`);
  assert.ok([before, after].includes(m[1]), `${m[1]} is not the local date (${before}, ${after})`);

  const dir = path.join(root, dirs[0]);
  assert.deepEqual(fs.readdirSync(dir), ['SESSION.md']);
  const fm = frontmatter(path.join(dir, 'SESSION.md'));
  assert.ok(fm.includes('session_id: sess-1'), `frontmatter: ${fm}`);
  assert.ok(fm.includes('slug: Fix-login-bug'), `frontmatter: ${fm}`);
  assert.ok(fm.includes(`date: ${m[1]}`), `frontmatter: ${fm}`);
  assert.ok(!fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8').includes('{{'), 'unfilled template field');

  assert.equal(pointerOf(root, 'sess-1'), fs.realpathSync(dir) + '\n');
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['sess-1']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.sessions', dirs[0]].sort(), 'only the dir and .sessions');
});

test('bootstrap names the dir with the local date in two time zones', () => {
  const kiritimati = 'Pacific/Kiritimati'; // UTC+14
  const pagoPago = 'Pacific/Pago_Pago'; // UTC-11

  // At any instant one of the two zones is on a different date than UTC, so a
  // hook that passed the UTC date would be caught in that zone. If the zone
  // names were unknown, TZ would silently mean UTC and this fails loudly.
  const kiriNow = localDate(kiritimati);
  const pagoNow = localDate(pagoPago);
  const utcNow = utcDate();
  assert.ok(kiriNow !== utcNow || pagoNow !== utcNow, `TZ is not taking effect: ${kiriNow} ${pagoNow} ${utcNow}`);

  [kiritimati, pagoPago].forEach((tz, i) => {
    const env = hookEnv({ TZ: tz });
    const before = localDate(tz);
    const res = stop(env, `tz-sess-${i}`, writeTranscript({ title: 'PROJ-42 Fix login bug' }));
    const after = localDate(tz);

    assert.deepEqual(res.json, {});
    const dirs = visible(env.SESSION_ROOT);
    assert.equal(dirs.length, 1, `${tz}: expected one dir, got ${dirs}`);
    const date = dirs[0].slice(0, 10);
    assert.ok([before, after].includes(date), `${tz}: dir ${dirs[0]} is not dated ${before} or ${after}`);
    assert.ok(frontmatter(path.join(env.SESSION_ROOT, dirs[0], 'SESSION.md')).includes(`date: ${date}`));
  });

  // The script alone, with no SESSION_DATE, takes the same local date.
  const env = hookEnv({ TZ: kiritimati, SESSION_DATE: undefined });
  const before = localDate(kiritimati);
  const res = runScript(['Fix-login-bug', '', 'script-sess'], env);
  const after = localDate(kiritimati);
  assert.equal(res.status, 0, res.stderr);
  const dirs = visible(env.SESSION_ROOT);
  assert.equal(dirs.length, 1);
  assert.ok([before, after].includes(dirs[0].slice(0, 10)), `script dir ${dirs[0]} is not dated ${before} or ${after}`);
});

test('parallel sessions with the same title get separate dirs', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const title = 'PROJ-42 Fix login bug';

  assert.deepEqual(stop(env, 'sess-a', writeTranscript({ title })).json, {});
  assert.deepEqual(stop(env, 'sess-b', writeTranscript({ title })).json, {});

  const dirs = visible(root);
  assert.equal(dirs.length, 2, `got ${dirs}`);
  const [first, second] = dirs;
  assert.match(first, /^\d{4}-\d{2}-\d{2}_PROJ-42_Fix-login-bug$/);
  assert.equal(second, `${first}-2`);

  assert.equal(pointerOf(root, 'sess-a'), fs.realpathSync(path.join(root, first)) + '\n');
  assert.equal(pointerOf(root, 'sess-b'), fs.realpathSync(path.join(root, second)) + '\n');
  assert.ok(frontmatter(path.join(root, first, 'SESSION.md')).includes('session_id: sess-a'));
  assert.ok(frontmatter(path.join(root, second, 'SESSION.md')).includes('session_id: sess-b'));
});

test('second Stop does not scaffold again', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const transcript = writeTranscript({ title: 'PROJ-42 Fix login bug' });

  assert.deepEqual(stop(env, 'sess-1', transcript).json, {});
  const dir = path.join(root, visible(root)[0]);
  // The agent journals; a later Stop must neither replace nor duplicate it.
  fs.appendFileSync(path.join(dir, 'SESSION.md'), '\nAgent notes.\n');
  const snapshot = tree(root);

  assert.deepEqual(stop(env, 'sess-1', transcript).json, {});
  assert.deepEqual(tree(root), snapshot);
});

test('a session found by scan gets its pointer rebound, with no new dir', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const dir = path.join(root, '2026-10-01_Old');
  fs.mkdirSync(dir);
  const body = '---\nschema: v1\nsession_id: sess-9\n---\n\n# Old\n';
  fs.writeFileSync(path.join(dir, 'SESSION.md'), body);

  assert.deepEqual(stop(env, 'sess-9', writeTranscript({ title: 'PROJ-42 Fix login bug' })).json, {});

  assert.deepEqual(visible(root), ['2026-10-01_Old']);
  assert.equal(pointerOf(root, 'sess-9'), fs.realpathSync(dir) + '\n');
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), body);
});

test('legacy .active does not block scaffolding', () => {
  const transcript = writeTranscript({ title: 'PROJ-42 Fix login bug' });

  // File form: it names another session's dir, which the old early return honored.
  {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    const old = seedOtherSession(root);
    const oldBody = fs.readFileSync(path.join(old, 'SESSION.md'), 'utf8');
    fs.writeFileSync(path.join(root, '.active'), '2026-01-01_Old\n');

    assert.deepEqual(stop(env, 'sess-1', transcript).json, {});

    assert.equal(visible(root).length, 2, `expected Old plus a new dir, got ${visible(root)}`);
    assert.equal(fs.readFileSync(path.join(root, '.active'), 'utf8'), '2026-01-01_Old\n');
    assert.equal(fs.readFileSync(path.join(old, 'SESSION.md'), 'utf8'), oldBody);
    assert.equal(pointerOf(root, 'sess-1'), fs.realpathSync(path.join(root, visible(root)[1])) + '\n');
  }

  // Directory form: the old script's write to .active would have failed.
  {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    fs.mkdirSync(path.join(root, '.active'));
    fs.writeFileSync(path.join(root, '.active', 'keep.txt'), 'keep\n');
    const before = tree(path.join(root, '.active'));

    assert.deepEqual(stop(env, 'sess-1', transcript).json, {});

    assert.equal(visible(root).length, 1);
    assert.deepEqual(tree(path.join(root, '.active')), before);
    assert.equal(pointerOf(root, 'sess-1'), fs.realpathSync(path.join(root, visible(root)[0])) + '\n');
  }
});

test('new-session.sh honors SESSION_DATE and CLAUDE_CODE_SESSION_ID', () => {
  const env = hookEnv({ SESSION_DATE: '2031-02-03', CLAUDE_CODE_SESSION_ID: 'env-id-1' });
  const root = env.SESSION_ROOT;

  // The id comes from CLAUDE_CODE_SESSION_ID, the date from SESSION_DATE.
  const first = runScript(['Fix-login-bug', 'PROJ-7'], env);
  assert.equal(first.status, 0, first.stderr);
  const dir = path.join(root, '2031-02-03_PROJ-7_Fix-login-bug');
  assert.equal(first.lastLine, fs.realpathSync(dir));
  assert.deepEqual(fs.readdirSync(dir), ['SESSION.md']);
  const fm = frontmatter(path.join(dir, 'SESSION.md'));
  assert.ok(fm.includes('date: 2031-02-03'), `frontmatter: ${fm}`);
  assert.ok(fm.includes('session_id: env-id-1'), `frontmatter: ${fm}`);
  assert.equal(pointerOf(root, 'env-id-1'), fs.realpathSync(dir) + '\n');

  // Running it again for the same id reuses the dir and leaves the file alone.
  fs.appendFileSync(path.join(dir, 'SESSION.md'), '\nAgent notes.\n');
  const body = fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8');
  const again = runScript(['Fix-login-bug', 'PROJ-7'], env);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.lastLine, fs.realpathSync(dir));
  assert.deepEqual(visible(root), ['2031-02-03_PROJ-7_Fix-login-bug']);
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), body);

  // An id passed as the third argument wins over the environment.
  const explicit = runScript(['Other-slug', '', 'arg-id-2'], env);
  assert.equal(explicit.status, 0, explicit.stderr);
  const otherDir = path.join(root, '2031-02-03_Other-slug');
  assert.ok(frontmatter(path.join(otherDir, 'SESSION.md')).includes('session_id: arg-id-2'));
  assert.equal(pointerOf(root, 'arg-id-2'), fs.realpathSync(otherDir) + '\n');
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')).sort(), ['arg-id-2', 'env-id-1']);

  // With no id at all the date-slug is stamped, and no pointer is written for it.
  const bare = hookEnv({ SESSION_DATE: '2031-02-03' });
  const fallback = runScript(['Third-slug'], bare);
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.ok(frontmatter(path.join(bare.SESSION_ROOT, '2031-02-03_Third-slug', 'SESSION.md')).includes('session_id: 2031-02-03_Third-slug'));
  assert.ok(!fs.existsSync(path.join(bare.SESSION_ROOT, '.sessions')), 'a date-slug id must not get a pointer');
});

test('the pointer holds the realpath when SESSION_ROOT is a symlink', () => {
  // hookEnv roots live under the realpath of the temp dir, so a realpath and a
  // plain path coincide there. Only a root reached through a link tells them apart.
  const base = makeTmp();
  const realRoot = path.join(base, 'real-sessions');
  const linkRoot = path.join(base, 'link-sessions');
  fs.mkdirSync(realRoot);
  fs.symlinkSync(realRoot, linkRoot);
  assert.notEqual(fs.realpathSync(linkRoot), linkRoot, 'the fixture root is not a symlink');
  const env = hookEnv({ SESSION_ROOT: linkRoot });

  // The pointer must name the dir under the real root, never under the link.
  const expectResolved = (id, name) => {
    const viaLink = path.join(linkRoot, name);
    const real = path.join(fs.realpathSync(realRoot), name);
    assert.ok(fs.statSync(real).isDirectory(), `${real} is not a dir`);
    assert.equal(pointerOf(linkRoot, id), real + '\n', `pointer for ${id}`);
    assert.notEqual(pointerOf(linkRoot, id), viaLink + '\n', `pointer for ${id} holds the link path`);
    return real;
  };

  // The Stop hook scaffolds through new-session.sh, which writes the pointer.
  assert.deepEqual(stop(env, 'link-sess-1', writeTranscript({ title: 'PROJ-42 Fix login bug' })).json, {});
  expectResolved('link-sess-1', visible(linkRoot)[0]);

  // The script on its own, including the dir it prints as its last line.
  const res = runScript(['Other-slug', '', 'link-sess-2'], env);
  assert.equal(res.status, 0, res.stderr);
  const name = visible(linkRoot).find(n => n.endsWith('_Other-slug'));
  assert.ok(name, `no Other-slug dir in ${visible(linkRoot)}`);
  assert.equal(res.lastLine, expectResolved('link-sess-2', name));

  // The Stop hook rebinding a session that only a scan can find goes through the lib.
  const old = path.join(linkRoot, '2026-10-01_Old');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'SESSION.md'), '---\nschema: v1\nsession_id: link-sess-3\n---\n\n# Old\n');
  assert.deepEqual(stop(env, 'link-sess-3', writeTranscript({ title: 'PROJ-42 Fix login bug' })).json, {});
  expectResolved('link-sess-3', '2026-10-01_Old');
});

test('new-session.sh gives up after -99 and writes nothing more', () => {
  const env = hookEnv({ SESSION_DATE: '2031-02-03' });
  const root = env.SESSION_ROOT;
  seedOtherSession(root, '2031-02-03_Busy');
  for (let n = 2; n <= 99; n++) seedOtherSession(root, `2031-02-03_Busy-${n}`);
  const snapshot = tree(root);

  const res = runScript(['Busy', '', 'new-id'], env);

  assert.equal(res.status, 1);
  assert.ok(res.stderr.trim().length > 0, 'a failure must say why');
  assert.deepEqual(tree(root), snapshot);
});

test('new-session.sh rejects an invalid id or slug', () => {
  const cases = [
    { name: 'id', args: ['Fix-login-bug', '', '../x'] },
    { name: 'slug', args: ['../x', '', 'good-id'] },
    { name: 'ticket', args: ['Fix-login-bug', '../x', 'good-id'] },
    { name: 'no slug', args: [] },
    { name: 'slug starting with a dash', args: ['-x', '', 'good-id'] },
    { name: 'id too long', args: ['Fix-login-bug', '', 'a'.repeat(129)] },
    { name: 'id from the environment', args: ['Fix-login-bug'], extra: { CLAUDE_CODE_SESSION_ID: '../x' } },
    { name: 'date', args: ['Fix-login-bug', '', 'good-id'], extra: { SESSION_DATE: '2026-1-1' } },
  ];

  for (const { name, args, extra } of cases) {
    const env = hookEnv(extra);
    const root = env.SESSION_ROOT;
    seedOtherSession(root);
    fs.mkdirSync(path.join(root, '.sessions'));
    fs.writeFileSync(path.join(root, '.sessions', 'other-id'), `${path.join(root, '2026-01-01_Old')}\n`);
    const snapshot = tree(root);

    const res = runScript(args, env);

    assert.equal(res.status, 2, `${name}: exit ${res.status}, stderr: ${res.stderr}`);
    assert.ok(res.stderr.trim().length > 0, `${name}: a rejection must say why`);
    assert.deepEqual(tree(root), snapshot, `${name}: the root changed`);
  }

  // Validation comes before any mkdir, so a root that does not exist yet stays absent.
  const fresh = path.join(makeTmp(), 'never-created');
  const res = runScript(['Fix-login-bug', '', '../x'], hookEnv({ SESSION_ROOT: fresh }));
  assert.equal(res.status, 2);
  assert.ok(!fs.existsSync(fresh), 'rejected input created the root');
});

test('no session_id is a no-op', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const transcript = writeTranscript({ title: 'PROJ-42 Fix login bug' });

  const payloads = [
    { transcript_path: transcript },
    { session_id: '../x', transcript_path: transcript },
    { session_id: '', transcript_path: transcript },
    { session_id: 'sess-1' }, // no transcript either
    {},
    'null',
    'not json',
  ];
  for (const payload of payloads) {
    const res = runHook('session-bootstrap.js', payload, env);
    assert.equal(res.status, 0, JSON.stringify(payload));
    assert.deepEqual(res.json, {}, JSON.stringify(payload));
    assert.deepEqual(fs.readdirSync(root), [], `${JSON.stringify(payload)} wrote into the root`);
  }
});

test('headless skips; CONSTELLATION_SCAFFOLD=always forces', () => {
  const title = 'PROJ-42 Fix login bug';

  // The env var says headless.
  {
    const env = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
    assert.deepEqual(stop(env, 'sess-1', writeTranscript({ title })).json, {});
    assert.deepEqual(fs.readdirSync(env.SESSION_ROOT), [], '-p run left a session dir');
  }

  // No env var: the transcript's own entrypoint says headless.
  {
    const env = hookEnv();
    assert.deepEqual(stop(env, 'sess-1', writeTranscript({ title, entrypoint: 'sdk-cli' })).json, {});
    assert.deepEqual(fs.readdirSync(env.SESSION_ROOT), [], 'headless transcript left a session dir');
  }

  // always overrides both signals.
  for (const env of [
    hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_SCAFFOLD: 'always' }),
    hookEnv({ CONSTELLATION_SCAFFOLD: 'always' }),
  ]) {
    const entrypoint = env.CLAUDE_CODE_ENTRYPOINT ? 'cli' : 'sdk-cli';
    assert.deepEqual(stop(env, 'sess-1', writeTranscript({ title, entrypoint })).json, {});
    assert.equal(visible(env.SESSION_ROOT).length, 1, 'always did not scaffold');
  }

  // The env var wins over the transcript: an interactive entrypoint scaffolds.
  {
    const env = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' });
    assert.deepEqual(stop(env, 'sess-1', writeTranscript({ title, entrypoint: 'sdk-cli' })).json, {});
    assert.equal(visible(env.SESSION_ROOT).length, 1, 'an interactive entrypoint did not scaffold');
  }
});

test('isHeadless reads the env first, then the first transcript entry with an entrypoint', () => {
  const sdk = writeTranscript({ entrypoint: 'sdk-ts' });
  const interactive = writeTranscript({ entrypoint: 'cli' });
  const missing = path.join(makeTmp(), 'nope.jsonl');

  for (const ep of ['sdk-cli', 'sdk-py', 'sdk-ts']) {
    assert.equal(isHeadless({ CLAUDE_CODE_ENTRYPOINT: ep }, interactive), true, ep);
  }
  assert.equal(isHeadless({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, sdk), false, 'env wins over the transcript');
  assert.equal(isHeadless({}, sdk), true);
  assert.equal(isHeadless({ CLAUDE_CODE_ENTRYPOINT: '' }, sdk), true, 'an empty env value is unset');
  assert.equal(isHeadless({}, interactive), false);
  assert.equal(isHeadless({}, missing), false, 'no signal means interactive');
  assert.equal(isHeadless({ CONSTELLATION_SCAFFOLD: 'always', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, sdk), false);
  assert.equal(isHeadless({ CONSTELLATION_SCAFFOLD: 'yes', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, sdk), true, 'only always forces');
});

test('falls back to the first prompt for the title; no title and no prompt scaffolds nothing', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;

  assert.deepEqual(stop(env, 'sess-0', writeTranscript({ prompt: null })).json, {});
  assert.deepEqual(fs.readdirSync(root), []);

  assert.deepEqual(stop(env, 'sess-1', writeTranscript({ prompt: 'Add rate limiting' })).json, {});
  const dirs = visible(root);
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /^\d{4}-\d{2}-\d{2}_Add-rate-limiting$/);
});

test('scaffolds from a plugin copy whose script is not executable', () => {
  // An install can drop the exec bit; the hook must run the script through bash.
  const plugin = makeTmp();
  fs.cpSync(HOOKS_DIR, path.join(plugin, 'hooks'), { recursive: true, filter: src => path.basename(src) !== 'test' });
  fs.mkdirSync(path.join(plugin, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(plugin, 'scripts', 'new-session.sh'));
  fs.chmodSync(path.join(plugin, 'scripts', 'new-session.sh'), 0o644);
  fs.mkdirSync(path.join(plugin, 'docs'));
  fs.copyFileSync(path.resolve(HOOKS_DIR, '..', 'docs', 'SESSION-TEMPLATE.md'), path.join(plugin, 'docs', 'SESSION-TEMPLATE.md'));

  const env = hookEnv();
  const res = spawnSync(process.execPath, [path.join(plugin, 'hooks', 'session-bootstrap.js')], {
    input: JSON.stringify({
      session_id: 'sess-1', transcript_path: writeTranscript({ title: 'PROJ-42 Fix login bug' }),
    }),
    env, encoding: 'utf8',
  });

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {});
  assert.equal(visible(env.SESSION_ROOT).length, 1);
});

test('scaffold failure surfaces systemMessage', () => {
  const env = hookEnv();
  // A root beneath a regular file can never be created.
  const blocker = path.join(makeTmp(), 'blocker');
  fs.writeFileSync(blocker, 'not a dir\n');
  env.SESSION_ROOT = path.join(blocker, 'sessions');

  const res = stop(env, 'sess-1', writeTranscript({ title: 'PROJ-42 Fix login bug' }));

  assert.equal(res.status, 0);
  assert.deepEqual(Object.keys(res.json), ['systemMessage']);
  assert.ok(res.json.systemMessage.startsWith(MESSAGE_PREFIX), res.json.systemMessage);
  const reason = res.json.systemMessage.slice(MESSAGE_PREFIX.length);
  assert.ok(reason.trim().length > 0 && !reason.includes('\n'), `reason must be one non-empty line: ${JSON.stringify(reason)}`);
  assert.equal(fs.readFileSync(blocker, 'utf8'), 'not a dir\n');
});
