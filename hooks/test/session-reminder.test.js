'use strict';
/**
 * Tests for the hooks that tell the agent where its session journal is:
 * session-reminder.js (UserPromptSubmit, once per session), session-start.js
 * (says it again after compaction) and post-compact-logger.js (PostCompact),
 * plus the hooks.json wiring that connects them. Every hook runs as a real
 * child process against a temp SESSION_ROOT, and every expected string is a
 * literal typed here, so a reworded message in the lib fails these tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { HOOKS_DIR, makeTmp, hookEnv, runHook } = require('./helpers');
const { bindSession, readMarker, readPointer, today, writeMarker } = require('../lib/session');

const PLUGIN_DIR = path.resolve(HOOKS_DIR, '..');
const ROUTER_FILE = path.join(PLUGIN_DIR, 'skills', 'using-constellation', 'SKILL.md');

const pendingLine = root =>
  `Session journal: not created yet. Constellation creates it under ${root} when this turn ends (or at the next prompt, if this turn is interrupted), or adopts a session dir you create there this turn.`;
const journalLine = dir =>
  `Session journal: ${dir}/SESSION.md. Journal there; do not create another session dir. Keep '## Decisions' and '## Status' current.`;

function remind(env, sessionId, extra = {}) {
  return runHook('session-reminder.js', {
    hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt: 'Fix the login bug', ...extra,
  }, env);
}

function start(env, sessionId, source = 'startup', extra = {}) {
  return runHook('session-start.js', { hook_event_name: 'SessionStart', source, session_id: sessionId, ...extra }, env);
}

function postCompact(env, sessionId, summary) {
  const payload = { hook_event_name: 'PostCompact', trigger: 'auto', session_id: sessionId };
  if (summary !== undefined) payload.compact_summary = summary;
  return runHook('post-compact-logger.js', payload, env);
}

/** What a hook adds to the agent's context. */
const contextOf = res => res.json.hookSpecificOutput.additionalContext;

/** A session dir under root with a SESSION.md; returns its path. */
function makeSessionDir(root, name = '2026-10-07_Fix-login-bug') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SESSION.md'), '---\nschema: v1\n---\n\n# Session\n');
  return dir;
}

const markerFile = (root, id) => path.join(root, '.sessions', `${id}.announced`);

/** A transcript whose first real entry came from `entrypoint`, after the usual timestamp-less bridge-session line. */
function writeTranscript(entrypoint) {
  const entries = [
    { type: 'bridge-session' },
    { type: 'user', entrypoint, timestamp: '2026-10-07T12:00:00.000Z', message: { role: 'user', content: 'hi' } },
  ];
  const file = path.join(makeTmp(), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

// --- the reminder -------------------------------------------------------------

test('reminder emits pending once, journal once, then nothing', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;

  const first = remind(env, 'sess-1');
  assert.equal(first.status, 0);
  assert.deepEqual(first.json, {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: pendingLine(root) },
  });
  assert.equal(fs.readFileSync(markerFile(root, 'sess-1'), 'utf8'), 'pending');

  assert.deepEqual(remind(env, 'sess-1').json, {}, 'the pending line is not repeated');
  assert.deepEqual(remind(env, 'sess-1').json, {});

  // The session gets its journal, as the Stop hook or the agent's own dir would give it.
  const dir = makeSessionDir(root);
  assert.ok(bindSession(root, 'sess-1', dir));

  const second = remind(env, 'sess-1');
  assert.deepEqual(second.json, {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: journalLine(dir) },
  });
  assert.equal(fs.readFileSync(markerFile(root, 'sess-1'), 'utf8'), dir);

  assert.deepEqual(remind(env, 'sess-1').json, {}, 'the journal line is not repeated');
  assert.deepEqual(remind(env, 'sess-1').json, {});
});

test('each session is announced on its own', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;

  assert.equal(contextOf(remind(env, 'sess-a')), pendingLine(root));
  assert.equal(contextOf(remind(env, 'sess-b')), pendingLine(root));
  assert.deepEqual(remind(env, 'sess-a').json, {});
  assert.deepEqual(remind(env, 'sess-b').json, {});
});

