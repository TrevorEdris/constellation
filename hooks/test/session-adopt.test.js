'use strict';
/**
 * Tests for the two ways the Stop hook gives a session a journal without
 * scaffolding a second dir: adopting a dir the agent made by hand this turn
 * (stamp its SESSION.md with the session UUID and bind the pointer), and binding
 * the session to the dir a first prompt names through a PLAN path.
 *
 * The hook runs for real as a child node process against a temp SESSION_ROOT,
 * with a transcript fixture whose tool_use blocks stand in for what the agent did.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeTmp, hookEnv, runHook } = require('./helpers');
const { sessionStartMs, stampSessionId, sessionDirFromPrompt } = require('../lib/session');

const SESSION = '4b1f6a52-9d3e-4c7a-8f21-0a5e6d7c8b90';
const OTHER_UUID = '0e8f1c22-7a4b-4d55-9b36-1c2d3e4f5a6b';
const SCAFFOLDED = /^\d{4}-\d{2}-\d{2}_Fix-login-bug$/;

const CTX_EXECUTE = 'mcp__plugin_context-mode_context-mode__ctx_execute';
const CTX_BATCH = 'mcp__plugin_context-mode_context-mode__ctx_batch_execute';

/**
 * A transcript file. Like a real one it opens with a timestamp-less
 * bridge-session line. The first prompt carries the session start, `offsetMs`
 * from now; each entry of `tools` ({name, input}) follows as an assistant
 * tool_use block.
 */
function writeTranscript({ offsetMs = -60000, prompt = 'Set up the journal', tools = [], title = 'Fix login bug' } = {}) {
  const start = new Date(Date.now() + offsetMs).toISOString();
  const entries = [
    { type: 'bridge-session' },
    { type: 'user', entrypoint: 'cli', timestamp: start, message: { role: 'user', content: prompt } },
  ];
  if (title) entries.push({ type: 'custom-title', customTitle: title });
  tools.forEach((tool, i) => entries.push({
    type: 'assistant', entrypoint: 'cli', timestamp: start,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${i}`, name: tool.name, input: tool.input }] },
  }));
  entries.push({
    type: 'assistant', entrypoint: 'cli', timestamp: start,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  });
  const file = path.join(makeTmp(), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const stop = (env, sessionId, transcriptPath) => runHook('session-bootstrap.js', {
  hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcriptPath,
}, env);

/** The root's visible (non-dot) entries. */
const visible = root => fs.readdirSync(root).filter(n => !n.startsWith('.')).sort();

const pointerOf = (root, id) => fs.readFileSync(path.join(root, '.sessions', id), 'utf8');

/** A dir under `root`; SESSION.md is written only when `sessionMd` is a string. */
function makeSessionDir(root, name, sessionMd) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (typeof sessionMd === 'string') fs.writeFileSync(path.join(dir, 'SESSION.md'), sessionMd);
  return dir;
}

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

const writeTool = dir => ({ name: 'Write', input: { file_path: path.join(dir, 'SESSION.md'), content: 'journal\n' } });

/** After a Stop that adopted nothing: one scaffolded dir, bound to the session. */
function assertScaffolded(env, label) {
  const root = env.SESSION_ROOT;
  const fresh = visible(root).filter(n => SCAFFOLDED.test(n));
  assert.equal(fresh.length, 1, `${label}: expected one scaffolded dir, got ${visible(root)}`);
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(path.join(root, fresh[0])) + '\n', `${label}: pointer`);
  return path.join(root, fresh[0]);
}

test('adopts a dir hand-created this turn', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const name = '2026-10-07_Hand-Made';
  // The fotw date-slug fallback is not a UUID, so it counts as unstamped.
  const original = '---\nschema: v1\ndate: 2026-10-07\nslug: Hand-Made\nsession_id: 2026-10-07_X\n---\n\n# Session\n\nNotes the agent wrote.\n';
  const dir = makeSessionDir(root, name, original);
  const transcript = writeTranscript({ tools: [writeTool(dir)] });

  const res = stop(env, SESSION, transcript);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json, {});
  assert.deepEqual(visible(root), [name], 'a twin dir was scaffolded');
  assert.equal(
    fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'),
    original.replace('session_id: 2026-10-07_X', `session_id: ${SESSION}`),
    'only the session_id line may change',
  );
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(dir) + '\n');

  // The next Stop finds it by pointer and changes nothing.
  const snapshot = tree(root);
  assert.deepEqual(stop(env, SESSION, transcript).json, {});
  assert.deepEqual(tree(root), snapshot);
});

test('adopts a dir created through a ctx_execute code input', () => {
  // Context-mode tools carry paths in `code` or `commands`, not `file_path`; any
  // tool input that names the dir counts, a read-only mention included.
  const cases = [
    { label: 'ctx_execute code', tool: dir => ({ name: CTX_EXECUTE, input: { language: 'shell', code: `mkdir -p ${dir} && echo '# Session' > ${dir}/SESSION.md` } }) },
    { label: 'ctx_batch_execute commands', tool: dir => ({ name: CTX_BATCH, input: { commands: [{ label: 'make dir', command: `mkdir -p ${dir}` }], queries: ['made'] } }) },
    { label: 'Bash command', tool: dir => ({ name: 'Bash', input: { command: `ls ${dir}` } }) },
  ];

  for (const { label, tool } of cases) {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    const name = '2026-10-07_Via-Tool';
    const dir = makeSessionDir(root, name, '---\nschema: v1\nslug: Via-Tool\n---\n\n# Via tool\n');

    const res = stop(env, SESSION, writeTranscript({ tools: [tool(dir)] }));

    assert.deepEqual(res.json, {}, label);
    assert.deepEqual(visible(root), [name], `${label}: a twin dir was scaffolded`);
    assert.equal(
      fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'),
      `---\nschema: v1\nslug: Via-Tool\nsession_id: ${SESSION}\n---\n\n# Via tool\n`,
      `${label}: session_id is inserted as a new frontmatter line`,
    );
    assert.equal(pointerOf(root, SESSION), fs.realpathSync(dir) + '\n', label);
  }
});

