'use strict';
// Tests for the parser layer of hooks/lib/shell-words.js: parse() re-reads the places where a
// command hides another command (substitutions, `sh -c`, `eval`, `env -S`, `xargs`, `find -exec`),
// commandOf() finds the command word behind prefixes like `sudo` and `env`, and gitCmd() skips
// git's global options. Every test drives the real functions on real command text.
//
// Corpus tables stay inline in this file: `node --test` runs any non-test .js under hooks/test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, commandOf, gitCmd } = require('../lib/shell-words.js');

const shq = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
// `wrap` applied k times around `inner`, e.g. nest(2, 'x', (c) => `bash -c ${shq(c)}`).
const nest = (k, inner, wrap) => {
  let c = inner;
  for (let n = 0; n < k; n++) c = wrap(c);
  return c;
};
const bashC = (c) => 'bash -c ' + shq(c);
const segs = (cmd) => parse(cmd).segments;
const cmdOf = (s) => commandOf(s.words).cmd;
// Every segment as `position:via:parent:depth:words`, in order.
const shape = (cmd) => segs(cmd).map((s) => `${s.position}:${s.via}:${s.parent}:${s.depth}:${s.words.join(' ')}`);
// The one segment whose command word is `name`.
const only = (cmd, name) => {
  const m = segs(cmd).filter((s) => cmdOf(s) === name);
  assert.equal(m.length, 1, `${JSON.stringify(cmd)}: expected one ${name} segment, got ${m.length}`);
  return m[0];
};

test('recurses', () => {
  const rows = [
    // [command, via of the cat segment, command word of its parent]
    ['export $(cat .env)', 'subst', 'export'],
    ['echo `cat x`', 'subst', 'echo'],
    ['bash -c "cat .env"', 'shell-c', 'bash'],
    ["sh -lc 'cat x'", 'shell-c', 'sh'],
    ['eval "cat x"', 'shell-c', 'eval'],
  ];
  for (const [cmd, via, parentCmd] of rows) {
    const cat = only(cmd, 'cat');
    assert.equal(cat.via, via, cmd);
    assert.equal(typeof cat.parent, 'number', cmd);
    assert.equal(cmdOf(segs(cmd)[cat.parent]), parentCmd, cmd);
    assert.equal(cat.depth, 1, cmd);
  }
  assert.deepEqual(shape('export $(cat .env)'), ['0:top:null:0:export ', '1:subst:0:1:cat .env']);
  assert.deepEqual(shape('bash -c "cat .env"'), ['0:top:null:0:bash -c cat .env', '1:shell-c:0:1:cat .env']);
  assert.equal(parse('bash -c "cat .env"').unparsed, null);
});

test('parse keeps the tokenizer fields on every segment', () => {
  const [top, sub] = segs('export $(cat .env) > out');
  assert.deepEqual(top.words, ['export', '']);
  assert.deepEqual(top.redirects, [{ op: '>', target: 'out' }]);
  assert.deepEqual(top.substs, ['cat .env']);
  assert.deepEqual(sub.words, ['cat', '.env']);
  assert.deepEqual(sub.substs, []);
  assert.equal(typeof top.pipeline, 'number');
});

test('position, parent and depth follow a depth-first, source-order walk', () => {
  assert.deepEqual(shape('echo $(a $(b)) ; c | d $(e)'), [
    '0:top:null:0:echo ',
    '1:subst:0:1:a ',
    '2:subst:1:2:b',
    '3:top:null:0:c',
    '4:top:null:0:d ',
    '5:subst:4:1:e',
  ]);
  // Children follow their parent and come before its next sibling.
  assert.deepEqual(shape('bash -c "a; b" ; c'), [
    '0:top:null:0:bash -c a; b',
    '1:shell-c:0:1:a',
    '2:shell-c:0:1:b',
    '3:top:null:0:c',
  ]);
  // A segment's substitutions come before the commands it runs itself.
  assert.deepEqual(shape('bash -c "$(d)"').map((s) => s.split(':').slice(0, 4).join(':')), ['0:top:null:0', '1:subst:0:1']);
});

test('pipeline ids come from one counter per parse', () => {
  const s = segs('find . -name x | xargs -0 cat {} ; echo $(x | y) ; bash -c "p | q"');
  const by = (name) => s.filter((x) => cmdOf(x) === name);
  const [find] = by('find');
  const [xargs] = by('xargs');
  const [catChild] = by('cat');
  // find | xargs are one pipeline, and the xargs child inherits it.
  assert.equal(xargs.pipeline, find.pipeline);
  assert.equal(catChild.via, 'xargs');
  assert.equal(catChild.pipeline, xargs.pipeline);
  // Substitution and `-c` bodies get fresh ids, shared by their own pipes.
  const [echo] = by('echo');
  const [x] = by('x');
  const [y] = by('y');
  const [bash] = by('bash');
  const [p] = by('p');
  const [q] = by('q');
  assert.equal(x.pipeline, y.pipeline);
  assert.equal(p.pipeline, q.pipeline);
  const groups = new Set([find.pipeline, echo.pipeline, x.pipeline, bash.pipeline, p.pipeline]);
  assert.equal(groups.size, 5);
  assert.ok(s.every((seg) => Number.isInteger(seg.pipeline) && seg.pipeline >= 0));
});

