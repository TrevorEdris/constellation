#!/usr/bin/env node
'use strict';
/**
 * constellation-guard: one PreToolUse hook that decides whether a tool call needs the user.
 *
 * Why it exists: the two older guards matched regexes against the raw command text, so a name
 * inside a commit message looked like a command and a command hidden behind `( )`, `$( )` or
 * `for ...; do ...; done` looked like text. They also always denied, so a harmless `source
 * ~/.env.sh` was blocked and nobody could approve it. This guard reads the command with
 * hooks/lib/shell-words.js (words, not text) and answers in two tiers:
 *
 *   deny  never approved from a prompt: rm of /, home or a system dir, a write or format of a
 *         disk, the fork bomb, and reading a private key or the AWS credentials file.
 *   ask   the user is prompted once: everything else the rules find, including secret files,
 *         and any command the parser could not fully read.
 *
 * It never answers `allow` (that would skip the user's own prompts) and never `defer`. When
 * nothing is found it prints `{}`, so the normal permission flow runs.
 *
 *   decide(payload, {env, home}) -> null | {decision, id, pathId?, reason}
 *
 * Hits from every segment and rule are collected and the winner is chosen by: deny over ask,
 * then the lowest segment `position`, then the order of the RULES table. A rule is
 * `{id, tier, test(seg, ctx)}`; `test` returns null for no hit, or `{reason, pathId?, tier?}`
 * (a tier returned by the rule, such as the one the path classifier picks, overrides the
 * table's). `reason` is a short clause with no final period: the templates below add the rest.
 * Put a rule that names a specific action above `read-secret`, which is the last secret rule.
 *
 * Switches, all read from `env` on every call (never cached):
 *   CONSTELLATION_GUARD=critical   keep only deny-tier hits; any other value runs every rule.
 *   CONSTELLATION_GUARD_ASK=deny   an ask becomes a deny that tells the user how to proceed.
 *   CONSTELLATION_GUARD_LOG_DIR    where decisions are logged (default ~/.claude/hooks-logs).
 *
 * An ask becomes a deny when nobody can answer it: the payload has an `agent_id` (a subagent;
 * its prompts go to the main session) or CLAUDE_CODE_ENTRYPOINT is exactly `sdk-cli` (`claude
 * -p`). SDK apps can answer through a permission callback and keep asking.
 *
 * Two safety nets cover what the parser does not model, so that a missed construct costs a
 * prompt and never a silent pass: a segment whose command word is not a plain program name
 * asks (`unrecognized-command-word`; `[`, `[[` and `:` run no program and count as plain), and
 * so does any command the parser reports as unparsed (`unparsed-command`: too long, nested too
 * deep, `env -S`, an option it cannot place). A deny found in the part that was read still wins.
 *
 * The hook fails open: any exception is logged as ERROR and the output is `{}`. It always
 * exits 0. This module handles Bash only for now; other tools return null.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, commandOf } = require('./lib/shell-words.js');

const posix = path.posix;

// -- Reason text ---------------------------------------------------------------------------------

const ASK_TAIL = '. Needs your approval (CONSTELLATION_GUARD=critical skips non-critical checks).';
const DENY_TAIL = '. This cannot be approved from a prompt; do not rephrase or split the command to get past it.';
const SUBAGENT_TAIL = '. Subagents cannot ask, so this was denied; report the exact command to your controller instead of working around it.';
const HEADLESS_TAIL = '. Headless runs cannot ask, so this was denied; report the exact command instead of working around it.';
const FALLBACK_TAIL = '. Denied because CONSTELLATION_GUARD_ASK=deny; ask the user to run it, or to restart with CONSTELLATION_GUARD=critical to skip non-critical checks.';

/** A word as it appears inside a reason: control characters become spaces, long words are cut. */
function shown(w) {
  const s = String(w).replace(/[\x00-\x1f]/g, ' ');
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

// -- Paths ---------------------------------------------------------------------------------------

/** Replace a leading `~`, `$HOME` or `${HOME}` with `home`. Without a home the path is unchanged. */
function expandHome(p, home) {
  if (!home) return p;
  if (p === '~' || p.startsWith('~/')) return home + p.slice(1);
  const m = /^\$(?:HOME|\{HOME\})(?=\/|$)/.exec(p);
  return m ? home + p.slice(m[0].length) : p;
}

/** Expand the home forms, collapse `.`, `..` and `//`, and drop one trailing `/` (not from `/`). */
function tidy(p, home) {
  if (p === '') return '';
  const t = posix.normalize(expandHome(p, home));
  return t.length > 1 && t.endsWith('/') ? t.slice(0, -1) : t;
}

// Sibling templates and examples of an env file are not secrets.
const ENV_TEMPLATE = new Set(['example', 'sample', 'template', 'schema', 'defaults', 'dist', 'sh', 'md']);

// Paths that name a secret, deny tier first. Each test gets the whole path and its basename.
// The ported entries are the ones protect-secrets.js already had, under the ids the logs use.
const SECRET_PATHS = [
  {
    pathId: 'ssh-private-key',
    tier: 'deny',
    test: (p, b) => /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(b) || (/(^|\/)\.ssh\/id_[^/]*$/.test(p) && !p.endsWith('.pub')),
  },
  { pathId: 'aws-credentials', tier: 'deny', test: (p) => /(^|\/)\.aws\/credentials$/.test(p) },
  {
    pathId: 'env-file',
    tier: 'ask',
    test: (p, b) => {
      const m = /^\.env(?:\.([^/]+))?$/.exec(b);
      return m !== null && !(m[1] !== undefined && ENV_TEMPLATE.has(m[1].split('.').pop()));
    },
  },
  { pathId: 'private-key-file', tier: 'ask', test: (p) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(p) },
  { pathId: 'secrets-file', tier: 'ask', test: (p, b) => /^(secrets?|credentials?)\.(json|ya?ml|toml)$/i.test(b) },
  // The directory itself, for Grep and for readers that recurse.
  { pathId: 'secret-dir', tier: 'ask', test: (p) => /(^|\/)\.(ssh|aws)\/?\*?$/.test(p) },
  { pathId: 'envrc', tier: 'ask', test: (p) => /(^|\/)\.envrc$/.test(p) },
  { pathId: 'ssh-authorized-keys', tier: 'ask', test: (p) => /(^|\/)\.ssh\/authorized_keys$/.test(p) },
  { pathId: 'aws-config', tier: 'ask', test: (p) => /(^|\/)\.aws\/config$/.test(p) },
  { pathId: 'kube-config', tier: 'ask', test: (p) => /(^|\/)\.kube\/config$/.test(p) },
  { pathId: 'service-account', tier: 'ask', test: (p) => /service[_-]?account.*\.json$/i.test(p) },
  { pathId: 'gcloud-creds', tier: 'ask', test: (p) => /(^|\/)\.config\/gcloud\/.*(credentials|tokens)/i.test(p) },
  { pathId: 'azure-creds', tier: 'ask', test: (p) => /(^|\/)\.azure\/(credentials|accessTokens)/i.test(p) },
  { pathId: 'docker-config', tier: 'ask', test: (p) => /(^|\/)\.docker\/config\.json$/.test(p) },
  { pathId: 'netrc', tier: 'ask', test: (p) => /(^|\/)\.netrc$/.test(p) },
  { pathId: 'npmrc', tier: 'ask', test: (p) => /(^|\/)\.npmrc$/.test(p) },
  { pathId: 'pypirc', tier: 'ask', test: (p) => /(^|\/)\.pypirc$/.test(p) },
  { pathId: 'gem-credentials', tier: 'ask', test: (p) => /(^|\/)\.gem\/credentials$/.test(p) },
  { pathId: 'vault-token', tier: 'ask', test: (p) => /(^|\/)(\.vault-token|vault-token)$/.test(p) },
  { pathId: 'htpasswd', tier: 'ask', test: (p) => /(^|\/)\.?htpasswd$/.test(p) },
  { pathId: 'pgpass', tier: 'ask', test: (p) => /(^|\/)\.pgpass$/.test(p) },
  { pathId: 'my-cnf', tier: 'ask', test: (p) => /(^|\/)\.my\.cnf$/.test(p) },
];

// No file system accepts a longer path. The cap also keeps the `.*` in the ported patterns from
// going quadratic on one huge word (a 63 KB word of repeated `serviceaccount` took 1.7 s).
const MAX_PATH = 4096;

/**
 * Does this path name a secret? Returns `{pathId, tier}` for the first match (deny entries are
 * first in the table) or null. `~`, `$HOME` and `${HOME}` at the start are expanded with `home`.
 */
function classifyPath(p, home) {
  if (typeof p !== 'string' || p === '' || p.length > MAX_PATH) return null;
  const full = tidy(p, home);
  const base = posix.basename(full);
  for (const s of SECRET_PATHS) if (s.test(full, base)) return { pathId: s.pathId, tier: s.tier };
  return null;
}

const MAX_ALTERNATIVES = 256;

/** Expand `{a,b}` groups (innermost first) into every alternative, up to a cap. */
function expandBraces(glob) {
  let out = [glob];
  for (let round = 0; round < 8; round++) {
    const next = [];
    let changed = false;
    for (const g of out) {
      const m = /\{([^{}]*)\}/.exec(g);
      if (m === null) {
        next.push(g);
        continue;
      }
      changed = true;
      for (const alt of m[1].split(',')) next.push(g.slice(0, m.index) + alt + g.slice(m.index + m[0].length));
    }
    out = next.slice(0, MAX_ALTERNATIVES);
    if (!changed) break;
  }
  return out;
}

/**
 * Could this glob match a secret file? A glob cannot be classified as a path, so each
 * alternative (`{a,b}` groups and top-level commas) is cut to its last `/` segment, a leading
 * `*` becomes `x` (so `*.pem` reads as `x.pem`), a trailing `*` and then a trailing `.` are
 * dropped (`.env.*` reads as `.env`), and the result is classified. A deny hit wins over an ask.
 */
function globTargetsSecret(glob, home) {
  if (typeof glob !== 'string' || glob === '') return null;
  let found = null;
  for (const alt of expandBraces(glob)) {
    for (const part of alt.split(',')) {
      let seg = part.trim();
      seg = seg.slice(seg.lastIndexOf('/') + 1);
      // A wildcard first character is read as an ordinary one, as the contract says. No current
      // pattern tells `*` from `x`, so this keeps a later pattern that anchors on it honest.
      if (seg.startsWith('*')) seg = 'x' + seg.slice(1);
      seg = seg.replace(/\*+$/, '').replace(/\.$/, '');
      const c = classifyPath(seg, home);
      if (c !== null && (found === null || (c.tier === 'deny' && found.tier !== 'deny'))) found = c;
    }
  }
  return found;
}

// -- Reading a segment ---------------------------------------------------------------------------

// A word that assigns a variable, the same shape the parser strips from the front of a command.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

const cmdCache = new WeakMap();

/**
 * The command a segment runs: `cmd` (basename) and `args` as commandOf finds them, plus `word`,
 * the command word as written (null when the segment has no words). commandOf drops the
 * directory part of the word and the words before it, and the word is always the one just
 * before `args`, so it is found by position.
 */
function cmdOf(seg) {
  let c = cmdCache.get(seg);
  if (c === undefined) {
    const { cmd, args } = commandOf(seg.words);
    const i = seg.words.length - args.length - 1;
    c = { cmd, args, word: i >= 0 ? seg.words[i] : null };
    cmdCache.set(seg, c);
  }
  return c;
}

/** The non-option words of an rm command line, and whether it is recursive. */
function rmArgs(args) {
  const targets = [];
  let recursive = false;
  let ended = false;
  for (const w of args) {
    if (!ended && w === '--') {
      ended = true;
    } else if (!ended && w.length > 1 && w[0] === '-') {
      if (w[1] === '-') recursive = recursive || w === '--recursive';
      else recursive = recursive || /[rR]/.test(w);
    } else {
      targets.push(w);
    }
  }
  return { targets, recursive };
}

// -- Deny rules ----------------------------------------------------------------------------------

function rmRootHome(seg, ctx) {
  const { cmd, args } = cmdOf(seg);
  if (cmd !== 'rm') return null;
  const { targets, recursive } = rmArgs(args);
  const cwdIsHome = ctx.homeDir !== '' && ctx.cwd !== '' && tidy(ctx.cwd) === ctx.homeDir;
  for (const t of targets) {
    const n = tidy(t, ctx.home);
    const isHome = ctx.homeDir !== '' && (n === ctx.homeDir || n === ctx.homeDir + '/*');
    if (n === '/' || n === '/*' || isHome) return { reason: `removing ${shown(t)} would delete the root or home directory` };
    if (recursive && cwdIsHome && (n === '.' || n === '*')) return { reason: `recursive rm of ${shown(t)} in the home directory would delete it` };
  }
  return null;
}

const SYSTEM_DIRS = new Set(['/bin', '/boot', '/dev', '/etc', '/lib', '/opt', '/private', '/proc', '/sbin', '/sys', '/usr', '/var',
  '/System', '/Library', '/Applications', '/Users', '/home', '/root']);

function rmSystemDir(seg, ctx) {
  const { cmd, args } = cmdOf(seg);
  if (cmd !== 'rm') return null;
  for (const t of rmArgs(args).targets) {
    const n = tidy(t, ctx.home);
    if (SYSTEM_DIRS.has(n.endsWith('/*') ? n.slice(0, -2) : n)) return { reason: `removing ${shown(t)} would delete a system directory` };
  }
  return null;
}

const DISK_DEVICE = /^\/dev\/(?:r?disk|sd|hd|vd|xvd|nvme|mmcblk)/;

function diskWrite(seg) {
  const { cmd, args } = cmdOf(seg);
  if (cmd === 'dd') {
    for (const a of args) {
      if (a.startsWith('of=') && DISK_DEVICE.test(a.slice(3))) return { reason: `dd would overwrite the disk device ${shown(a.slice(3))}` };
    }
  }
  for (const r of seg.redirects) {
    if ((r.op === '>' || r.op === '>>') && DISK_DEVICE.test(r.target)) return { reason: `redirecting output to the disk device ${shown(r.target)} would overwrite it` };
  }
  return null;
}

const DISKUTIL_ERASE = new Set(['erasedisk', 'erasevolume', 'partitiondisk', 'zerodisk', 'randomdisk']);

function diskFormat(seg) {
  const { cmd, args } = cmdOf(seg);
  if (/^(mkfs|newfs)/.test(cmd) || cmd === 'mke2fs') {
    const dev = args.find((a) => a.startsWith('/dev/'));
    if (dev !== undefined) return { reason: `${shown(cmd)} would format the device ${shown(dev)}` };
  }
  if (cmd === 'diskutil') {
    const verb = args.find((a) => !a.startsWith('-'));
    // diskutil reads its verbs without regard to case.
    if (verb !== undefined && DISKUTIL_ERASE.has(verb.toLowerCase())) return { reason: `diskutil ${shown(verb)} would erase a disk` };
  }
  return null;
}

// The one rule that reads raw text: a function that pipes itself into itself in the background
// and is then called has no structure to match. It runs once per command, on the first segment.
const FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

function forkBomb(seg, ctx) {
  return seg.position === 0 && FORK_BOMB.test(ctx.command) ? { reason: 'fork bomb' } : null;
}

// -- Secret reads --------------------------------------------------------------------------------

const READERS = new Set(['cat', 'tac', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'view', 'nl', 'strings', 'xxd', 'hexdump', 'od',
  'base64', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'gawk', 'sed', 'cut', 'sort', 'uniq', 'diff', 'cmp', 'jq', 'yq']);

// The readers that take a pattern, script or filter as their first positional (unless an option
// supplies it), each with what its options do to the words around them. The tables are needed
// because a valued option in front of the pattern (`grep -A 2 id_rsa f`, `rg -t md id_rsa`,
// `awk -v k=1 /id_rsa/ f`) shifts the words by one: its value passes for the pattern, the real
// pattern is read as a file, and a search FOR a key's name looks like a read of the key.
//
// Kinds of option: `flag` takes no value. `val` takes one, either the rest of its cluster (`-A2`,
// `--glob=x`) or else the next word. `val2` takes two (jq `--arg name value`). `valfile` takes a
// name and then a file that is read (jq `--slurpfile`). `rfile` takes a file that is read.
// `pat` supplies the pattern (`-e PATTERN`), so no positional is the pattern. `file` supplies it
// from a file that is itself read (`-f FILE`). An option a table does not list is `maybe`: it may or
// may not take a value, and it is never guessed to be a flag or to take one, so a gap in a table
// costs a prompt at worst. Some are left there on purpose because they differ between the GNU and
// BSD versions of a command (sed `-i`, grep `--context`) or take an optional value (ag `-A`).
function optionTable(spec) {
  const table = { short: new Map(), long: new Map(), stop: new Set(spec.stop || []) };
  for (const [kind, letters] of Object.entries(spec.short)) for (const c of letters) table.short.set(c, kind);
  for (const [kind, names] of Object.entries(spec.long)) for (const n of names.split(' ')) table.long.set(n, kind);
  return table;
}

const GREP = optionTable({
  short: { flag: 'abcEFGHhIiLlnOoPpqRrSsTUuVvwxyZz0123456789', val: 'ABCDdm', pat: 'e', file: 'f' },
  long: {
    flag: 'recursive dereference-recursive count files-with-matches files-without-match ignore-case no-ignore-case invert-match line-number '
      + 'no-filename with-filename word-regexp line-regexp only-matching quiet silent no-messages text null null-data perl-regexp '
      + 'extended-regexp fixed-strings basic-regexp initial-tab byte-offset line-buffered binary color colour help version no-group-separator',
    val: 'after-context before-context max-count binary-files devices directories include exclude exclude-dir include-dir group-separator',
    rfile: 'exclude-from', // (BSD grep takes the value of --context and --label only with `=`: left to the default)
    pat: 'regexp',
    file: 'file',
  },
});
const RG = optionTable({
  short: { flag: '.0FHILNPSUVabchilnopqsuvwxz', val: 'ABCEMTdgjmrt', pat: 'e', file: 'f' },
  long: {
    flag: 'hidden no-ignore no-ignore-dot no-ignore-exclude no-ignore-files no-ignore-global no-ignore-parent no-ignore-vcs no-require-git '
      + 'no-config one-file-system follow unrestricted binary text search-zip case-sensitive ignore-case smart-case fixed-strings invert-match '
      + 'line-regexp word-regexp multiline multiline-dotall null-data pcre2 no-unicode crlf byte-offset column heading no-heading help '
      + 'line-buffered line-number no-line-number null only-matching passthru pretty quiet trim vimgrep with-filename no-filename count '
      + 'count-matches files-with-matches files-without-match json debug no-messages stats trace files type-list version',
    val: 'pre pre-glob dfa-size-limit encoding engine max-count regex-size-limit threads glob iglob max-depth max-filesize type type-not type-add '
      + 'type-clear after-context before-context color colors context context-separator field-context-separator field-match-separator '
      + 'hostname-bin hyperlink-format max-columns path-separator replace sort sortr generate',
    rfile: 'ignore-file',
    pat: 'regexp',
    file: 'file',
  },
});
const AG = optionTable({
  short: { flag: 'acfFhHilLnNorsSQtuUvwz0', val: 'Ggm' }, // (-A, -B and -C take an optional value: left to the default)
  long: {
    flag: 'ignore-case case-sensitive smart-case literal word-regexp invert-match count files-with-matches files-without-matches column '
      + 'nocolor nogroup noheading numbers nonumbers follow hidden unrestricted all-types search-zip null print0 stats vimgrep recurse '
      + 'norecurse fixed-strings only-matching',
    val: 'depth ignore ignore-dir max-count file-search-regex path-to-ignore workers pager width',
  },
});
const SED = optionTable({
  short: { flag: 'aEnrsuz', pat: 'e', file: 'f' }, // (-i takes a suffix on BSD sed only and -l a length on GNU sed only: left to the default)
  long: {
    flag: 'quiet silent regexp-extended null-data separate unbuffered debug posix sandbox follow-symlinks binary help version in-place',
    val: 'line-length',
    pat: 'expression',
    file: 'file',
  },
});
const AWK = optionTable({
  short: { flag: 'bcCghMnNOPrsStV', val: 'Fvl', pat: 'e', file: 'fE', rfile: 'i' },
  long: {
    flag: 'characters-as-bytes traditional copyright gen-pot help bignum non-decimal-data use-lc-numeric optimize posix re-interval '
      + 'no-optimize sandbox lint-old version csv lint',
    val: 'field-separator assign load',
    rfile: 'include',
    pat: 'source',
    file: 'file exec',
  },
});
const JQ = optionTable({
  short: { flag: 'nRscrjaSCMeVhb0', val: 'L', file: 'f' }, // jq -e is --exit-status, not a script
  long: {
    flag: 'null-input raw-input slurp compact-output raw-output raw-output0 join-output ascii-output sort-keys color-output monochrome-output '
      + 'tab unbuffered stream stream-errors seq exit-status version help build-configuration binary',
    val: 'indent library-path',
    val2: 'arg argjson',
    valfile: 'slurpfile rawfile',
    file: 'from-file',
  },
  stop: ['--args', '--jsonargs'], // what follows are values for $ARGS, not files
});
const PATTERN_READERS = new Map([['grep', GREP], ['egrep', GREP], ['fgrep', GREP], ['rg', RG], ['ag', AG], ['sed', SED], ['awk', AWK],
  ['gawk', AWK], ['jq', JQ]]);

// The words an option may take after it, by kind ('v' a plain value, 'f' a file, '' none).
const OWED = { flag: [''], val: ['v'], val2: ['vv'], valfile: ['vf'], rfile: ['f'], pat: ['v'], file: ['f'], maybe: ['', 'v'] };
const FILE_VALUE = new Set(['rfile', 'file']);

/**
 * What one option word (`-rn`, `-A2`, `--glob=x`) does. `owed` lists the ways it may take the words
 * after it, `supplies` says it provides the pattern, and `file` is a file named inside the word
 * (`--file=x`, `-fx`) and whether that is certain. A cluster of short options is read up to the
 * first letter that is not a flag; the rest of the cluster is that letter's value.
 */
function readOption(table, w) {
  if (w[1] === '-') {
    const eq = w.indexOf('=');
    const known = table.long.get(eq === -1 ? w.slice(2) : w.slice(2, eq));
    const kind = known || 'maybe';
    const supplies = kind === 'pat' || kind === 'file';
    if (eq === -1) return { owed: OWED[kind], supplies, file: null };
    const value = w.slice(eq + 1);
    // The value of an option the table does not list might be a file.
    if (known === undefined) return { owed: [''], supplies, file: { word: value, certain: false } };
    return { owed: [''], supplies, file: FILE_VALUE.has(kind) ? { word: value, certain: true } : null };
  }
  const letters = w.slice(1);
  let i = 0;
  while (i < letters.length && table.short.get(letters[i]) === 'flag') i++;
  if (i === letters.length) return { owed: [''], supplies: false, file: null };
  const kind = table.short.get(letters[i]) || 'maybe';
  const supplies = kind === 'pat' || kind === 'file';
  const rest = letters.slice(i + 1);
  if (rest === '') return { owed: OWED[kind], supplies, file: null };
  return { owed: [''], supplies, file: FILE_VALUE.has(kind) ? { word: rest, certain: true } : null };
}

/** Does an option (`-e`, `-f`, a cluster holding one, `--regexp`, `--file`) supply the pattern? */
function suppliesPattern(table, words) {
  for (const w of words) {
    if (w === '--') return false;
    if (w.length > 1 && w[0] === '-' && readOption(table, w).supplies) return true;
  }
  return false;
}

/**
 * The words of a pattern reader's arguments that may be files, as `{word, certain}`. Which word is
 * the pattern depends on which options take a value, and an option the table does not list might
 * or might not, so every way of reading the arguments is followed at once. A reading is a string:
 * `1` or `0` for whether the pattern has been found, then the words still owed to an option. A word
 * is a file on every reading (`certain`), on only some (it might be an option's value or the
 * pattern), or on none (not returned).
 */
function patternReaderWords(table, args) {
  const stop = args.findIndex((w) => table.stop.has(w));
  const words = stop === -1 ? args : args.slice(0, stop);
  const end = words.indexOf('--'); // from here on every word is a positional
  let readings = new Set([suppliesPattern(table, words) ? '1' : '0']);
  const out = [];
  words.forEach((w, i) => {
    const roles = new Set();
    const next = new Set();
    let inline = null;
    for (const r of readings) {
      const found = r[0];
      const owed = r.slice(1);
      if (owed !== '') {
        roles.add(owed[0] === 'f' ? 'file' : 'value');
        next.add(found + owed.slice(1));
      } else if ((end === -1 || i < end) && w.length > 1 && w[0] === '-') {
        roles.add('option');
        const opt = readOption(table, w);
        inline = opt.file;
        for (const more of opt.owed) next.add(found + more);
      } else if (i === end) {
        roles.add('option');
        next.add(r);
      } else if (found === '0') {
        roles.add('pattern');
        next.add('1');
      } else {
        roles.add('file');
        next.add(r);
      }
    }
    if (roles.has('file')) out.push({ word: w, certain: roles.size === 1 });
    if (inline !== null) out.push({ word: inline.word, certain: inline.certain && roles.size === 1 && roles.has('option') });
    readings = next;
  });
  return out;
}

/**
 * The words of a reader's arguments that may be files, as `{word, certain}`. For the readers that
 * take a pattern see patternReaderWords. For the others it is every non-option word, plus the value
 * of `--name=value` options.
 */
function readerWords(cmd, args) {
  const table = PATTERN_READERS.get(cmd);
  if (table !== undefined) return patternReaderWords(table, args);
  const out = [];
  let ended = false;
  for (const w of args) {
    if (!ended && w === '--') {
      ended = true;
    } else if (!ended && w.length > 1 && w[0] === '-') {
      const eq = w[1] === '-' ? w.indexOf('=') : -1;
      if (eq !== -1) out.push({ word: w.slice(eq + 1), certain: true });
    } else {
      out.push({ word: w, certain: true });
    }
  }
  return out;
}

/**
 * A reader with a secret argument, or any command with a secret `<` target. An argument with a
 * glob character (`*`, `?`, `[`, or a `{a,b}` group) is also read as a glob, so a wildcard or brace
 * word is caught the way `.env.local` is.
 * A word that is a file on only some readings of the options (it might be the pattern or an
 * option's value) can ask but never deny, because a deny cannot be approved.
 */
function readSecret(seg, ctx) {
  const { cmd, args } = cmdOf(seg);
  const words = READERS.has(cmd) ? readerWords(cmd, args) : [];
  for (const r of seg.redirects) if (r.op === '<') words.push({ word: r.target, certain: true });
  let best = null;
  for (const { word, certain } of words) {
    const c = classifyPath(word, ctx.home) || (/[*?[{]/.test(word) ? globTargetsSecret(word, ctx.home) : null);
    if (c === null) continue;
    const tier = c.tier === 'deny' && !certain ? 'ask' : c.tier;
    if (best === null || (tier === 'deny' && best.tier !== 'deny')) best = { word, pathId: c.pathId, tier };
  }
  if (best === null) return null;
  return { pathId: best.pathId, tier: best.tier, reason: `reading ${shown(best.word)} (${best.pathId}) can expose secrets` };
}

// -- Safety nets ---------------------------------------------------------------------------------

const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const PLAIN_PATH_CHARS = /^[A-Za-z0-9_.+~/-]+$/;
// A segment that is only the closing `}` of a group, or `!`, has no command to judge.
const LONE_SYNTAX = new Set(['{', '}', '!']);
// Words that run no program: the test builtins `[` and `[[`, and the null command `:`. Whatever is
// inside a test is only its arguments, and a `$( )` in it is a substitution of its own. A `&&` or
// `||` after the test starts a new segment, so a reader behind one is still seen. One inside `[[ ]]`
// splits the test itself; testContinuations finds the pieces so that net A does not ask about them.
// `test -f x` passes the same way.
const NO_PROGRAM = new Set(['[', '[[', ':']);
// The parser reads the default arm of a case, `*)`, as a segment whose only word is `*`.
const CASE_DEFAULT_ARM = /^[*?]+$/;

/** A program name, a path built from name characters plus `/`, `.` and `~`, or a word that runs no program. */
function isPlain(word) {
  return PLAIN_NAME.test(word) || (PLAIN_PATH_CHARS.test(word) && /[/.~]/.test(word)) || NO_PROGRAM.has(word);
}

/**
 * The segments that are the rest of a `[[ ... ]]` test. The parser splits `[[ -f x && -d y ]]` at
 * its inner `&&` (or `||`), so the second half, `-d y ]]`, shows a test operand where a command
 * word should be. A test opens at a segment whose command word is `[[` and closes at the first
 * segment of the same body (same parent) that ends in `]]`; the segments in between are returned.
 * Only net A skips them: every other rule still sees them, and a `$( )` in the test is a segment
 * of a body of its own, so it is not one of them.
 */
function testContinuations(segments) {
  const cont = new Set();
  const open = new Set(); // the parents of the bodies that are inside a test
  for (const seg of segments) {
    const ends = seg.words[seg.words.length - 1] === ']]';
    if (open.has(seg.parent)) {
      cont.add(seg);
      if (ends) open.delete(seg.parent);
    } else if (!ends && cmdOf(seg).word === '[[') {
      open.add(seg.parent);
    }
  }
  return cont;
}

/**
 * Safety net for what the parser does not model: `a[0]=1 cmd`, `{fd}>f cmd`, `$CC file`, an
 * empty or quoted-away command word. If the word that runs is not a plain program name, nothing
 * after it can be trusted, so it asks. A lone `*` or `?` in a command that has a `case` is an arm
 * pattern, not a command, so it passes; the price is that `case x in a) *;; esac` passes too.
 */
function unrecognizedCommandWord(seg, ctx) {
  if (ctx.testRest.has(seg)) return null;
  const { cmd, args, word } = cmdOf(seg);
  if (word === null) return null;
  if (cmd === '' && args.length === 0 && ASSIGNMENT.test(word)) return null; // only assignments
  if (args.length === 0 && LONE_SYNTAX.has(word)) return null;
  if (args.length === 0 && ctx.hasCase && CASE_DEFAULT_ARM.test(word)) return null;
  return isPlain(word) ? null : { reason: 'unrecognized command word' };
}

/** The parser gave up on part of the command (size, depth, `env -S`, an unknown option). */
function unparsedCommand(seg, ctx) {
  return seg.position === 0 && ctx.unparsed !== null ? { reason: `could not fully read the command (${ctx.unparsed})` } : null;
}

// -- The rule table ------------------------------------------------------------------------------

const RULES = [
  { id: 'rm-root-home', tier: 'deny', test: rmRootHome },
  { id: 'rm-system-dir', tier: 'deny', test: rmSystemDir },
  { id: 'disk-write', tier: 'deny', test: diskWrite },
  { id: 'disk-format', tier: 'deny', test: diskFormat },
  { id: 'fork-bomb', tier: 'deny', test: forkBomb },
  // read-secret is the last secret rule: a rule for a specific action goes above it, so it wins
  // a tie inside one segment. Its tier is the one the path classifier returns.
  { id: 'read-secret', tier: 'ask', test: readSecret },
  { id: 'unparsed-command', tier: 'ask', test: unparsedCommand },
  { id: 'unrecognized-command-word', tier: 'ask', test: unrecognizedCommandWord },
];

// -- Deciding ------------------------------------------------------------------------------------

// Stands in when a command has no segments at all (only comments, say), so that rules about the
// command as a whole, such as `unparsed-command`, still run.
const NO_SEGMENT = Object.freeze({
  words: [], redirects: [], substs: [], pipeline: 0, position: 0, via: 'top', parent: null, depth: 0, unparsed: null,
});

/** Is hit `a` a better winner than `b`? Deny first, then the lowest position, then table order. */
function beats(a, b) {
  if (b === null) return true;
  if ((a.tier === 'deny') !== (b.tier === 'deny')) return a.tier === 'deny';
  if (a.position !== b.position) return a.position < b.position;
  return a.ruleIndex < b.ruleIndex;
}

/** Turn the winning hit into a decision with its reason text, converting an ask when nobody can answer. */
function finish(hit, payload, env) {
  const head = `constellation-guard [${hit.id}] `;
  let decision = 'deny';
  let reason;
  if (hit.tier === 'deny') reason = `${head}blocked: ${hit.reason}${DENY_TAIL}`;
  else if (payload.agent_id) reason = `${head}${hit.reason}${SUBAGENT_TAIL}`;
  else if (env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') reason = `${head}${hit.reason}${HEADLESS_TAIL}`;
  else if (env.CONSTELLATION_GUARD_ASK === 'deny') reason = `${head}${hit.reason}${FALLBACK_TAIL}`;
  else {
    decision = 'ask';
    reason = `${head}${hit.reason}${ASK_TAIL}`;
  }
  const out = { decision, id: hit.id };
  if (hit.pathId !== undefined) out.pathId = hit.pathId;
  out.reason = reason;
  return out;
}

/**
 * Decide what to do with one tool call. `payload` is the hook input; `env` and `home` default to
 * the process's and are passed explicitly by tests. Returns null (no opinion) or
 * `{decision: 'ask'|'deny', id, pathId?, reason}`.
 */
function decide(payload, opts) {
  const { env = process.env, home = os.homedir() } = opts || {};
  if (!payload || payload.tool_name !== 'Bash') return null;
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || command === '') return null;

  const parsed = parse(command);
  const ctx = {
    command,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    home,
    homeDir: typeof home === 'string' && posix.isAbsolute(home) ? tidy(home) : '',
    unparsed: parsed.unparsed,
    hasCase: parsed.segments.some((seg) => cmdOf(seg).cmd === 'case'),
    testRest: testContinuations(parsed.segments),
  };
  const critical = env.CONSTELLATION_GUARD === 'critical';

  let best = null;
  for (const seg of parsed.segments.length ? parsed.segments : [NO_SEGMENT]) {
    RULES.forEach((rule, ruleIndex) => {
      const r = rule.test(seg, ctx);
      if (!r) return;
      const tier = r.tier || rule.tier;
      if (critical && tier !== 'deny') return;
      const hit = { id: rule.id, tier, pathId: r.pathId, reason: r.reason || rule.id, position: seg.position, ruleIndex };
      if (beats(hit, best)) best = hit;
    });
  }
  return best === null ? null : finish(best, payload, env);
}

/** The PreToolUse hook output for a decision, or `{}` (no opinion) for null. */
function toOutput(d) {
  if (!d) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: d.reason } };
}

// -- The hook ------------------------------------------------------------------------------------

/** Append one JSON line to `<log dir>/<UTC date>.jsonl`. Logging never fails the hook. */
function log(env, home, data) {
  try {
    const dir = env.CONSTELLATION_GUARD_LOG_DIR || (home ? path.join(home, '.claude', 'hooks-logs') : '');
    if (dir === '') return; // no home to log under: skip rather than write into the cwd
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(path.join(dir, `${ts.slice(0, 10)}.jsonl`), JSON.stringify({ ts, hook: 'constellation-guard', ...data }) + '\n');
  } catch {
    // A full disk or a read-only home must not turn into a blocked command.
  }
}

function print(out) {
  process.stdout.write(JSON.stringify(out) + '\n');
}

/** Read the hook payload from stdin, answer on stdout, log decisions. Always exits 0. */
async function main() {
  const env = process.env;
  let home = '';
  try {
    home = os.homedir();
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    const payload = JSON.parse(input);
    const d = decide(payload, { env, home });
    if (d !== null) {
      const cmd = payload.tool_input.command;
      log(env, home, {
        decision: d.decision,
        id: d.id,
        pathId: d.pathId,
        tool: payload.tool_name,
        target: cmd.slice(0, 200),
        session_id: payload.session_id,
        cwd: payload.cwd,
        permission_mode: payload.permission_mode,
        agent_id: payload.agent_id,
      });
    }
    print(toOutput(d));
  } catch (e) {
    log(env, home, { level: 'ERROR', error: e && e.message });
    print({});
  }
}

if (require.main === module) {
  main();
}

module.exports = { decide, classifyPath, globTargetsSecret, toOutput, main, RULES };