test('adopts SESSION.md without frontmatter', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  // The body has its own --- rules; none of them is frontmatter.
  const original = '# Session\n\nNotes.\n\n---\n\nMore notes.\n\n---\nend\n';
  const dir = makeSessionDir(root, '2026-10-07_Bare', original);

  assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(dir)] })).json, {});

  assert.deepEqual(visible(root), ['2026-10-07_Bare']);
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), `---\nsession_id: ${SESSION}\n---\n\n${original}`);
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(dir) + '\n');
});

test('adopts a dir with no SESSION.md by binding the pointer only', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const dir = makeSessionDir(root, '2026-10-07_No-Journal');
  fs.writeFileSync(path.join(dir, 'DISCOVERY.md'), 'findings\n');
  const before = tree(dir);

  assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(dir)] })).json, {});

  assert.deepEqual(visible(root), ['2026-10-07_No-Journal']);
  assert.deepEqual(tree(dir), before, 'the dir must not gain a SESSION.md');
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(dir) + '\n');
});

test('a dir is not stamped when its pointer cannot be written', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  // A regular file where the pointer dir belongs: no pointer can ever be written.
  fs.writeFileSync(path.join(root, '.sessions'), 'in the way\n');
  const original = '---\nschema: v1\n---\n\n# Hand made\n';
  const dir = makeSessionDir(root, '2026-10-07_Hand-Made', original);

  const res = stop(env, SESSION, writeTranscript({ tools: [writeTool(dir)] }));

  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), original, 'stamped without a pointer');
});

test('adopts the newest of several candidates', () => {
  // Created in both name orders, so neither first-by-name nor last-by-name can pass.
  for (const [older, newer] of [['2026-10-07_A', '2026-10-07_B'], ['2026-10-07_B', '2026-10-07_A']]) {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    const first = makeSessionDir(root, older, `# ${older}\n`);
    // Birthtimes tick in milliseconds or coarser; a pause keeps the order unambiguous.
    const until = Date.now() + 25;
    while (Date.now() < until) { /* wait */ }
    const second = makeSessionDir(root, newer, `# ${newer}\n`);

    assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(first), writeTool(second)] })).json, {});

    assert.deepEqual(visible(root), ['2026-10-07_A', '2026-10-07_B']);
    assert.equal(pointerOf(root, SESSION), fs.realpathSync(second) + '\n', `${newer} was created last`);
    assert.equal(fs.readFileSync(path.join(first, 'SESSION.md'), 'utf8'), `# ${older}\n`, 'the older candidate stays untouched');
  }
});

