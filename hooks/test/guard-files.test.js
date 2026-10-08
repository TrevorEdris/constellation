'use strict';
// Tests for the file-tool half of hooks/guard.js: Read, Edit, MultiEdit, Write and NotebookEdit
// are classified by the path they name, Grep by its `path` and `glob` (never its `pattern`), and
// every other tool is ignored. All answers carry the rule id `file-secret`. The file also checks
// that hooks.json now has the single guard entry and that the spawned hook answers for Grep.
//
// Every test drives the real decide() (env passed explicitly) or the real process. Corpus tables
// stay inline in this file: `node --test` runs any non-test .js under hooks/test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decide } = require('../guard.js');

const GUARD = path.join(__dirname, '..', 'guard.js');
const HOOKS_DIR = path.join(__dirname, '..');
const HOME = '/h';

function run(tool_name, tool_input, { env = {}, payload = {} } = {}) {
  return decide({ tool_name, tool_input, cwd: '/p', session_id: 's1', ...payload }, { env, home: HOME });
}

const ASK_TAIL = '. Needs your approval (CONSTELLATION_GUARD=critical skips non-critical checks).';

test('Read: secrets ask or deny by tier, templates and public keys pass', () => {
  const ask = (p, pathId) => {
    const d = run('Read', { file_path: p });
    assert.equal(d?.decision, 'ask', p);
    assert.equal(d.id, 'file-secret', p);
    assert.equal(d.pathId, pathId, p);
    assert.ok(d.reason.startsWith('constellation-guard [file-secret] reading '), d.reason);
    assert.ok(d.reason.includes(p) && d.reason.endsWith(ASK_TAIL), d.reason);
  };
  ask('/h/.env', 'env-file');
  ask('/h/.kube/config', 'kube-config');

  for (const [p, pathId] of [['/h/.ssh/id_ed25519', 'ssh-private-key'], ['/h/.aws/credentials', 'aws-credentials']]) {
    const d = run('Read', { file_path: p });
    assert.equal(d?.decision, 'deny', p);
    assert.equal(d.id, 'file-secret', p);
    assert.equal(d.pathId, pathId, p);
    assert.ok(d.reason.startsWith('constellation-guard [file-secret] blocked: reading '), d.reason);
    assert.ok(d.reason.includes('cannot be approved from a prompt'), d.reason);
  }

  for (const p of ['/h/.env.example', '/h/.env.sh', '/h/.ssh/id_ed25519.pub', '/p/src/index.ts', '/p/README.md']) {
    assert.equal(run('Read', { file_path: p }), null, p);
  }
});

test('Read: ~ and $HOME forms are expanded', () => {
  assert.equal(run('Read', { file_path: '~/.ssh/id_rsa' })?.decision, 'deny');
  assert.equal(run('Read', { file_path: '$HOME/.aws/credentials' })?.decision, 'deny');
  assert.equal(run('Read', { file_path: '~/.env.sh' }), null);
});

test('Edit, MultiEdit, Write and NotebookEdit ask on a secret path', () => {
  const rows = [
    ['Edit', { file_path: '/p/.env.local' }, 'env-file', 'editing'],
    ['MultiEdit', { file_path: '/p/.env' }, 'env-file', 'editing'],
    ['Write', { file_path: '/p/test/fixtures/fake.key' }, 'private-key-file', 'writing'],
    ['NotebookEdit', { notebook_path: '/p/.env' }, 'env-file', 'editing'],
  ];
  for (const [tool, input, pathId, verb] of rows) {
    const d = run(tool, input);
    assert.equal(d?.decision, 'ask', tool);
    assert.equal(d.id, 'file-secret', tool);
    assert.equal(d.pathId, pathId, tool);
    assert.ok(d.reason.startsWith(`constellation-guard [file-secret] ${verb} `), d.reason);
  }
  // A deny-tier path stays a deny for a write as well as a read.
  assert.equal(run('Write', { file_path: '/h/.aws/credentials' })?.decision, 'deny');
  assert.equal(run('Edit', { file_path: '/h/.ssh/id_rsa' })?.decision, 'deny');
  // Ordinary files and templates pass.
  for (const [tool, input] of [
    ['Edit', { file_path: '/p/src/a.ts' }], ['MultiEdit', { file_path: '/p/.env.example' }],
    ['Write', { file_path: '/p/.env.sh' }], ['NotebookEdit', { notebook_path: '/p/nb.ipynb' }],
  ]) {
    assert.equal(run(tool, input), null, tool);
  }
});

test('the path comes from file_path, then notebook_path, then path', () => {
  assert.equal(run('Read', { file_path: '/p/ok.txt', notebook_path: '/p/.env' }), null);
  assert.equal(run('Read', { notebook_path: '/p/.env', path: '/p/ok.txt' })?.pathId, 'env-file');
  assert.equal(run('Read', { path: '/p/.env' })?.pathId, 'env-file');
  assert.equal(run('Read', {}), null);
});