test('reminder announces again when the session is bound to a different dir', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const one = makeSessionDir(root, '2026-10-07_One');
  const two = makeSessionDir(root, '2026-10-07_Two');

  assert.ok(bindSession(root, 'sess-1', one));
  assert.equal(contextOf(remind(env, 'sess-1')), journalLine(one));
  assert.deepEqual(remind(env, 'sess-1').json, {});

  assert.ok(bindSession(root, 'sess-1', two));
  assert.equal(contextOf(remind(env, 'sess-1')), journalLine(two));
  assert.equal(fs.readFileSync(markerFile(root, 'sess-1'), 'utf8'), two);
  assert.deepEqual(remind(env, 'sess-1').json, {});
});

test('headless never emits the pending line', () => {
  // CLAUDE_CODE_ENTRYPOINT names the client for a headless run.
  const byEnv = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  assert.deepEqual(remind(byEnv, 'sess-1').json, {});
  assert.ok(!fs.existsSync(path.join(byEnv.SESSION_ROOT, '.sessions')), 'a headless run writes no marker');

  // Without that variable the transcript's own entrypoint decides.
  const byTranscript = hookEnv();
  const res = remind(byTranscript, 'sess-1', { transcript_path: writeTranscript('sdk-ts') });
  assert.deepEqual(res.json, {});
  assert.ok(!fs.existsSync(path.join(byTranscript.SESSION_ROOT, '.sessions')));

  // An interactive transcript is announced to as usual.
  const interactive = hookEnv();
  assert.equal(
    contextOf(remind(interactive, 'sess-1', { transcript_path: writeTranscript('cli') })),
    pendingLine(interactive.SESSION_ROOT),
  );

  // CONSTELLATION_SCAFFOLD=always lifts the skip, as it does for the Stop hook.
  const always = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_SCAFFOLD: 'always' });
  assert.equal(contextOf(remind(always, 'sess-1')), pendingLine(always.SESSION_ROOT));
});

test('a headless run is never told where a journal is', () => {
  // A headless run gets no journal, so a dir that resolves for it (a resumed
  // session's pointer) is not announced and no marker is written.
  const byEnv = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  const byTranscript = hookEnv();
  for (const [env, extra] of [[byEnv, {}], [byTranscript, { transcript_path: writeTranscript('sdk-ts') }]]) {
    const root = env.SESSION_ROOT;
    const dir = makeSessionDir(root);
    assert.ok(bindSession(root, 'sess-1', dir));
    assert.deepEqual(remind(env, 'sess-1', extra).json, {});
    assert.deepEqual(remind(env, 'sess-1', extra).json, {});
    assert.equal(readMarker(root, 'sess-1'), null, 'a headless run writes no marker');
  }

  // CONSTELLATION_SCAFFOLD=always lifts the skip, as it does for the Stop hook.
  const always = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_SCAFFOLD: 'always' });
  const dir = makeSessionDir(always.SESSION_ROOT);
  assert.ok(bindSession(always.SESSION_ROOT, 'sess-1', dir));
  assert.equal(contextOf(remind(always, 'sess-1')), journalLine(dir));
  assert.deepEqual(remind(always, 'sess-1').json, {});
});

test('reminder with a missing or invalid id prints {} and touches nothing', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;

  for (const id of [undefined, '', '../escape', 'a/b', '.hidden', 'has space', 'x'.repeat(129)]) {
    const res = runHook('session-reminder.js', { hook_event_name: 'UserPromptSubmit', session_id: id }, env);
    assert.equal(res.status, 0, `status for ${JSON.stringify(id)}`);
    assert.deepEqual(res.json, {}, `output for ${JSON.stringify(id)}`);
  }
  const garbage = runHook('session-reminder.js', 'not json', env);
  assert.equal(garbage.status, 0);
  assert.deepEqual(garbage.json, {});

  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written under the root');
});

// --- a turn that never reached Stop -------------------------------------------

const SESSION_UUID = '0f8e9c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

/**
 * A transcript for an interactive session whose first turn ended without a
 * Stop (the user interrupted it): the prompt, the custom title Claude Code
 * wrote, and optionally an assistant tool call that names `madeDir`.
 */