test('does not adopt a dir older than the session', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const name = '2026-10-07_Old-News';
  const original = '---\nschema: v1\n---\n\n# Old news\n';
  const dir = makeSessionDir(root, name, original);

  // The session began a minute from now, so the dir is older than it.
  const res = stop(env, SESSION, writeTranscript({ offsetMs: 60000, tools: [writeTool(dir)] }));

  assert.deepEqual(res.json, {});
  const scaffolded = assertScaffolded(env, 'older dir');
  assert.notEqual(scaffolded, dir);
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), original);
});

test("does not adopt another session's fresh dir", () => {
  const original = '---\nschema: v1\n---\n\n# Someone else\n';

  // A fresh, unstamped dir that this transcript never mentions belongs to a parallel session.
  {
    const env = hookEnv();
    const dir = makeSessionDir(env.SESSION_ROOT, '2026-10-07_Parallel', original);
    assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [] })).json, {});
    assert.notEqual(assertScaffolded(env, 'unmentioned'), dir);
    assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), original);
  }

  // Naming <d>-2 does not name <d>: the basename must end at a name boundary.
  {
    const env = hookEnv();
    const dir = makeSessionDir(env.SESSION_ROOT, '2026-10-07_Parallel', original);
    const sibling = path.join(env.SESSION_ROOT, '2026-10-07_Parallel-2');
    assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(sibling)] })).json, {});
    assert.notEqual(assertScaffolded(env, 'prefix'), dir);
    assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), original);
  }
});

test('does not adopt a dir stamped with another UUID', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const original = `---\nschema: v1\nsession_id: ${OTHER_UUID}\n---\n\n# Theirs\n`;
  const dir = makeSessionDir(root, '2026-10-07_Stamped', original);

  assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(dir)] })).json, {});

  assert.notEqual(assertScaffolded(env, 'stamped'), dir);
  assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), original, 'another session\'s id was overwritten');
});

test('does not adopt a dot-prefixed dir under the root', () => {
  // `.archive` has no SESSION.md, so it reads as unstamped; it is fresh, and a
  // tool input names it. Only the "direct, non-dot child" rule keeps it out.
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const hidden = makeSessionDir(root, '.archive');
  const before = tree(hidden);

  const res = stop(env, SESSION, writeTranscript({ tools: [writeTool(hidden)] }));

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json, {});
  const scaffolded = assertScaffolded(env, 'dot-prefixed');
  assert.notEqual(scaffolded, hidden);
  assert.notEqual(pointerOf(root, SESSION), fs.realpathSync(hidden) + '\n', 'the pointer names the dot dir');
  assert.deepEqual(tree(hidden), before, 'the dot dir was modified');
});

