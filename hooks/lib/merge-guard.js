'use strict';
/**
 * Merge guard: asks before a Bash command merges into, or pushes to, the repository's default
 * branch.
 *
 * Why it exists: models told "merge it to main" or "ship it" run `git merge`, `git push origin
 * feat/x:main` and the like on their own, and nothing in the command text says that the branch
 * they are on (or the branch they push to) is the one everyone else builds on. Skill prose does
 * not stop that, so this hook asks the user first. Deciding needs facts that are not in the text:
 * which branch is checked out, which remotes exist and which branch is the default. They come
 * from git itself, so the rule only runs for the four subcommands that can move a default branch.
 *
 *   checkIntegration(segments, {cwd, sessionId, env, home}) -> null | {id, position, reason}
 *
 * `segments` are the parsed segments of one Bash command (hooks/lib/shell-words.js). The result
 * is an ask-tier hit that guard.js joins to its own hits; `reason` is a clause with no final
 * period. Two ids:
 *
 *   merge-into-default  `merge`, `pull` and `rebase`, when the branch that ends up changed is a
 *                       default branch and the commits come from somewhere other than its own
 *                       upstream.
 *   push-to-default     `push`, when a destination is a default branch, when `--all` or
 *                       `--mirror` would send every branch, or when a bare `git push` runs on a
 *                       default branch.
 *
 * A default branch is the one `refs/remotes/<origin or first remote>/HEAD` names, else `main` or
 * `master`. A repo with no remote has nothing shared to protect, so both ids stay silent there.
 *
 * Segments of a chain (`cd D && git checkout main && git merge x`) are read in order, carrying the
 * working directory and the branch a `git checkout|switch` names, so the merge is judged against
 * the branch it will run on. A subshell, `$( )` or `sh -c` body starts from the state of the
 * command that holds it and its changes do not leak back out.
 *
 * Anything git cannot answer (no cwd, not a repo, git missing, a probe past its timeout) means
 * silent: this is a safety net for ordinary work, so it fails open. It also stays silent under
 * CONSTELLATION_GUARD=critical, which keeps deny-tier hits only.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commandOf, gitCmd } = require('./shell-words.js');

const GIT_TIMEOUT_MS = 1500;
const INTEGRATION_SUBS = new Set(['merge', 'pull', 'rebase', 'push']);
// Options that end or inspect an operation in progress; they merge nothing new.
const STOP_FLAGS = ['--abort', '--continue', '--quit', '--skip', '--edit-todo', '--show-current-patch'];
const FALLBACK_DEFAULTS = ['main', 'master'];
// Variables that would point git somewhere other than the directory it is asked about.
const GIT_SCRUB = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'];
// Options that create the branch they name when given to checkout or switch.
const CREATE_OPTIONS = new Set(['-b', '-B', '-c', '-C', '--orphan', '--create', '--force-create']);

// -- Option tables ----------------------------------------------------------------------------------
// `short` lists the letters whose value is the next word (or the rest of the cluster); `long` the
// names whose value is the next word (any `--name=value` form carries its own).

const MERGE = { short: 'mFsX', long: new Set(['--message', '--file', '--strategy', '--strategy-option', '--into-name', '--cleanup']) };
const PULL = {
  short: 'sXjo',
  long: new Set(['--strategy', '--strategy-option', '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '--jobs',
    '--upload-pack', '--server-option', '--refmap', '--negotiation-tip', '--cleanup']),
};
const REBASE = { short: 'sXx', long: new Set(['--onto', '--exec', '--strategy', '--strategy-option']) };
const PUSH = { short: 'o', long: new Set(['--push-option', '--repo', '--receive-pack', '--exec']) };

/** Split a git subcommand's arguments into operands, the options seen, and the values of valued long options. */
function readArgs(args, spec) {
  const operands = [];
  const flags = new Set();
  const values = new Map();
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (ended || w.length < 2 || w[0] !== '-') {
      operands.push(w);
    } else if (w === '--') {
      ended = true;
    } else if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq === -1 ? w : w.slice(0, eq);
      flags.add(name);
      if (eq !== -1) values.set(name, w.slice(eq + 1));
      else if (spec.long.has(name) && i + 1 < args.length) values.set(name, args[++i]);
    } else {
      for (let j = 1; j < w.length; j++) {
        flags.add(`-${w[j]}`);
        if (spec.short.includes(w[j])) {
          if (j === w.length - 1) i++; // the value is the next word; otherwise it is the rest of this one
          break;
        }
      }
    }
  }
  return { operands, flags, values };
}

// -- Reading git ---------------------------------------------------------------------------------------

