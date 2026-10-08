'use strict';
// Tests for hooks/lib/merge-guard.js: merging, pulling, rebasing and pushing into the default
// branch ask, and everything that only syncs a branch with its own upstream stays quiet. Every
// test runs the real code against real temp git repos (a bare `origin`, a `work` repo on main
// with origin/HEAD set, and a linked worktree `work/.worktrees/feat` on feat/x), and the last
// group spawns the real hooks/guard.js. Corpus tables stay inline in this file: `node --test`
// runs any non-test .js under hooks/test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parse } = require('../lib/shell-words.js');
const { checkIntegration, gitState } = require('../lib/merge-guard.js');

const GUARD = path.join(__dirname, '..', 'guard.js');
const GIT_C = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

// -- Fixtures ---------------------------------------------------------------------------------------

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merge-guard-')));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME);
// Never inherits GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE or CONSTELLATION_* from the test runner.
const ENV = { PATH: process.env.PATH, HOME };
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function g(cwd, ...args) {
  return execFileSync('git', [...GIT_C, ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `<name>/work` on main (pushed, upstream set) and `<name>/work/.worktrees/feat` on feat/x. */
function makeRepo(name, { remote = true, originHead = true } = {}) {
  const root = path.join(TMP, name);
  const work = path.join(root, 'work');
  fs.mkdirSync(work, { recursive: true });
  g(work, 'init');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  g(work, 'add', 'a.txt');
  g(work, 'commit', '-m', 'init');
  if (remote) {
    g(root, 'init', '--bare', path.join(root, 'origin.git'));
    g(work, 'remote', 'add', 'origin', path.join(root, 'origin.git'));
    g(work, 'push', '-u', 'origin', 'main');
    if (originHead) g(work, 'remote', 'set-head', 'origin', 'main');
  }
  const feat = path.join(work, '.worktrees', 'feat');
  g(work, 'worktree', 'add', '-b', 'feat/x', feat);
  fs.writeFileSync(path.join(feat, 'b.txt'), 'b\n');
  g(feat, 'add', 'b.txt');
  g(feat, 'commit', '-m', 'feat');
  return { root, work, feat };
}

const R = makeRepo('r');
const NOGIT = path.join(TMP, 'elsewhere');
fs.mkdirSync(NOGIT);

/** The decision for `command` run in `cwd`, through the real parser. */
function check(command, cwd, env = ENV) {
  return checkIntegration(parse(command).segments, { cwd, sessionId: 's1', env, home: HOME });
}

function asks(command, cwd, id, env) {
  const hit = check(command, cwd, env);
  assert.ok(hit, `expected a hit for: ${command}`);
  assert.equal(hit.id, id, command);
  assert.equal(typeof hit.position, 'number', command);
  assert.equal(typeof hit.reason, 'string', command);
  assert.ok(!hit.reason.endsWith('.'), `reason has no final period: ${hit.reason}`);
  return hit;
}

function quiet(command, cwd, env) {
  assert.equal(check(command, cwd, env), null, command);
}

// -- Probing git --------------------------------------------------------------------------------------

test('gitState reports head, remotes, defaults, toplevel and commonRoot', () => {
  const main = gitState(R.work, ENV);
  assert.deepEqual(main, { head: 'main', remotes: ['origin'], defaults: ['main'], toplevel: R.work, commonRoot: R.work });
  const feat = gitState(R.feat, ENV);
  assert.equal(feat.head, 'feat/x');
  assert.equal(feat.toplevel, R.feat);
  assert.equal(feat.commonRoot, R.work);
});

test('gitState: not a repo, a missing dir, no remote and no origin/HEAD', () => {
  assert.equal(gitState(NOGIT, ENV), null);
  assert.equal(gitState(path.join(TMP, 'nope'), ENV), null);
  assert.equal(gitState('', ENV), null);
  const bare = makeRepo('state-noremote', { remote: false });
  const s = gitState(bare.work, ENV);
  assert.deepEqual([s.remotes, s.defaults], [[], ['main', 'master']]);
  const nohead = makeRepo('state-nohead', { originHead: false });
  assert.deepEqual(gitState(nohead.work, ENV).defaults, ['main', 'master']);
});

// -- merge ------------------------------------------------------------------------------------------------

test('merge: asks on the default branch, quiet elsewhere and for upstream syncs', () => {
  const hit = asks('git merge feat/x', R.work, 'merge-into-default');
  assert.ok(hit.reason.includes('feat/x') && hit.reason.includes('main'), hit.reason);
  quiet('git merge main', R.feat);
  for (const c of ['git merge origin/main', 'git merge --ff-only @{u}', 'git merge @{upstream}', 'git merge --abort', 'git merge --continue', 'git merge --quit', 'git merge']) {
    quiet(c, R.work);
  }
  asks('git merge --no-ff -m "Merge branch x" feat/x', R.work, 'merge-into-default');
  asks('git merge --squash feat/x', R.work, 'merge-into-default');
  asks('git merge origin/main feat/x', R.work, 'merge-into-default');
});

test('merge: a chain is judged against the branch and directory it will run on', () => {
  asks('git checkout main && git merge feat/x', R.feat, 'merge-into-default');
  asks('git switch main; git merge feat/x', R.feat, 'merge-into-default');
  quiet('git checkout feat/x && git merge main', R.work); // the head moved off main
  quiet('git checkout -b topic && git merge feat/x', R.work);
  quiet('git switch -c topic && git merge feat/x', R.work);
  quiet('git checkout main -- a.txt && git merge feat/x', R.feat); // restoring a file does not switch
  asks(`cd ${R.work} && git merge feat/x`, NOGIT, 'merge-into-default');
  asks(`git -C ${R.work} merge feat/x`, NOGIT, 'merge-into-default');
  quiet(`cd ${R.feat} && git merge main`, R.work);
  // A body's cd does not leak out into the rest of the command.
  asks('x=$(cd /tmp && pwd); git merge feat/x', R.work, 'merge-into-default');
  // A `-c` body starts from the directory of the command that holds it.
  asks(`cd ${R.work} && bash -c 'git merge feat/x'`, NOGIT, 'merge-into-default');
});

// -- pull ---------------------------------------------------------------------------------------------------

test('pull on the default branch', () => {
  quiet('git pull', R.work);
  quiet('git pull --rebase', R.work);
  quiet('git pull origin', R.work);
  quiet('git pull origin main', R.work);
  quiet('git pull --ff-only origin main', R.work);
  asks('git pull origin feat/x', R.work, 'merge-into-default');
  asks('git pull --no-rebase origin feat/x', R.work, 'merge-into-default');
  quiet('git pull origin feat/x', R.feat);
});

// -- rebase -------------------------------------------------------------------------------------------------

test('rebase', () => {
  asks('git rebase feat/x', R.work, 'merge-into-default');
  asks('git rebase feat/x main', R.feat, 'merge-into-default'); // B is the rebased branch
  quiet('git rebase main', R.feat);
  quiet('git rebase origin/main', R.work);
  quiet('git rebase main', R.work);
  quiet('git rebase', R.work);
  quiet('git rebase --abort', R.work);
  quiet('git rebase --continue', R.work);
  quiet('git rebase main feat/x', R.work); // rebases feat/x, not the head
  asks('git rebase --onto feat/x HEAD~2', R.work, 'merge-into-default');
});

// -- push ---------------------------------------------------------------------------------------------------

test('push', () => {
  asks('git push origin main', R.work, 'push-to-default');
  asks('git push origin HEAD:main', R.feat, 'push-to-default');
  asks('git push', R.work, 'push-to-default');
  asks('git push -u origin', R.work, 'push-to-default');
  asks('git push origin --delete main', R.feat, 'push-to-default');
  asks('git push origin :main', R.feat, 'push-to-default');
  asks('git push --all origin', R.feat, 'push-to-default');
  asks('git push --mirror origin', R.feat, 'push-to-default');
  asks('git push origin +feat/x:refs/heads/main', R.feat, 'push-to-default');
  asks('git push origin HEAD', R.work, 'push-to-default');
  asks('git push -o ci.skip origin main', R.feat, 'push-to-default');
  quiet('git push -u origin feat/x', R.feat);
  quiet('git push --tags', R.work);
  quiet('git push origin --tags', R.feat);
  quiet('git push origin HEAD', R.feat);
  quiet('git push origin --delete feat/x', R.work);
  quiet('git push', R.feat);
});

// -- remotes ------------------------------------------------------------------------------------------------

test('no remote: silent; no origin/HEAD: the fallback defaults apply', () => {
  const none = makeRepo('noremote', { remote: false });
  quiet('git merge feat/x', none.work);
  quiet('git push origin main', none.work);
  const nohead = makeRepo('nohead', { originHead: false });
  asks('git merge feat/x', nohead.work, 'merge-into-default');
  asks('git push origin main', nohead.feat, 'push-to-default');
});

test('an origin/HEAD that names another branch replaces the fallback', () => {
  const r = makeRepo('develop-default');
  g(r.work, 'branch', 'develop');
  g(r.work, 'push', 'origin', 'develop');
  g(r.work, 'remote', 'set-head', 'origin', 'develop');
  quiet('git push origin main', r.feat); // main is no longer the default
  asks('git push origin develop', r.feat, 'push-to-default');
  quiet('git merge feat/x', r.work); // main is no longer the default
});

// -- Silence --------------------------------------------------------------------------------------------------

test('silent when git cannot answer or the command is not an integration', () => {
  quiet('git merge feat/x', NOGIT);
  quiet('git merge feat/x', path.join(TMP, 'nope'));
  assert.equal(checkIntegration(parse('git merge feat/x').segments, { cwd: '', env: ENV, home: HOME }), null);
  assert.equal(checkIntegration(parse('git merge feat/x').segments, { env: ENV, home: HOME }), null);
  assert.equal(checkIntegration(parse('git merge feat/x').segments, undefined), null);
  assert.equal(checkIntegration(undefined, { cwd: R.work, env: ENV }), null);
  for (const c of ['git status', 'git log --oneline -3', 'git fetch origin', 'git commit -m "merge main"', 'echo git merge feat/x', 'ls']) quiet(c, R.work);
  quiet('git merge feat/x', R.work, { ...ENV, CONSTELLATION_GUARD: 'critical' });
  asks('git merge feat/x', R.work, 'merge-into-default', { ...ENV, CONSTELLATION_GUARD: 'high' });
});

test('the merge decision takes under a second', () => {
  const t0 = Date.now();
  asks('git merge feat/x', R.work, 'merge-into-default');
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
});

// -- Commands models wrote in a live probe --------------------------------------------------------------------

test('probe commands: -C with flags and a quoted message, push feat:main from a linked worktree, upstream sync', () => {
  const lm = `git -C ${R.work} merge --no-ff feat/x -m "Merge branch 'feat/x'" && echo "---RESULT---" && git -C ${R.work} log --oneline --graph -5`;
  asks(lm, R.feat, 'merge-into-default');
  asks('git push origin feat/x:main && echo "---verify---" && git ls-remote origin main', R.feat, 'push-to-default');
  asks('git push origin feat/x:main && echo "---" && git log origin/main --oneline -3', R.feat, 'push-to-default');
  quiet(`git fetch origin && git -C ${R.work} merge --ff-only origin/main`, R.feat);
});

// -- Through guard.js -------------------------------------------------------------------------------------------

function spawnGuard(command, { cwd = R.work, payload = {}, extraEnv = {} } = {}) {
  const logDir = path.join(TMP, 'logs');
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 's1', ...payload }),
    env: { PATH: process.env.PATH, HOME, CONSTELLATION_GUARD_LOG_DIR: logDir, SESSION_ROOT: path.join(TMP, 'sessions'), ...extraEnv },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('guard.js: merge feat/x asks with merge-into-default, also inside bash -c', () => {
  for (const c of ['git merge feat/x', "bash -c 'git merge feat/x'"]) {
    const out = spawnGuard(c);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse', c);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask', c);
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith('constellation-guard [merge-into-default] '), c);
    assert.ok(out.hookSpecificOutput.permissionDecisionReason.endsWith('Needs your approval (CONSTELLATION_GUARD=critical skips non-critical checks).'), c);
  }
  const push = spawnGuard('git push origin feat/x:main', { cwd: R.feat });
  assert.equal(push.hookSpecificOutput.permissionDecision, 'ask');
  assert.ok(push.hookSpecificOutput.permissionDecisionReason.includes('[push-to-default]'));
  assert.deepEqual(spawnGuard('git merge origin/main'), {});
  assert.deepEqual(spawnGuard('git merge feat/x', { cwd: NOGIT }), {});
});

test('guard.js: a subagent is denied, critical mode is silent', () => {
  const sub = spawnGuard('git merge feat/x', { payload: { agent_id: 'a1' } });
  assert.equal(sub.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(sub.hookSpecificOutput.permissionDecisionReason.includes('Subagents cannot ask'));
  assert.ok(sub.hookSpecificOutput.permissionDecisionReason.includes('[merge-into-default]'));
  assert.deepEqual(spawnGuard('git merge feat/x', { extraEnv: { CONSTELLATION_GUARD: 'critical' } }), {});
});