test('first prompt naming a PLAN binds to its session dir', () => {
  const seed = base => {
    const old = makeSessionDir(base, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
    fs.mkdirSync(path.join(old, 'slices', 'S1'), { recursive: true });
    fs.writeFileSync(path.join(old, 'slices', 'S1', 'PLAN.md'), '---\nstatus: approved\n---\n\n# Plan\n');
    return old;
  };

  // An absolute path.
  {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    const old = seed(root);
    const before = tree(old);
    const prompt = `Implement ${old}/slices/S1/PLAN.md please`;

    const res = stop(env, SESSION, writeTranscript({ prompt }));

    assert.deepEqual(res.json, {});
    assert.deepEqual(visible(root), ['2026-10-01_Old'], 'a split record: a second dir was scaffolded');
    assert.equal(pointerOf(root, SESSION), fs.realpathSync(old) + '\n');
    assert.deepEqual(tree(old), before, 'the PLAN-bound dir was modified');
  }

  // The ~/ form, expanded against HOME.
  {
    const env = hookEnv();
    env.SESSION_ROOT = path.join(env.HOME, 'sessions');
    fs.mkdirSync(env.SESSION_ROOT);
    const old = seed(env.SESSION_ROOT);
    const before = tree(old);

    const res = stop(env, SESSION, writeTranscript({ prompt: 'Implement ~/sessions/2026-10-01_Old/slices/S1/PLAN.md please' }));

    assert.deepEqual(res.json, {});
    assert.deepEqual(visible(env.SESSION_ROOT), ['2026-10-01_Old']);
    assert.equal(pointerOf(env.SESSION_ROOT, SESSION), fs.realpathSync(old) + '\n');
    assert.deepEqual(tree(old), before);
  }

  // A prompt that is quoted or followed by punctuation still names the file.
  {
    const env = hookEnv();
    const old = seed(env.SESSION_ROOT);
    assert.deepEqual(stop(env, SESSION, writeTranscript({ prompt: `Run "${old}/slices/S1/PLAN.md".` })).json, {});
    assert.deepEqual(visible(env.SESSION_ROOT), ['2026-10-01_Old']);
    assert.equal(pointerOf(env.SESSION_ROOT, SESSION), fs.realpathSync(old) + '\n');
  }
});

test('PLAN outside the root is ignored', () => {
  const cases = [
    {
      label: 'a repo file',
      prompt: ({ repo }) => `Implement ${repo}/docs/PLAN.md`,
    },
    {
      label: 'a .. escape from a session dir',
      prompt: ({ root }) => `Implement ${root}/2026-10-01_Old/../../repo/docs/PLAN.md`,
    },
    {
      label: 'a dot-prefixed dir under the root',
      prompt: ({ root }) => `Implement ${root}/.archive/slices/PLAN.md`,
      seed: ({ root }) => {
        fs.mkdirSync(path.join(root, '.archive', 'slices'), { recursive: true });
        fs.writeFileSync(path.join(root, '.archive', 'slices', 'PLAN.md'), '# Plan\n');
      },
    },
    {
      label: 'a symlink under the root that leaves it',
      prompt: ({ root }) => `Implement ${root}/linked/docs/PLAN.md`,
      seed: ({ root, repo }) => fs.symlinkSync(repo, path.join(root, 'linked')),
    },
    {
      label: 'a PLAN file that does not exist',
      prompt: ({ root }) => `Implement ${root}/2026-10-01_Old/slices/S9/PLAN.md`,
    },
    {
      label: 'a PLAN file directly in the root',
      prompt: ({ root }) => `Implement ${root}/PLAN.md`,
      seed: ({ root }) => fs.writeFileSync(path.join(root, 'PLAN.md'), '# Plan\n'),
    },
  ];

  for (const { label, prompt, seed } of cases) {
    const env = hookEnv();
    const root = env.SESSION_ROOT;
    const repo = path.join(path.dirname(root), 'repo');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'PLAN.md'), '# Plan\n');
    const old = makeSessionDir(root, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
    if (seed) seed({ root, repo });
    const repoBefore = tree(repo);
    const oldBefore = tree(old);

    const res = stop(env, SESSION, writeTranscript({ prompt: prompt({ root, repo }) }));

    assert.deepEqual(res.json, {}, label);
    const scaffolded = assertScaffolded(env, label);
    assert.notEqual(scaffolded, old, label);
    assert.deepEqual(tree(repo), repoBefore, `${label}: the repo changed`);
    assert.deepEqual(tree(old), oldBefore, `${label}: the Old dir changed`);
  }
});

test('a named PLAN wins over a hand-made dir in the same turn', () => {
  // G11 binds the PLAN's dir (step 3) before it looks for a hand-made one (step 4).
  // Swapped, the fresh dir would take the pointer and the record would split.
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const old = makeSessionDir(root, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
  fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
  const mine = makeSessionDir(root, '2026-10-07_Mine', '---\nschema: v1\n---\n\n# Mine\n');
  const oldBefore = tree(old);
  const mineBefore = tree(mine);

  const res = stop(env, SESSION, writeTranscript({ prompt: `Implement ${old}/PLAN.md`, tools: [writeTool(mine)] }));

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json, {});
  assert.deepEqual(visible(root), ['2026-10-01_Old', '2026-10-07_Mine'], 'a dir was scaffolded');
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(old) + '\n', 'the pointer is not the PLAN-bound dir');
  assert.deepEqual(tree(old), oldBefore, 'the PLAN-bound dir was modified');
  assert.deepEqual(tree(mine), mineBefore, 'the hand-made dir was stamped');
});

