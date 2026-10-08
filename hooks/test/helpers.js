'use strict';
/**
 * Shared fixtures for the hook tests. Defines no tests, so a bare `node --test`
 * that loads this file is a no-op.
 *
 * Every temp dir lives under the realpath of the OS temp dir, so a path a hook
 * resolves with realpath compares equal to the one the test created.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.resolve(__dirname, '..');

// Vars that decide how a hook behaves; a developer's own session must not leak in.
const SCRUBBED = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CONSTELLATION_SCAFFOLD',
  'CLAUDE_PLUGIN_ROOT',
  'CURSOR_PLUGIN_ROOT',
];

const created = [];
process.on('exit', () => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A fresh empty dir under the realpath of the OS temp dir; removed at process exit. */
function makeTmp(prefix = 'constellation-test-') {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  created.push(dir);
  return dir;
}

function assertUnderTmp(dir) {
  const tmp = fs.realpathSync(os.tmpdir());
  if (!dir.startsWith(tmp + path.sep)) throw new Error(`${dir} is not under ${tmp}`);
}

/**
 * Env for a spawned hook: the current env minus the session/plugin vars, with
 * SESSION_ROOT and HOME pointing at a fresh temp dir. `extra` wins over all of
 * it; an `undefined` value deletes the key.
 */
function hookEnv(extra = {}) {
  const base = makeTmp('constellation-hook-');
  const env = { ...process.env };
  for (const key of SCRUBBED) delete env[key];
  env.HOME = path.join(base, 'home');
  env.SESSION_ROOT = path.join(base, 'sessions');
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.SESSION_ROOT, { recursive: true });
  assertUnderTmp(env.HOME);
  assertUnderTmp(env.SESSION_ROOT);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Runs hooks/<name> as a real child process with `payload` as its JSON stdin. */
function runHook(name, payload, env) {
  const res = spawnSync(process.execPath, [path.join(HOOKS_DIR, name)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env,
    encoding: 'utf8',
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* left null; the test asserts on stdout */ }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

module.exports = { HOOKS_DIR, makeTmp, hookEnv, runHook };