test('xargs and find-exec', () => {
  const pipe = 'find . -name x | xargs -0 -I{} cat {}/y';
  const xargs = only(pipe, 'xargs');
  const cat = only(pipe, 'cat');
  assert.deepEqual(cat.words, ['cat', '{}/y']);
  assert.equal(cat.via, 'xargs');
  assert.equal(cat.parent, xargs.position);
  assert.equal(cat.pipeline, xargs.pipeline);
  assert.deepEqual(commandOf(cat.words).args, ['{}/y']);

  const plus = 'find . -exec grep -l a {} +';
  const grep = only(plus, 'grep');
  assert.equal(grep.via, 'find-exec');
  assert.equal(grep.parent, only(plus, 'find').position);
  assert.deepEqual(grep.words, ['grep', '-l', 'a', '{}']);

  const semi = 'find . -name x -exec cat {} \\;';
  const c2 = only(semi, 'cat');
  assert.equal(c2.via, 'find-exec');
  assert.deepEqual(c2.words, ['cat', '{}']);
  assert.equal(c2.pipeline, only(semi, 'find').pipeline);
});

test('xargs skips the values of its options, attached or separate', () => {
  const rows = [
    ['xargs -I {} cat {}', ['cat', '{}']],
    ['xargs -I{} cat {}', ['cat', '{}']],
    ['xargs -n 1 cat a', ['cat', 'a']],
    ['xargs -n1 cat a', ['cat', 'a']],
    ['xargs -P 4 -n 2 cat a', ['cat', 'a']],
    ['xargs -P4 cat a', ['cat', 'a']],
    ['xargs -L 1 cat a', ['cat', 'a']],
    ['xargs -L1 cat a', ['cat', 'a']],
    ["xargs -d '\\n' cat a", ['cat', 'a']],
    ['xargs -d, cat a', ['cat', 'a']],
    ['xargs -E END cat a', ['cat', 'a']],
    ['xargs -EEND cat a', ['cat', 'a']],
    ['xargs -s 100 cat a', ['cat', 'a']],
    ['xargs -a list cat a', ['cat', 'a']],
    ['xargs -alist cat a', ['cat', 'a']],
    ['xargs --max-args=1 cat a', ['cat', 'a']],
    ['xargs --max-args 1 cat a', ['cat', 'a']],
    ['xargs --max-procs 4 cat a', ['cat', 'a']],
    ['xargs --max-chars 100 cat a', ['cat', 'a']],
    ['xargs --arg-file list cat a', ['cat', 'a']],
    ['xargs --delimiter , cat a', ['cat', 'a']],
    ['xargs --replace={} cat {}', ['cat', '{}']],
    ['xargs --max-lines=2 cat a', ['cat', 'a']],
    ['xargs --eof=E cat a', ['cat', 'a']],
    // GNU takes a value for these long forms only after `=`; a separate word is the command.
    ['xargs --replace cat {}', ['cat', '{}']],
    ['xargs --max-lines cat a', ['cat', 'a']],
    ['xargs --eof cat a', ['cat', 'a']],
    ['xargs -0rt cat a', ['cat', 'a']],
    ['xargs -0I{} cat {}', ['cat', '{}']],
    ['xargs -0 -r --null --verbose cat a', ['cat', 'a']],
    ['xargs -- cat a', ['cat', 'a']],
    ['xargs -I {} -n 1 -P 2 -0 sudo cat {}', ['sudo', 'cat', '{}']],
    // The command's own flags are the command's, not xargs's.
    ['xargs cat -n a', ['cat', '-n', 'a']],
    ['xargs sort -d a', ['sort', '-d', 'a']],
  ];
  for (const [cmd, words] of rows) {
    const child = segs(cmd).find((s) => s.via === 'xargs');
    assert.ok(child, cmd);
    assert.deepEqual(child.words, words, cmd);
    assert.equal(child.depth, 1, cmd);
  }
  // No command means xargs runs echo, even when options with values were given.
  for (const cmd of ['xargs', 'xargs -0', 'xargs -n 1', 'xargs -I {}', 'xargs --max-args 2 -r']) {
    const child = segs(cmd).find((s) => s.via === 'xargs');
    assert.deepEqual(child.words, ['echo'], cmd);
  }
});

test('xargs and find-exec after a prefix, and nested inside each other', () => {
  assert.equal(only('sudo xargs rm x', 'rm').via, 'xargs');
  assert.equal(only('/usr/bin/xargs -0 rm x', 'rm').via, 'xargs');
  assert.equal(only('nice -n 5 find . -exec rm {} \\;', 'rm').via, 'find-exec');
  // The child is parsed like any other segment: -c bodies, xargs and find-exec all chain.
  assert.deepEqual(shape("xargs bash -c 'cat x'"), [
    '0:top:null:0:xargs bash -c cat x',
    '1:xargs:0:1:bash -c cat x',
    '2:shell-c:1:2:cat x',
  ]);
  assert.deepEqual(shape('find . -exec xargs cat {} \\;'), [
    '0:top:null:0:find . -exec xargs cat {} ;',
    '1:find-exec:0:1:xargs cat {}',
    '2:xargs:1:2:cat {}',
  ]);
  assert.deepEqual(shape("find . -exec sh -c 'cat \"$1\"' _ {} \\;").map((s) => s.split(':').slice(0, 4).join(':')), [
    '0:top:null:0',
    '1:find-exec:0:1',
    '2:shell-c:1:2',
  ]);
});