test('a session that already resolves is neither re-bound to a named PLAN nor adopted again', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const mine = makeSessionDir(root, '2026-10-07_Mine', `---\nschema: v1\nsession_id: ${SESSION}\n---\n\n# Mine\n`);
  const old = makeSessionDir(root, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
  fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
  const fresh = makeSessionDir(root, '2026-10-07_Fresh', '# fresh\n');
  const snapshot = tree(root);

  // Found by scan, so it is bound to Mine; the PLAN and the fresh dir change nothing else.
  const res = stop(env, SESSION, writeTranscript({ prompt: `Implement ${old}/PLAN.md`, tools: [writeTool(fresh)] }));

  assert.deepEqual(res.json, {});
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(mine) + '\n');
  const after = tree(root);
  delete after['.sessions/'];
  delete after[path.join('.sessions', SESSION)];
  assert.deepEqual(after, snapshot);
});

test('a headless run still binds a named PLAN and adopts a hand-made dir', () => {
  // G11 puts both steps ahead of the headless skip; only the scaffold is skipped.
  const headless = { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };

  {
    const env = hookEnv(headless);
    const old = makeSessionDir(env.SESSION_ROOT, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
    fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
    assert.deepEqual(stop(env, SESSION, writeTranscript({ prompt: `Implement ${old}/PLAN.md` })).json, {});
    assert.deepEqual(visible(env.SESSION_ROOT), ['2026-10-01_Old']);
    assert.equal(pointerOf(env.SESSION_ROOT, SESSION), fs.realpathSync(old) + '\n');
  }

  {
    const env = hookEnv(headless);
    const dir = makeSessionDir(env.SESSION_ROOT, '2026-10-07_Hand-Made', '# journal\n');
    assert.deepEqual(stop(env, SESSION, writeTranscript({ tools: [writeTool(dir)] })).json, {});
    assert.deepEqual(visible(env.SESSION_ROOT), ['2026-10-07_Hand-Made']);
    assert.equal(fs.readFileSync(path.join(dir, 'SESSION.md'), 'utf8'), `---\nsession_id: ${SESSION}\n---\n\n# journal\n`);
    assert.equal(pointerOf(env.SESSION_ROOT, SESSION), fs.realpathSync(dir) + '\n');
  }
});

test('sessionDirFromPrompt names the dir just below the root, or nothing', () => {
  const root = makeTmp();
  const old = makeSessionDir(root, '2026-10-01_Old');
  fs.mkdirSync(path.join(old, 'slices', 'S1'), { recursive: true });
  fs.writeFileSync(path.join(old, 'slices', 'S1', 'PLAN-extra.md'), '# Plan\n');
  fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
  fs.writeFileSync(path.join(root, 'PLAN.md'), '# Plan\n');

  // Any depth, any PLAN*.md name; the first existing file wins.
  assert.equal(sessionDirFromPrompt(root, `see ${old}/slices/S1/PLAN-extra.md`), old);
  assert.equal(sessionDirFromPrompt(root, `${root}/2026-10-01_Gone/PLAN.md then ${old}/PLAN.md`), old);
  // A file straight in the root has no session dir around it.
  assert.equal(sessionDirFromPrompt(root, `${root}/PLAN.md`), null);
  assert.equal(sessionDirFromPrompt(root, 'no path here'), null);
  assert.equal(sessionDirFromPrompt(root, ''), null);
  assert.equal(sessionDirFromPrompt(root, undefined), null);
  assert.equal(sessionDirFromPrompt(path.join(root, 'missing'), `${old}/PLAN.md`), null);
});

test('a long unbroken token in the prompt neither stalls the hook nor hides a PLAN path', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const old = makeSessionDir(root, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
  fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
  // 51 KB with no whitespace and a slash every third character: the PLAN pattern
  // alone takes several seconds on it, and it can never be a path.
  const blob = 'ab/'.repeat(17000);

  const began = Date.now();
  const res = stop(env, SESSION, writeTranscript({ prompt: `${blob} then implement ${old}/PLAN.md` }));
  const elapsed = Date.now() - began;

  assert.deepEqual(res.json, {});
  assert.ok(elapsed < 4000, `the hook took ${elapsed} ms`);
  assert.deepEqual(visible(root), ['2026-10-01_Old']);
  assert.equal(pointerOf(root, SESSION), fs.realpathSync(old) + '\n');
});

test('only the first real prompt can name a PLAN', () => {
  const env = hookEnv();
  const root = env.SESSION_ROOT;
  const old = makeSessionDir(root, '2026-10-01_Old', '---\nschema: v1\nsession_id: other-id\n---\n\n# Old\n');
  fs.writeFileSync(path.join(old, 'PLAN.md'), '# Plan\n');
  const file = path.join(makeTmp(), 'transcript.jsonl');
  const start = new Date(Date.now() - 60000).toISOString();
  const entry = (content, extra = {}) => JSON.stringify({
    type: 'user', entrypoint: 'cli', timestamp: start, message: { role: 'user', content }, ...extra,
  });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'bridge-session' }),
    entry('Fix the login bug'),
    JSON.stringify({ type: 'custom-title', customTitle: 'Fix login bug' }),
    entry(`Now implement ${old}/PLAN.md`),
  ].join('\n') + '\n');

  assert.deepEqual(stop(env, SESSION, file).json, {});

  assert.notEqual(assertScaffolded(env, 'second prompt'), old);
});