function interruptedTranscript({ madeDir } = {}) {
  const entries = [
    { type: 'bridge-session' },
    { type: 'user', entrypoint: 'claude-desktop', timestamp: '2026-10-07T12:00:00.000Z', message: { role: 'user', content: 'Fix the login bug' } },
    { type: 'custom-title', customTitle: 'Fix login bug' },
  ];
  if (madeDir) {
    entries.push({
      type: 'assistant', entrypoint: 'claude-desktop', timestamp: '2026-10-07T12:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(madeDir, 'SESSION.md') } }] },
    });
  }
  entries.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  const file = path.join(makeTmp(), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('the next prompt creates the journal when the first turn never reached Stop', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const transcript = interruptedTranscript();

  assert.equal(contextOf(remind(env, SESSION_UUID, { transcript_path: transcript })), pendingLine(root));
  assert.deepEqual(fs.readdirSync(root), ['.sessions'], 'the first prompt only records pending');

  // No Stop ran. The second prompt finds the marker still pending and makes the journal itself.
  const dir = path.join(root, `${today()}_Fix-login-bug`);
  const second = remind(env, SESSION_UUID, { transcript_path: transcript });
  assert.equal(second.status, 0);
  assert.equal(contextOf(second), journalLine(dir));
  assert.ok(fs.existsSync(path.join(dir, 'SESSION.md')));
  assert.equal(readPointer(root, SESSION_UUID), dir);
  assert.equal(readMarker(root, SESSION_UUID), dir);

  assert.deepEqual(remind(env, SESSION_UUID, { transcript_path: transcript }).json, {}, 'announced once');
  assert.equal(fs.readdirSync(root).filter(n => !n.startsWith('.')).length, 1, 'one journal dir');
});

test('the next prompt adopts a dir the agent made during the interrupted turn', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const made = makeSessionDir(root, '2026-10-07_My-own-dir');
  const transcript = interruptedTranscript({ madeDir: made });

  writeMarker(root, SESSION_UUID, 'pending');
  assert.equal(contextOf(remind(env, SESSION_UUID, { transcript_path: transcript })), journalLine(made));
  assert.equal(readPointer(root, SESSION_UUID), made);
  assert.match(fs.readFileSync(path.join(made, 'SESSION.md'), 'utf8'), new RegExp(`session_id: ${SESSION_UUID}`));
  assert.deepEqual(fs.readdirSync(root).filter(n => !n.startsWith('.')), ['2026-10-07_My-own-dir'], 'no second dir');
});

test('a pending headless run still gets no journal from the next prompt', () => {
  const env = hookEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  const root = env.SESSION_ROOT;
  writeMarker(root, SESSION_UUID, 'pending');

  assert.deepEqual(remind(env, SESSION_UUID, { transcript_path: interruptedTranscript() }).json, {});
  assert.deepEqual(fs.readdirSync(root), ['.sessions'], 'nothing scaffolded');
});

// --- the marker helpers -------------------------------------------------------

test('marker helpers round-trip a value and refuse an id that is not a safe file name', () => {
  const root = path.join(makeTmp(), 'sessions');

  assert.equal(readMarker(root, 'sess-1'), null, 'no marker yet');
  assert.equal(writeMarker(root, 'sess-1', 'pending'), true);
  assert.equal(readMarker(root, 'sess-1'), 'pending');
  assert.equal(writeMarker(root, 'sess-1', '/some/dir'), true);
  assert.equal(readMarker(root, 'sess-1'), '/some/dir');
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['sess-1.announced']);

  for (const id of [undefined, '', '../escape', 'a/b', '.hidden']) {
    assert.equal(writeMarker(root, id, 'pending'), false, `write ${JSON.stringify(id)}`);
    assert.equal(readMarker(root, id), null, `read ${JSON.stringify(id)}`);
  }
  assert.deepEqual(fs.readdirSync(root), ['.sessions']);
  assert.deepEqual(fs.readdirSync(path.join(root, '.sessions')), ['sess-1.announced']);
});

// --- session-start ------------------------------------------------------------