test('find-exec clauses: -exec -execdir -ok -okdir, one child per clause', () => {
  for (const flag of ['-exec', '-execdir', '-ok', '-okdir']) {
    const cmd = `find . ${flag} cat {} \\;`;
    assert.deepEqual(shape(cmd), ['0:top:null:0:find . ' + flag + ' cat {} ;', '1:find-exec:0:1:cat {}'], cmd);
  }
  // Two clauses give two children, both under find, in source order.
  assert.deepEqual(shape('find . -exec a {} \\; -name x -exec b {} +'), [
    '0:top:null:0:find . -exec a {} ; -name x -exec b {} +',
    '1:find-exec:0:1:a {}',
    '2:find-exec:0:1:b {}',
  ]);
  // A `+` ends a clause only right after `{}`; elsewhere it is an argument.
  assert.deepEqual(only('find . -exec chmod +x {} \\;', 'chmod').words, ['chmod', '+x', '{}']);
  assert.deepEqual(only('find . -exec echo + a \\;', 'echo').words, ['echo', '+', 'a']);
  // A clause that never terminates still yields its command: over-reporting beats a missed one.
  assert.deepEqual(only('find . -exec cat {}', 'cat').words, ['cat', '{}']);
  // An unquoted `;` ends the find segment; what it already collected is still the clause.
  assert.deepEqual(only('find . -exec cat {} ; ls', 'cat').words, ['cat', '{}']);
  // No -exec, no child; an empty clause makes none.
  assert.equal(segs('find . -name x -print').length, 1);
  assert.equal(segs('find . -exec \\;').length, 1);
  // -exec words that belong to some other command are not find's.
  assert.equal(segs('echo -exec cat {} \\;').length, 1);
});

test('shell -c forms', () => {
  const rows = [
    "bash -c 'cat x'",
    "/bin/bash -c 'cat x'",
    "sh -c 'cat x'",
    "zsh -c 'cat x'",
    "dash -c 'cat x'",
    "ksh -c 'cat x'",
    "bash -lc 'cat x'",
    "bash -ec 'cat x'",
    "bash -l -c 'cat x'",
    "bash -xc 'cat x'",
    "bash -o pipefail -c 'cat x'",
    "bash +o history -c 'cat x'",
    "bash -O extglob -c 'cat x'",
    "bash --norc -c 'cat x'",
    "bash --login --noprofile -c 'cat x'",
    "bash --rcfile f -c 'cat x'",
    "bash --init-file f -c 'cat x'",
    "bash -c 'cat x' arg0 arg1",
    "bash -c -- 'cat x'",
    // After `--` a word that starts with a dash is the string, not an option.
    "bash -c -- '-x; cat x'",
    "sudo bash -c 'cat x'",
    "sudo -u root sh -c 'cat x'",
    "env -i PATH=/usr/bin bash -c 'cat x'",
    "nohup sh -c 'cat x'",
    "time bash -c 'cat x'",
    "FOO=1 bash -c 'cat x'",
  ];
  for (const cmd of rows) {
    const cat = only(cmd, 'cat');
    assert.equal(cat.via, 'shell-c', cmd);
    assert.deepEqual(cat.words, ['cat', 'x'], cmd);
  }
  // Not a -c body: a script file, a shell that is only an argument, no string, an empty string.
  for (const cmd of [
    "bash script.sh -c 'cat x'",
    "bash -x script.sh 'cat x'",
    "echo bash -c 'cat x'",
    "bash +c 'cat x'",
    'bash -c',
    "bash -o -c 'cat x'",
    "bash --norc 'cat x'",
    'bash',
    "bash -c ''",
    "bashful -c 'cat x'",
  ]) {
    assert.equal(segs(cmd).filter((s) => s.via === 'shell-c').length, 0, cmd);
  }
  // Compound bodies keep every command, in order.
  assert.deepEqual(shape("sh -c 'cd /r && cat x | wc -l'").slice(1), [
    '1:shell-c:0:1:cd /r',
    '2:shell-c:0:1:cat x',
    '3:shell-c:0:1:wc -l',
  ]);
});

test('eval joins its arguments the way the shell does and parses the result', () => {
  assert.deepEqual(only('eval cat x', 'cat').words, ['cat', 'x']);
  assert.deepEqual(only('eval "cat" "x"', 'cat').words, ['cat', 'x']);
  assert.deepEqual(only("eval 'cat x; ls'", 'ls').words, ['ls']);
  assert.equal(only('eval cat x', 'cat').via, 'shell-c');
  assert.equal(segs('eval').length, 1);
  assert.equal(only('sudo eval cat x', 'cat').via, 'shell-c');
  assert.equal(segs('echo eval cat x').length, 1);
});