/** Run `git -C dir ...args`; the trimmed-nothing stdout, or null on any failure (not a repo, timeout, no git). */
function git(dir, args, env) {
  const childEnv = { ...(env || process.env) };
  for (const k of GIT_SCRUB) delete childEnv[k];
  // A caller-supplied env without PATH would not find git; the hook's own PATH is the best guess.
  if (childEnv.PATH === undefined && process.env.PATH !== undefined) childEnv.PATH = process.env.PATH;
  try {
    return execFileSync('git', ['-C', dir, ...args], { timeout: GIT_TIMEOUT_MS, env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function probe(dir, env) {
  const top = git(dir, ['rev-parse', '--show-toplevel', '--git-common-dir'], env);
  if (top === null) return null;
  const [toplevelRaw, commonRaw] = top.split('\n');
  if (!toplevelRaw || !commonRaw) return null;
  const toplevel = real(toplevelRaw);
  const commonDir = real(path.resolve(dir, commonRaw));
  const commonRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;

  const headOut = git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], env);
  const head = headOut === null || headOut.trim() === '' ? null : headOut.trim(); // null: detached

  const remoteOut = git(dir, ['remote'], env);
  const remotes = remoteOut === null ? [] : remoteOut.split('\n').map((r) => r.trim()).filter(Boolean);

  let defaults = FALLBACK_DEFAULTS;
  if (remotes.length > 0) {
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    const prefix = `refs/remotes/${remote}/`;
    const ref = git(dir, ['symbolic-ref', '-q', `${prefix}HEAD`], env);
    if (ref !== null && ref.trim().startsWith(prefix) && ref.trim().length > prefix.length) defaults = [ref.trim().slice(prefix.length)];
  }
  return { head, remotes, defaults: [...defaults], toplevel, commonRoot };
}

/**
 * What git says about the repository around `dir`: `{head, remotes, defaults, toplevel,
 * commonRoot}` (`head` is null when detached; `commonRoot` is the main worktree's root, which
 * differs from `toplevel` in a linked worktree), or null when `dir` is not in a work tree or git
 * fails. Answers are kept in `cache` (a Map the caller owns) so a chain asks once per directory.
 */
function gitState(dir, env, cache = new Map()) {
  if (typeof dir !== 'string' || dir === '') return null;
  if (!cache.has(dir)) cache.set(dir, probe(dir, env));
  return cache.get(dir);
}

function branchExists(dir, branch, state, env) {
  if (git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], env) !== null) return true;
  return state.remotes.some((r) => git(dir, ['show-ref', '--verify', '--quiet', `refs/remotes/${r}/${branch}`], env) !== null);
}

// -- Names ------------------------------------------------------------------------------------------------

function branchName(ref) {
  const s = ref.startsWith('+') ? ref.slice(1) : ref;
  return s.startsWith('refs/heads/') ? s.slice('refs/heads/'.length) : s;
}

/** Is `ref` the branch's own upstream: `@{u}`, `@{upstream}` or `<remote>/<default>`? */
function isUpstream(ref, st) {
  if (/^[^@\s]*@\{(?:u|upstream)\}$/.test(ref)) return true;
  const r = ref.startsWith('refs/remotes/') ? ref.slice('refs/remotes/'.length) : ref;
  return st.remotes.some((remote) => st.defaults.some((d) => r === `${remote}/${d}`));
}