test('session-start on compact re-injects the journal', () => {
  const env = hookEnv({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR });
  const root = env.SESSION_ROOT;
  const dir = makeSessionDir(root);
  assert.ok(bindSession(root, 'sess-1', dir));

  const res = start(env, 'sess-1', 'compact');
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = contextOf(res);
  assert.ok(ctx.includes('You have constellation skills.'));
  assert.ok(ctx.includes('</EXTREMELY_IMPORTANT>'));
  assert.ok(ctx.endsWith(`</EXTREMELY_IMPORTANT>\n\n${journalLine(dir)}`), `context ends with: ${ctx.slice(-300)}`);

  // It set the marker, so the next prompt does not say it a second time.
  assert.equal(fs.readFileSync(markerFile(root, 'sess-1'), 'utf8'), dir);
  assert.deepEqual(remind(env, 'sess-1').json, {});

  // Another compaction wipes what the reminder said, so the marker must not silence session-start.
  assert.ok(contextOf(start(env, 'sess-1', 'compact')).endsWith(journalLine(dir)));
  assert.deepEqual(remind(env, 'sess-1').json, {});
});

test('session-start in a headless run adds no journal line', () => {
  const routerEnd = '</EXTREMELY_IMPORTANT>';
  const byEnv = hookEnv({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  const byTranscript = hookEnv({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR });
  for (const [env, extra] of [[byEnv, {}], [byTranscript, { transcript_path: writeTranscript('sdk-cli') }]]) {
    const root = env.SESSION_ROOT;
    const dir = makeSessionDir(root);
    assert.ok(bindSession(root, 'sess-1', dir));

    const ctx = contextOf(start(env, 'sess-1', 'compact', extra));
    assert.ok(ctx.includes('You have constellation skills.'), 'the router is still injected');
    assert.ok(ctx.endsWith(routerEnd), `nothing after the router: ${ctx.slice(-200)}`);
    assert.ok(!ctx.includes('Session journal:'));
    assert.equal(readMarker(root, 'sess-1'), null, 'a headless run writes no marker');
  }

  // CONSTELLATION_SCAFFOLD=always lifts the skip.
  const always = hookEnv({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_SCAFFOLD: 'always' });
  const dir = makeSessionDir(always.SESSION_ROOT);
  assert.ok(bindSession(always.SESSION_ROOT, 'sess-1', dir));
  assert.ok(contextOf(start(always, 'sess-1', 'compact')).endsWith(`${routerEnd}\n\n${journalLine(dir)}`));
});

test('session-start without a dir or with an invalid id adds no journal line', () => {
  const env = hookEnv({ CLAUDE_PLUGIN_ROOT: PLUGIN_DIR });
  const root = env.SESSION_ROOT;
  const router = fs.readFileSync(ROUTER_FILE, 'utf8');

  const check = (res, label) => {
    assert.equal(res.status, 0, label);
    const ctx = contextOf(res);
    assert.ok(ctx.includes('You have constellation skills.'), `${label}: router intro`);
    assert.ok(ctx.includes(router), `${label}: router body`);
    assert.ok(ctx.endsWith('</EXTREMELY_IMPORTANT>'), `${label}: nothing after the router`);
    assert.ok(!ctx.includes('Session journal:'), `${label}: journal line`);
  };

  check(start(env, 'sess-1', 'startup'), 'no dir');
  for (const id of [undefined, '', '../escape', 'a/b', '.hidden']) {
    check(start(env, id, 'compact'), `invalid id ${JSON.stringify(id)}`);
  }
  check(runHook('session-start.js', 'not json', env), 'unreadable stdin');

  // A valid id that no dir resolves to must not even get a marker; an
  // invalid one never reaches the filesystem.
  assert.deepEqual(fs.readdirSync(root), [], 'nothing was written under the root');
});

// --- the PostCompact logger ---------------------------------------------------

test('PostCompact appends summary to COMPACT-LOG.md of the bound dir', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const dir = makeSessionDir(root);
  const other = makeSessionDir(root, '2026-10-07_Other');
  assert.ok(bindSession(root, 'sess-1', dir));
  const sessionBefore = fs.readFileSync(path.join(dir, 'SESSION.md'));

  const res = postCompact(env, 'sess-1', 'We chose the pointer approach.\nNext: wire the hooks.');
  assert.equal(res.status, 0);
  assert.deepEqual(res.json, {});

  const log = fs.readFileSync(path.join(dir, 'COMPACT-LOG.md'), 'utf8');
  assert.match(
    log,
    /^\n## Compact summary \(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\)\n\nWe chose the pointer approach\.\nNext: wire the hooks\.\n$/,
  );
  assert.ok(sessionBefore.equals(fs.readFileSync(path.join(dir, 'SESSION.md'))), 'SESSION.md is unchanged');
  assert.ok(!fs.existsSync(path.join(other, 'COMPACT-LOG.md')), 'only the bound dir is written');

  // A second compaction adds a second block after the first.
  postCompact(env, 'sess-1', 'Second summary.');
  const both = fs.readFileSync(path.join(dir, 'COMPACT-LOG.md'), 'utf8');
  assert.ok(both.startsWith(log), 'the first block is kept');
  assert.equal(both.split('## Compact summary (').length - 1, 2);
  assert.ok(both.endsWith('\n\nSecond summary.\n'));
  assert.ok(sessionBefore.equals(fs.readFileSync(path.join(dir, 'SESSION.md'))));
});

test('PostCompact stamps local time with its UTC offset', () => {
  // Zones without daylight saving, one east of UTC and one west of it.
  for (const [tz, offset] of [['Pacific/Kiritimati', '+14:00'], ['Pacific/Pago_Pago', '-11:00']]) {
    const env = hookEnv({ TZ: tz });
    const root = env.SESSION_ROOT;
    const dir = makeSessionDir(root);
    assert.ok(bindSession(root, 'sess-1', dir));

    const before = Math.floor(Date.now() / 1000) * 1000;
    postCompact(env, 'sess-1', 'Summary.');
    const after = Date.now();

    const m = /^\n## Compact summary \(([^)]+)\)\n/.exec(fs.readFileSync(path.join(dir, 'COMPACT-LOG.md'), 'utf8'));
    assert.ok(m, `${tz}: heading present`);
    assert.ok(m[1].endsWith(offset), `${tz}: stamp ${m[1]} is not local time at ${offset}`);
    const at = Date.parse(m[1]);
    assert.ok(at >= before && at <= after, `${tz}: stamp ${m[1]} is not the time of the call`);
  }
});

test('PostCompact logs into a bound dir that has no SESSION.md', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const dir = path.join(root, '2026-10-07_Plan-only');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Plan\n');
  assert.ok(bindSession(root, 'sess-1', dir));

  postCompact(env, 'sess-1', 'Summary.');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['COMPACT-LOG.md', 'PLAN.md']);
});