test('env -S runs its string through the shell', () => {
  for (const cmd of [
    "env -S 'cat x'",
    "env -i -S 'cat x'",
    "env -S'cat x'",
    "env -iS 'cat x'",
    "env --split-string='cat x'",
    "env --split-string 'cat x'",
    "sudo env -S 'cat x'",
  ]) {
    const cat = only(cmd, 'cat');
    assert.equal(cat.via, 'shell-c', cmd);
    assert.deepEqual(cat.words, ['cat', 'x'], cmd);
  }
  // env appends the words after STR to the split string (`env -S 'echo a' b` prints `a b`), so the
  // command that really runs keeps those words as its arguments. Each is one literal word, never
  // re-split or re-expanded: the quoted `a b` stays a single argument.
  for (const [cmd, name, args] of [
    ['env -S cat ~/.ssh/id_rsa', 'cat', ['~/.ssh/id_rsa']],
    ["env -S '' rm -rf ~", 'rm', ['-rf', '~']],
    ["env -S 'FOO=1' cat .env", 'cat', ['.env']],
    ["env -S 'echo a' b", 'echo', ['a', 'b']],
    ["env -S cat 'a b'", 'cat', ['a b']],
    ["env -S 'cat x' y z", 'cat', ['x', 'y', 'z']],
    ['env -i -S cat .env', 'cat', ['.env']],
    ["env -u FOO -S'cat x' y", 'cat', ['x', 'y']],
    // Words after STR belong to the child, even ones that look like env's own options: real env
    // runs `cat -u f` here, so `f` must stay visible (`-u` and `-C` take a value for env itself).
    ['env -S cat -u .env', 'cat', ['-u', '.env']],
    ['env -S sed -C ~/.aws/credentials', 'sed', ['-C', '~/.aws/credentials']],
    ['env -S cat -- .env', 'cat', ['--', '.env']],
    ["sudo env -S cat '$HOME/.aws/credentials'", 'cat', ['$HOME/.aws/credentials']],
    ["env --split-string=cat 'it'\\''s'", 'cat', ["it's"]],
    // Only the first -S names the string; real env hands a later -S (or --split-string=x) to the
    // child as a plain word, so `env -S cat -S x f` runs `cat -S x f` and `f` must stay visible.
    ['env -S echo -S x y', 'echo', ['-S', 'x', 'y']],
    ['env -S cat -S x ~/.ssh/id_rsa', 'cat', ['-S', 'x', '~/.ssh/id_rsa']],
    ['env -S cat --split-string=x .env', 'cat', ['--split-string=x', '.env']],
    // A STR that starts with env options is read by env itself: `env -S '-i cat' .env` runs `cat .env`.
    ["env -S '-i cat' .env", 'cat', ['.env']],
    ["env -S' -i cat' .env", 'cat', ['.env']],
    ["env --split-string='-u FOO cat' .env", 'cat', ['.env']],
  ]) {
    const child = only(cmd, name);
    assert.equal(child.via, 'shell-c', cmd);
    assert.deepEqual(commandOf(child.words).args, args, cmd);
  }
  // The leftover words cannot start a second command or a redirect: they are quoted, so `;` and `>` stay literal.
  assert.deepEqual(shape("env -S cat ';' '>' x").slice(1), ['1:shell-c:0:1:cat ; > x']);
  assert.deepEqual(segs("env -S cat '>' x")[1].redirects, []);
  // Without -S, env just runs its command; no body to parse.
  assert.equal(segs('env -u FOO cat x').filter((s) => s.via === 'shell-c').length, 0);
  assert.equal(segs('env -i').length, 1);
  // The value of -u is not a split string, even when it starts with S.
  assert.equal(segs('env -u Scat x').filter((s) => s.via === 'shell-c').length, 0);
});

test('commit message', () => {
  const cmd = 'git commit -m "$(cat <<\'EOF\'\nfix (scope: unbalanced\nmentions .env\nEOF\n)"';
  const r = parse(cmd);
  assert.equal(r.unparsed, null);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map(cmdOf), ['git', 'cat']);
  assert.deepEqual(r.segments.map((s) => s.via), ['top', 'subst']);
  assert.equal(r.segments[1].parent, 0);
  assert.ok(!r.segments.flatMap((s) => s.words).includes('.env'));
  // The command after the message is neither swallowed nor mistaken for part of it.
  assert.deepEqual(parse(cmd + ' && git status').segments.map(cmdOf), ['git', 'cat', 'git']);
});