test('Grep: path and glob are classified, pattern never is', () => {
  const asks = [
    { path: '/p/.env', output_mode: 'content' },
    { path: '/p', glob: '.env*' },
    { path: '/p', glob: '.env.*' },
    { glob: '**/*.pem' },
    { pattern: '.', path: '/h/.ssh', output_mode: 'content' },
  ];
  for (const input of asks) {
    const d = run('Grep', input);
    assert.equal(d?.decision, 'ask', JSON.stringify(input));
    assert.equal(d.id, 'file-secret', JSON.stringify(input));
    assert.ok(d.reason.startsWith('constellation-guard [file-secret] searching '), d.reason);
  }
  assert.equal(run('Grep', { path: '/p', glob: '.env*' }).pathId, 'env-file');
  assert.equal(run('Grep', { glob: '**/*.pem' }).pathId, 'private-key-file');
  assert.equal(run('Grep', { pattern: '.', path: '/h/.ssh' }).pathId, 'secret-dir');

  for (const input of [{ path: '/p/src', glob: '*.ts' }, { glob: '*.ts' }, { pattern: 'API_KEY' }, { pattern: 'id_rsa', path: '/p/src' }, {}]) {
    assert.equal(run('Grep', input), null, JSON.stringify(input));
  }
  // A deny-tier path beats an ask-tier glob.
  assert.equal(run('Grep', { path: '/h/.ssh/id_rsa', glob: '.env*' })?.decision, 'deny');
  assert.equal(run('Grep', { path: '/p/.env', glob: '**/id_rsa' })?.decision, 'deny');
});

test('Glob, MCP tools and odd payloads return null', () => {
  assert.equal(run('Glob', { pattern: '.env' }), null);
  assert.equal(run('Glob', { pattern: '**/*.pem', path: '/h/.ssh' }), null);
  assert.equal(run('mcp__x__read', { file_path: '/h/.env' }), null);
  assert.equal(run('Read', null), null);
  assert.equal(run('Read', { file_path: 42 }), null);
  assert.equal(run('Grep', { path: ['/p/.env'], glob: 7 }), null);
  assert.equal(decide({ tool_name: 'Read' }, { env: {}, home: HOME }), null);
});

test('the non-interactive and env switches apply to file tools', () => {
  const sub = run('Read', { file_path: '/p/.env' }, { payload: { agent_id: 'a1' } });
  assert.equal(sub?.decision, 'deny');
  assert.equal(sub.id, 'file-secret');
  assert.ok(sub.reason.includes('Subagents cannot ask'), sub.reason);

  const headless = run('Read', { file_path: '/p/.env' }, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } });
  assert.equal(headless?.decision, 'deny');
  assert.ok(headless.reason.includes('Headless runs cannot ask'), headless.reason);

  const sdk = run('Read', { file_path: '/p/.env' }, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } });
  assert.equal(sdk?.decision, 'ask');

  const fallback = run('Grep', { path: '/p/.env' }, { env: { CONSTELLATION_GUARD_ASK: 'deny' } });
  assert.equal(fallback?.decision, 'deny');
  assert.ok(fallback.reason.includes('CONSTELLATION_GUARD_ASK=deny'), fallback.reason);

  // critical keeps only the deny tier.
  const critical = { CONSTELLATION_GUARD: 'critical' };
  assert.equal(run('Read', { file_path: '/p/.env' }, { env: critical }), null);
  assert.equal(run('Grep', { path: '/h/.ssh' }, { env: critical }), null);
  assert.equal(run('Read', { file_path: '/h/.ssh/id_rsa' }, { env: critical })?.decision, 'deny');
  assert.equal(run('Grep', { path: '/p', glob: 'id_rsa' }, { env: critical })?.decision, 'deny');
});

test('single guard entry', () => {
  const text = fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8');
  const entries = JSON.parse(text).hooks.PreToolUse;
  assert.equal(entries.length, 1);
  assert.deepEqual(new Set(entries[0].matcher.split('|')), new Set(['Bash', 'Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Grep']));
  assert.deepEqual(entries[0].hooks.map((h) => h.command), ['node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.js"']);
  assert.ok(!text.includes('protect-secrets.js'));
  assert.ok(!fs.existsSync(path.join(HOOKS_DIR, 'protect-secrets.js')));
});

// -- The spawned hook ---------------------------------------------------------------------------

// Run `node hooks/guard.js` the way Claude Code does. The child gets an explicit env: a temp HOME,
// log dir and session root, and none of the switches under test.
function spawnGuard(payload) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-files-e2e-')));
  const logDir = path.join(root, 'logs');
  try {
    fs.mkdirSync(path.join(root, 'home'));
    const r = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({ cwd: root, session_id: 'sess-1', permission_mode: 'default', ...payload(root) }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: path.join(root, 'home'), CONSTELLATION_GUARD_LOG_DIR: logDir, SESSION_ROOT: path.join(root, 'sessions') },
      timeout: 20000,
    });
    const logs = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    const lines = logs.flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines, root };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('e2e Grep: the spawned guard asks for a secret path and logs it', () => {
  const r = spawnGuard((root) => ({ tool_name: 'Grep', tool_input: { path: path.join(root, '.env') } }));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'ask');
  assert.ok(out.permissionDecisionReason.startsWith('constellation-guard [file-secret] searching '), out.permissionDecisionReason);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].decision, 'ask');
  assert.equal(r.lines[0].id, 'file-secret');
  assert.equal(r.lines[0].pathId, 'env-file');
  assert.equal(r.lines[0].tool, 'Grep');
  assert.equal(r.lines[0].target, path.join(r.root, '.env'));
});

test('e2e: a Read of a private key denies, an ordinary Read and a Glob print {}', () => {
  const deny = spawnGuard((root) => ({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'home', '.ssh', 'id_ed25519') } }));
  assert.equal(deny.status, 0, deny.stderr);
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(deny.lines[0].pathId, 'ssh-private-key');
  assert.equal(deny.lines[0].tool, 'Read');

  for (const p of [(root) => ({ tool_name: 'Read', tool_input: { file_path: path.join(root, 'a.txt') } }), () => ({ tool_name: 'Glob', tool_input: { pattern: '.env' } })]) {
    const r = spawnGuard(p);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {});
    assert.deepEqual(r.lines, []);
  }
});