test('PostCompact without a dir, an id or a summary prints {} and writes nothing', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const dir = makeSessionDir(root);
  assert.ok(bindSession(root, 'sess-1', dir));
  const rootBefore = fs.readdirSync(root).sort();

  for (const [label, res] of [
    ['unbound id', postCompact(env, 'sess-2', 'Summary.')],
    ['invalid id', postCompact(env, '../escape', 'Summary.')],
    ['missing id', postCompact(env, undefined, 'Summary.')],
    ['no summary', postCompact(env, 'sess-1', undefined)],
    ['empty summary', postCompact(env, 'sess-1', '   \n')],
    ['unreadable stdin', runHook('post-compact-logger.js', 'not json', env)],
  ]) {
    assert.equal(res.status, 0, label);
    assert.deepEqual(res.json, {}, label);
  }

  assert.deepEqual(fs.readdirSync(root).sort(), rootBefore);
  assert.deepEqual(fs.readdirSync(dir), ['SESSION.md']);
});

// --- hooks.json ---------------------------------------------------------------

test('hooks.json wires the logger to PostCompact only', () => {
  const config = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8')).hooks;

  const commands = event => (config[event] || []).flatMap(group => group.hooks.map(h => h.command));
  const wiredTo = Object.keys(config).filter(event => commands(event).some(c => c.includes('post-compact-logger.js')));
  assert.deepEqual(wiredTo, ['PostCompact']);

  assert.deepEqual(config.PostCompact, [{
    matcher: '',
    hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/post-compact-logger.js"' }],
  }]);
  const events = Object.keys(config);
  assert.equal(events[events.indexOf('PreCompact') + 1], 'PostCompact', 'PostCompact follows PreCompact');

  // The router hook is still the only SessionStart entry.
  assert.deepEqual(config.SessionStart, [{
    matcher: 'startup|clear|compact',
    hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"', async: false }],
  }]);
  assert.deepEqual(commands('PreCompact'), ['node "${CLAUDE_PLUGIN_ROOT}/hooks/context-snapshot.js"']);
});