test('limits', () => {
  // Depth: four nested `bash -c` leave the innermost body unparsed.
  const four = parse(nest(4, 'x', bashC));
  assert.equal(four.unparsed, 'depth');
  assert.ok(Array.isArray(four.segments));
  assert.deepEqual(four.segments.map((s) => s.depth), [0, 1, 2, 3]);
  assert.ok(four.segments.every((s) => cmdOf(s) === 'bash'));
  // Three nested ones fit: the body `x` sits at depth 3.
  const three = parse(nest(3, 'x', bashC));
  assert.equal(three.unparsed, null);
  assert.deepEqual(three.segments.map((s) => s.depth), [0, 1, 2, 3]);
  assert.equal(cmdOf(three.segments[3]), 'x');

  // The same cap holds for substitutions, eval, xargs children and find-exec children.
  assert.equal(parse(nest(3, 'x', (c) => `echo $(${c})`)).unparsed, null);
  assert.equal(parse(nest(4, 'x', (c) => `echo $(${c})`)).unparsed, 'depth');
  assert.equal(parse(nest(4, 'x', (c) => `eval ${shq(c)}`)).unparsed, 'depth');
  assert.equal(parse(nest(3, 'find . -exec cat {} \\;', bashC)).unparsed, 'depth');
  assert.equal(parse(nest(2, 'find . -exec cat {} \\;', bashC)).unparsed, null);
  assert.equal(parse(nest(3, 'xargs cat', bashC)).unparsed, 'depth');
  assert.equal(parse(nest(2, 'xargs cat', bashC)).unparsed, null);
  // What was parsed before the cap is kept.
  assert.ok(parse(nest(4, 'x', (c) => `echo $(${c})`)).segments.length >= 4);

  // Size: only the first 64 KiB is scanned.
  const big = parse('x '.repeat(65 * 512));
  assert.equal(big.unparsed, 'size');
  assert.ok(Array.isArray(big.segments));
  assert.equal(parse('a'.repeat(64 * 1024)).unparsed, null);
  assert.equal(parse('a'.repeat(64 * 1024 + 1)).unparsed, 'size');
  assert.equal(parse('x'.repeat(65 * 1024)).unparsed, 'size');
  // Padding cannot hide a command in the first 64 KiB, and the tail is not scanned.
  const padded = parse('rm -rf / ; ' + ' '.repeat(70000) + '; cat tail');
  assert.equal(padded.unparsed, 'size');
  assert.deepEqual(padded.segments.map(cmdOf), ['rm']);

  // When both limits apply the first reason set stays, and truncation comes first.
  assert.equal(parse(nest(4, 'x', bashC) + ' '.repeat(70000)).unparsed, 'size');

  // A scan that could not follow the text to its end keeps what it found and reports `depth`.
  const heredoc = parse('rm -rf / ; cat <<E\nabc');
  assert.equal(heredoc.unparsed, 'depth');
  assert.deepEqual(heredoc.segments.map(cmdOf), ['rm', 'cat']);
  const deepSubst = parse('rm -rf / ; ' + 'echo $('.repeat(20) + 'x' + ')'.repeat(20));
  assert.equal(deepSubst.unparsed, 'depth');
  assert.equal(cmdOf(deepSubst.segments[0]), 'rm');
  // The same inside a body: the body's segments are kept.
  const inner = parse("bash -c 'rm -rf / ; cat <<E\nabc'");
  assert.equal(inner.unparsed, 'depth');
  assert.deepEqual(inner.segments.map(cmdOf), ['bash', 'rm', 'cat']);

  // Ordinary commands report nothing unparsed.
  for (const cmd of ['', 'ls', 'echo $(date)', "bash -c 'ls'", 'find . -exec ls {} +', 'xargs ls']) {
    assert.equal(parse(cmd).unparsed, null, cmd);
  }
});

test('parse accepts anything and returns the documented shape', () => {
  for (const v of [undefined, null, 42, {}, [], '']) {
    assert.deepEqual(parse(v), { segments: [], unparsed: null }, String(v));
  }
  const kinds = ['top', 'subst', 'shell-c', 'xargs', 'find-exec'];
  const pieces = ['bash -c', 'sh -lc', 'eval', 'env -S', 'xargs', 'xargs -I{}', 'find .', '-exec', '-execdir', '\\;', '+', '{}',
    '$(', ')', '`', '"', "'", ';', '|', '&&', '\n', '<<E', 'E', 'cat', '.env', 'echo', 'sudo', 'x', ' ', ' ', ' ', '-c', '$((', '))'];
  let seed = 0x7a11;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 3000; n++) {
    let cmd = '';
    for (let k = Math.floor(rand() * 30); k > 0; k--) cmd += pieces[Math.floor(rand() * pieces.length)] + ' ';
    const r = parse(cmd);
    const ctx = JSON.stringify(cmd);
    assert.ok([null, 'size', 'depth'].includes(r.unparsed), ctx);
    r.segments.forEach((s, i) => {
      assert.equal(s.position, i, ctx);
      assert.ok(kinds.includes(s.via), ctx);
      assert.ok(Number.isInteger(s.depth) && s.depth >= 0 && s.depth <= 3, ctx);
      assert.ok(Number.isInteger(s.pipeline) && s.pipeline >= 0, ctx);
      assert.ok(Array.isArray(s.words) && Array.isArray(s.redirects) && Array.isArray(s.substs), ctx);
      if (s.via === 'top') {
        assert.equal(s.parent, null, ctx);
        assert.equal(s.depth, 0, ctx);
      } else {
        assert.ok(Number.isInteger(s.parent) && s.parent < s.position, ctx);
        assert.equal(s.depth, r.segments[s.parent].depth + 1, ctx);
      }
      if (s.via === 'xargs' || s.via === 'find-exec') assert.equal(s.pipeline, r.segments[s.parent].pipeline, ctx);
    });
  }
});

test('hostile input returns quickly', () => {
  const inputs = [
    'echo $(a) '.repeat(6000),
    'bash -c x;'.repeat(6000),
    'eval '.repeat(12000),
    'xargs '.repeat(10000),
    'find . -exec a {} \\; '.repeat(3000),
    'find . -exec find . -exec find . -exec find . -exec a {} \\; \\; \\; \\; ',
    'bash -c ' + shq('bash -c ' + shq('bash -c ' + shq('x; '.repeat(5000)))),
    'echo $(echo $(echo $(echo $('.repeat(3000),
    'sudo '.repeat(12000),
    'env '.repeat(12000) + '-S x',
  ];
  const started = Date.now();
  for (const cmd of inputs) {
    const r = parse(cmd);
    assert.ok(Array.isArray(r.segments));
  }
  assert.ok(Date.now() - started < 10000, 'parse must stay roughly linear on hostile input');
});