test('sessionStartMs takes the first parseable timestamp, else the file birthtime', () => {
  const dir = makeTmp();
  const lines = objs => objs.map(o => JSON.stringify(o)).join('\n') + '\n';

  const stamped = path.join(dir, 'stamped.jsonl');
  fs.writeFileSync(stamped, lines([
    { type: 'bridge-session' },
    { type: 'queue-operation', timestamp: 'not a date' },
    { type: 'user', timestamp: '2026-10-07T12:00:00.000Z' },
    { type: 'user', timestamp: '2026-10-07T12:30:00.000Z' },
  ]));
  assert.equal(sessionStartMs(stamped), Date.parse('2026-10-07T12:00:00.000Z'));

  const bare = path.join(dir, 'bare.jsonl');
  fs.writeFileSync(bare, lines([{ type: 'bridge-session' }, { type: 'user' }]));
  const fallback = sessionStartMs(bare);
  assert.ok(Math.abs(fallback - Date.now()) < 10000, `fallback ${fallback} is not the birthtime of a file just written`);

  assert.equal(sessionStartMs(path.join(dir, 'missing.jsonl')), null);
});

test('stampSessionId touches only the top-level session_id', () => {
  const dir = makeTmp();
  const file = path.join(dir, 'SESSION.md');

  // An indented session_id belongs to a nested value; the stamp goes on a new top-level line.
  const nested = '---\nschema: v1\nnotes:\n  session_id: nested\n---\n\n# Body\nsession_id: in the body\n';
  fs.writeFileSync(file, nested);
  assert.equal(stampSessionId(dir, SESSION), true);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    `---\nschema: v1\nnotes:\n  session_id: nested\nsession_id: ${SESSION}\n---\n\n# Body\nsession_id: in the body\n`,
  );

  // A trailing comment on the replaced line goes with it.
  fs.writeFileSync(file, '---\nsession_id: 2026-10-07_X # fallback\nslug: s\n---\n\n# Body\n');
  assert.equal(stampSessionId(dir, SESSION), true);
  assert.equal(fs.readFileSync(file, 'utf8'), `---\nsession_id: ${SESSION}\nslug: s\n---\n\n# Body\n`);

  // An id that is not a safe file name is refused, and nothing is written.
  fs.writeFileSync(file, '# Body\n');
  assert.equal(stampSessionId(dir, '../x'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Body\n');

  // No SESSION.md: nothing is stamped, and no file is created.
  fs.rmSync(file);
  assert.equal(stampSessionId(dir, SESSION), false);
  assert.ok(!fs.existsSync(file));
});