function show(words) {
  const s = words.join(' ');
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

// -- The rules --------------------------------------------------------------------------------------------

/** merge, pull and rebase: the reason text when the default branch would take in outside commits, else null. */
function integrateReason(sub, args, head, st) {
  const onDefault = head !== null && st.defaults.includes(head);
  if (sub === 'rebase') {
    const { operands, flags, values } = readArgs(args, REBASE);
    if (STOP_FLAGS.some((f) => flags.has(f))) return null;
    const base = values.has('--onto') ? values.get('--onto') : operands[0];
    if (base === undefined) return null; // `git rebase` onto its own upstream
    const branch = operands[1] !== undefined ? branchName(operands[1]) : head;
    if (branch === null || !st.defaults.includes(branch)) return null;
    if (isUpstream(base, st) || st.defaults.includes(branchName(base))) return null;
    return `rebasing the default branch ${branch} onto ${base}`;
  }
  if (!onDefault) return null;
  const { operands, flags } = readArgs(args, sub === 'merge' ? MERGE : PULL);
  if (STOP_FLAGS.some((f) => flags.has(f))) return null;
  if (sub === 'merge') {
    const outside = operands.filter((x) => !isUpstream(x, st));
    return outside.length > 0 ? `merging ${show(outside)} into the default branch ${head}` : null;
  }
  // pull: operands are the remote, then the refspecs to fetch; a bare `git pull` takes the upstream.
  const outside = operands.slice(1).map((x) => branchName(x).split(':')[0]).filter((x) => !st.defaults.includes(x));
  return outside.length > 0 ? `pulling ${show(outside)} into the default branch ${head}` : null;
}

/** push: the reason text when a destination is a default branch, else null. */
function pushReason(args, head, st) {
  const { operands, flags } = readArgs(args, PUSH);
  if (flags.has('--all') || flags.has('--mirror')) {
    return `pushing with ${flags.has('--all') ? '--all' : '--mirror'} sends the default branch along with every other`;
  }
  const refspecs = operands.slice(1);
  const del = flags.has('--delete') || flags.has('-d');
  for (const spec of refspecs) {
    const s = spec.startsWith('+') ? spec.slice(1) : spec;
    const dst = branchName(s.slice(s.lastIndexOf(':') + 1));
    const target = dst === 'HEAD' ? head : dst;
    if (target !== null && st.defaults.includes(target)) {
      return del ? `deleting the default branch ${target} on the remote` : `pushing to the default branch ${target}`;
    }
  }
  if (refspecs.length === 0 && !flags.has('--tags') && head !== null && st.defaults.includes(head)) {
    return `pushing the default branch ${head}`;
  }
  return null;
}

// -- Following a chain ----------------------------------------------------------------------------------

/** Expand `~` and `$HOME` in a directory word and join it to `cur`; null when it cannot be known. */
function resolveDir(cur, next, home) {
  if (next === '') return cur;
  let p = next;
  const m = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/.exec(p);
  if (m !== null) {
    if (typeof home !== 'string' || home === '') return null;
    p = home + p.slice(m[0].length);
  }
  if (p === '-' || /[$`*?[{]/.test(p)) return null;
  if (path.isAbsolute(p)) return path.resolve(p);
  return cur === null ? null : path.resolve(cur, p);
}

function cdTarget(cur, args, home) {
  const operands = args.filter((a) => !(a.length > 1 && a[0] === '-'));
  if (operands.length === 0) return typeof home === 'string' && home !== '' ? path.resolve(home) : null;
  return resolveDir(cur, operands[0], home);
}

/** The branch a `git checkout|switch` ends on, as `{branch, created}`, or null when it names none. */
function checkoutTarget(args) {
  const dashDash = args.indexOf('--');
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w === '--') return null;
    if (CREATE_OPTIONS.has(w)) return i + 1 < args.length ? { branch: args[i + 1], created: true } : null;
    if (w.length > 1 && w[0] === '-') continue;
    return dashDash === -1 ? { branch: w, created: false } : null; // `checkout <tree> -- paths` switches nothing
  }
  return null;
}

function cloneState(s) {
  return { dir: s.dir, heads: new Map(s.heads) };
}

/**
 * Judge one git segment (and record a checkout) against the chain state `s`. Returns a hit or null.
 */
function step(seg, g, s, ctx) {
  const dir = resolveDir(s.dir, g.dir, ctx.home);
  if (dir === null) return null;
  const sub = g.sub;
  if (sub === 'checkout' || sub === 'switch') {
    const t = checkoutTarget(g.args);
    const st = t === null ? null : gitState(dir, ctx.env, ctx.cache);
    if (st !== null && (t.created || st.defaults.includes(t.branch) || branchExists(dir, t.branch, st, ctx.env))) s.heads.set(st.toplevel, t.branch);
    return null;
  }
  if (!INTEGRATION_SUBS.has(sub)) return null;
  const st = gitState(dir, ctx.env, ctx.cache);
  if (st === null || st.remotes.length === 0) return null;
  const head = s.heads.has(st.toplevel) ? s.heads.get(st.toplevel) : st.head;
  if (sub === 'push') {
    const reason = pushReason(g.args, head, st);
    return reason === null ? null : { id: 'push-to-default', position: seg.position, reason };
  }
  const reason = integrateReason(sub, g.args, head, st);
  return reason === null ? null : { id: 'merge-into-default', position: seg.position, reason };
}

function integration(segments, opts) {
  const { cwd, home } = opts;
  const env = opts.env || process.env;
  if (!Array.isArray(segments) || typeof cwd !== 'string' || cwd === '') return null;
  if (env.CONSTELLATION_GUARD === 'critical') return null;

  const reads = segments.map((seg) => {
    const { cmd, args } = commandOf(seg.words);
    return { cmd, args, g: cmd === 'git' ? gitCmd(args) : null };
  });
  if (!reads.some((r) => r.g !== null && INTEGRATION_SUBS.has(r.g.sub))) return null;

  const ctx = { env, home, cache: new Map() };
  const initial = { dir: path.resolve(cwd), heads: new Map() };
  const bodies = new Map([[-1, cloneState(initial)]]); // chain state per body, keyed by the parent segment's position
  const after = new Map(); // chain state each segment left behind, which its child bodies start from
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const { cmd, args, g } = reads[i];
    const key = typeof seg.parent === 'number' ? seg.parent : -1;
    if (!bodies.has(key)) bodies.set(key, cloneState(after.get(key) || initial));
    const s = bodies.get(key);
    let hit = null;
    if (cmd === 'cd' || cmd === 'pushd') s.dir = cdTarget(s.dir, args, home);
    else if (g !== null) hit = step(seg, g, s, ctx);
    if (hit !== null) return hit;
    after.set(seg.position, cloneState(s));
  }
  return null;
}

/**
 * See the header. Never throws: whatever goes wrong, the answer is "no opinion" (null).
 * `sessionId` is accepted for callers that can name the session; the rules here do not use it.
 */
function checkIntegration(segments, opts) {
  try {
    return integration(segments, opts || {});
  } catch {
    return null;
  }
}

module.exports = { checkIntegration, gitState };