test('commandOf', () => {
  const rows = [
    // [words text, cmd, args]
    ['sudo -u root rm -rf /', 'rm', ['-rf', '/']],
    ['env -i PATH=/usr/bin bash -c x', 'bash', ['-c', 'x']],
    ['GITHUB_TOKEN= gh pr list', 'gh', ['pr', 'list']],
    ['/bin/rm x', 'rm', ['x']],
    ['timeout -s KILL 5 cat x', 'cat', ['x']],
    ['nice -n 5 cat x', 'cat', ['x']],
    ['stdbuf -oL cat x', 'cat', ['x']],
    ['do cat .env', 'cat', ['.env']],
    ['! grep x f', 'grep', ['x', 'f']],
    ['env', 'env', []],
    // Assignments and reserved words, repeatedly and mixed.
    ['A=1 B=2 cat x', 'cat', ['x']],
    ['A+=1 cat x', 'cat', ['x']],
    ['A= cat x', 'cat', ['x']],
    ['if cat x', 'cat', ['x']],
    ['then cat x', 'cat', ['x']],
    ['else cat x', 'cat', ['x']],
    ['elif cat x', 'cat', ['x']],
    ['while cat x', 'cat', ['x']],
    ['until cat x', 'cat', ['x']],
    ['{ cat x', 'cat', ['x']],
    ['} cat x', 'cat', ['x']],
    ['time cat x', 'cat', ['x']],
    ['do ! A=1 time cat x', 'cat', ['x']],
    ['if ! sudo rm x', 'rm', ['x']],
    // sudo: flags, and a value for each of -u -g -h -p -C -D -r -t -U -T.
    ['sudo rm x', 'rm', ['x']],
    ['sudo -n -E -H rm x', 'rm', ['x']],
    ['sudo -u root rm x', 'rm', ['x']],
    ['sudo -g wheel rm x', 'rm', ['x']],
    ['sudo -h host rm x', 'rm', ['x']],
    ['sudo -p prompt rm x', 'rm', ['x']],
    ['sudo -C 3 rm x', 'rm', ['x']],
    ['sudo -D /d rm x', 'rm', ['x']],
    ['sudo -r role rm x', 'rm', ['x']],
    ['sudo -t type rm x', 'rm', ['x']],
    ['sudo -U other rm x', 'rm', ['x']],
    ['sudo -T 30 rm x', 'rm', ['x']],
    ['sudo -uroot rm x', 'rm', ['x']],
    ['sudo -Eu root rm x', 'rm', ['x']],
    ['sudo -nEuroot rm x', 'rm', ['x']],
    ['sudo --user root rm x', 'rm', ['x']],
    ['sudo --user=root rm x', 'rm', ['x']],
    ['sudo --preserve-env rm x', 'rm', ['x']],
    ['sudo -- rm x', 'rm', ['x']],
    // After `--` a word that starts with a dash is the command.
    ['sudo -- -x y', '-x', ['y']],
    ['sudo -u root -g wheel -n rm -rf /', 'rm', ['-rf', '/']],
    // env: flags and assignments, a value for -u and -C.
    ['env rm x', 'rm', ['x']],
    ['env -i rm x', 'rm', ['x']],
    ['env -0 -i rm x', 'rm', ['x']],
    ['env FOO=1 BAR=2 rm x', 'rm', ['x']],
    ['env -u FOO rm x', 'rm', ['x']],
    ['env -uFOO rm x', 'rm', ['x']],
    ['env -C /d rm x', 'rm', ['x']],
    ['env --unset FOO rm x', 'rm', ['x']],
    ['env --unset=FOO rm x', 'rm', ['x']],
    ['env --chdir /d rm x', 'rm', ['x']],
    ['env -i -u A -C /d B=1 rm x', 'rm', ['x']],
    ['env -- rm x', 'rm', ['x']],
    // command, builtin, nohup, exec.
    ['command rm x', 'rm', ['x']],
    ['command -p rm x', 'rm', ['x']],
    ['builtin cd x', 'cd', ['x']],
    ['nohup rm x', 'rm', ['x']],
    ['exec rm x', 'rm', ['x']],
    ['exec -a name rm x', 'rm', ['x']],
    ['exec -aname rm x', 'rm', ['x']],
    ['exec -c rm x', 'rm', ['x']],
    // nice, timeout, stdbuf.
    ['nice cat x', 'cat', ['x']],
    ['nice -n5 cat x', 'cat', ['x']],
    ['nice -5 cat x', 'cat', ['x']],
    ['nice --adjustment=5 cat x', 'cat', ['x']],
    ['timeout 5 cat x', 'cat', ['x']],
    ['timeout 5s cat x', 'cat', ['x']],
    ['timeout -k 3 -s KILL 5 cat x', 'cat', ['x']],
    ['timeout -s KILL -k 3 5 cat x', 'cat', ['x']],
    ['timeout -sKILL 5 cat x', 'cat', ['x']],
    ['timeout --signal=KILL 5 cat x', 'cat', ['x']],
    ['timeout --signal KILL --kill-after 3 5 cat x', 'cat', ['x']],
    ['timeout --foreground --preserve-status 5 cat x', 'cat', ['x']],
    ['timeout -- 5 cat x', 'cat', ['x']],
    ['stdbuf -o L cat x', 'cat', ['x']],
    ['stdbuf -i0 -oL -eL cat x', 'cat', ['x']],
    ['stdbuf -i 0 -o 0 -e 0 cat x', 'cat', ['x']],
    ['stdbuf --output=L cat x', 'cat', ['x']],
    ['stdbuf --output L cat x', 'cat', ['x']],
    // time as an external program.
    ['/usr/bin/time -v cat x', 'cat', ['x']],
    ['/usr/bin/time -o out -f %e cat x', 'cat', ['x']],
    ['time -p cat x', 'cat', ['x']],
    // Chains, and a path on a prefix.
    ['sudo env -i FOO=1 nice -n 5 timeout 5 stdbuf -oL /bin/cat x', 'cat', ['x']],
    ['/usr/bin/env FOO=1 /bin/rm x', 'rm', ['x']],
    ['/usr/bin/sudo -u root /bin/rm x', 'rm', ['x']],
    ['./rm x', 'rm', ['x']],
    ['nohup sudo -u root bash -c x', 'bash', ['-c', 'x']],
    // A prefix with nothing after it is the command.
    ['sudo', 'sudo', []],
    ['time', 'time', []],
    ['sudo -u root', 'sudo', ['-u', 'root']],
    ['sudo -u', 'sudo', ['-u']],
    ['env -i', 'env', ['-i']],
    ['env FOO=1', 'env', ['FOO=1']],
    ['timeout 5', 'timeout', ['5']],
    ['timeout', 'timeout', []],
    ['nice -n 5', 'nice', ['-n', '5']],
    ['command', 'command', []],
    ['nohup', 'nohup', []],
    ['A=1 sudo', 'sudo', []],
    ['sudo env', 'env', []],
    ['if env', 'env', []],
    ['do', 'do', []],
    ['!', '!', []],
    ['{', '{', []],
    // env -S hands its string to the shell: env stays the command, and parse() does the rest.
    ['env -S cat', 'env', ['-S', 'cat']],
    ['env -S cat extra', 'env', ['-S', 'cat', 'extra']],
    ['env -i -S cat FOO=1', 'env', ['-i', '-S', 'cat', 'FOO=1']],
    ['sudo env --split-string=cat', 'env', ['--split-string=cat']],
    // Words that only look like prefixes, or are not stripped.
    ['echo sudo rm', 'echo', ['sudo', 'rm']],
    ['xargs rm x', 'xargs', ['rm', 'x']],
    ['find . -exec rm {} ;', 'find', ['.', '-exec', 'rm', '{}', ';']],
    ['RM x', 'RM', ['x']],
    ['Sudo rm x', 'Sudo', ['rm', 'x']],
    ['sudoers x', 'sudoers', ['x']],
    ['dont x', 'dont', ['x']],
    ['export A=1', 'export', ['A=1']],
    // Names that exist on every object must not be taken for prefixes.
    ['constructor x', 'constructor', ['x']],
    ['toString x', 'toString', ['x']],
    ['__proto__ x', '__proto__', ['x']],
    ['hasOwnProperty x', 'hasOwnProperty', ['x']],
    ['sudo --constructor rm x', 'rm', ['x']],
    ['sudo constructor x', 'constructor', ['x']],
    // No command at all.
    ['', '', []],
    ['A=1', '', []],
    ['A=1 B=2', '', []],
  ];
  for (const [text, cmd, args] of rows) {
    // Words are split on single spaces so each row reads like the command it stands for.
    const words = text === '' ? [] : text.split(' ');
    assert.deepEqual(commandOf(words), { cmd, args }, text);
  }
  for (const v of [undefined, null, 'rm x', 7, {}]) assert.deepEqual(commandOf(v), { cmd: '', args: [] }, String(v));

  // Every long option that takes a value, given as `--name VALUE` and as `--name=VALUE`.
  const longValued = {
    sudo: ['user', 'group', 'host', 'prompt', 'close-from', 'chdir', 'role', 'type', 'other-user', 'command-timeout'],
    env: ['unset', 'chdir'],
    nice: ['adjustment'],
    timeout: ['signal', 'kill-after'],
    stdbuf: ['input', 'output', 'error'],
    time: ['output', 'format'],
  };
  for (const [prefix, names] of Object.entries(longValued)) {
    const operand = prefix === 'timeout' ? ['5'] : []; // timeout's duration follows its options
    for (const name of names) {
      for (const opt of [[`--${name}`, 'VAL'], [`--${name}=VAL`]]) {
        const words = [prefix, ...opt, ...operand, 'cat', 'x'];
        assert.deepEqual(commandOf(words), { cmd: 'cat', args: ['x'] }, words.join(' '));
      }
    }
  }
});

test('commandOf on parsed text', () => {
  const via = (cmd) => commandOf(segs(cmd)[0].words);
  assert.deepEqual(via('sudo -u root rm -rf /'), { cmd: 'rm', args: ['-rf', '/'] });
  assert.deepEqual(via('FOO="a b" env -i rm "x y"'), { cmd: 'rm', args: ['x y'] });
  assert.deepEqual(via('\\rm -rf x'), { cmd: 'rm', args: ['-rf', 'x'] });
  assert.deepEqual(via("'/bin/rm' x"), { cmd: 'rm', args: ['x'] });
  assert.deepEqual(via('timeout 5 $(echo cat) x'), { cmd: '', args: ['x'] });
  assert.equal(via('do cat .env').cmd, 'cat');
  assert.deepEqual(segs('for f in a; do cat .env; done').map(cmdOf), ['for', 'cat', 'done']);
  assert.deepEqual(segs('if true; then cat ~/.ssh/id_rsa; fi').map(cmdOf), ['true', 'cat', 'fi']);
});

test('gitCmd', () => {
  assert.deepEqual(gitCmd(['-C', '/r', '-c', 'a=b', '--no-pager', 'merge', 'x']), { sub: 'merge', args: ['x'], dir: '/r' });
  assert.deepEqual(gitCmd(['status']), { sub: 'status', args: [], dir: '' });
  assert.deepEqual(gitCmd(['push', '--force', '-C', 'x', 'origin']), { sub: 'push', args: ['--force', '-C', 'x', 'origin'], dir: '' });

  // -C composes left to right: a relative path extends the previous one, an absolute one replaces it.
  assert.equal(gitCmd(['-C', '/a', '-C', 'b', 'status']).dir, '/a/b');
  assert.equal(gitCmd(['-C', 'a', '-C', 'b', 'status']).dir, 'a/b');
  assert.equal(gitCmd(['-C', '/a', '-C', '/b', 'status']).dir, '/b');
  assert.equal(gitCmd(['-C', 'a', '-C', '/b', '-C', 'c', 'status']).dir, '/b/c');
  assert.equal(gitCmd(['-C', '/r', '-C', '../x', 'status']).dir, '/x');
  assert.equal(gitCmd(['-C', '/r', '-C', '', 'status']).dir, '/r');
  assert.equal(gitCmd(['-C', '/r', 'status', '-C', 'x']).dir, '/r');

  // Each global option is skipped, with its value where it takes one.
  const skipped = [
    ['-c', 'core.pager=cat'],
    ['-c', 'a=b', '-c', 'c=d'],
    ['--no-pager'],
    ['-P'],
    ['-p'],
    ['--paginate'],
    ['--bare'],
    ['--git-dir=/g'],
    ['--git-dir', '/g'],
    ['--work-tree=/w'],
    ['--work-tree', '/w'],
    ['--namespace=n'],
    ['--namespace', 'n'],
    ['--literal-pathspecs'],
    ['--no-optional-locks'],
    ['--no-replace-objects'],
    ['-C', '/r', '--git-dir', '/g', '-c', 'a=b', '--bare', '-P', '--no-pager'],
  ];
  for (const opts of skipped) {
    const g = gitCmd([...opts, 'merge', 'x']);
    assert.equal(g.sub, 'merge', opts.join(' '));
    assert.deepEqual(g.args, ['x'], opts.join(' '));
  }
  // The value of -c, --git-dir, --work-tree and --namespace is not the subcommand, even when it looks like one.
  assert.equal(gitCmd(['-c', 'push', 'status']).sub, 'status');
  assert.equal(gitCmd(['--git-dir', 'push', 'status']).sub, 'status');
  assert.equal(gitCmd(['--work-tree', 'push', 'status']).sub, 'status');
  assert.equal(gitCmd(['--namespace', 'push', 'status']).sub, 'status');
  assert.equal(gitCmd(['-C', 'push', 'status']).sub, 'status');

  // No subcommand.
  assert.deepEqual(gitCmd([]), { sub: '', args: [], dir: '' });
  assert.deepEqual(gitCmd(['--version']), { sub: '', args: [], dir: '' });
  assert.deepEqual(gitCmd(['-C', '/r']), { sub: '', args: [], dir: '/r' });
  assert.deepEqual(gitCmd(['-c']), { sub: '', args: [], dir: '' });
  for (const v of [undefined, null, 'merge', 3]) assert.deepEqual(gitCmd(v), { sub: '', args: [], dir: '' }, String(v));

  // The usual route: commandOf finds `git` behind a prefix, gitCmd reads what follows.
  const { cmd, args } = commandOf(segs('sudo -u root git -C /r -c a=b --no-pager merge x')[0].words);
  assert.equal(cmd, 'git');
  assert.deepEqual(gitCmd(args), { sub: 'merge', args: ['x'], dir: '/r' });
});

test('commandOf and gitCmd never throw', () => {
  const pool = ['sudo', 'env', '-S', '-u', '-C', '-c', '-n', '-', '--', '', 'timeout', 'time', 'stdbuf', '-o', 'nice', 'exec', 'git',
    '--git-dir', '--user=', 'A=', 'do', '!', 'x', '=', '/', '-5', '--x=y'];
  let seed = 0x91;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 3000; n++) {
    const words = [];
    for (let k = Math.floor(rand() * 10); k > 0; k--) words.push(pool[Math.floor(rand() * pool.length)]);
    const c = commandOf(words);
    assert.equal(typeof c.cmd, 'string', words.join(' '));
    assert.ok(Array.isArray(c.args) && c.args.every((a) => typeof a === 'string'), words.join(' '));
    const g = gitCmd(words);
    assert.equal(typeof g.sub, 'string', words.join(' '));
    assert.equal(typeof g.dir, 'string', words.join(' '));
    assert.ok(Array.isArray(g.args), words.join(' '));
  }
});
