'use strict';
// Tests for the parser layer of hooks/lib/shell-words.js: parse() re-reads the places where a
// command hides another command (substitutions, `sh -c`, `eval`, `xargs`, `find -exec`) and fails
// closed on what it does not model (`env -S`, an option a prefix command or xargs table does not
// know, a word env or sudo would take for an assignment but the shell would not, depth, size): those
// are marked unparsed, never guessed at. commandOf() finds the command word behind prefixes like
// `sudo` and `env`, and gitCmd() skips git's global options. Every test drives the real functions
// on real command text.
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
  // A segment that hides nothing unread says so: `unparsed` is null, not missing.
  assert.equal(top.unparsed, null);
  assert.equal(sub.unparsed, null);
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

test('env -S is not read: its segment is unparsed and has no child', () => {
  // env splits STR by rules of its own, not the shell's, and the words after STR join it. The parser
  // does not emulate that. It keeps the env segment, marks it `unparsed: 'env -S'` (and the parse
  // result with it) and never scans STR for commands, so a wrong reading cannot hide one. The guard
  // turns the mark into an ask.
  const envOnly = (cmd) => {
    const r = parse(cmd);
    assert.equal(r.unparsed, 'env -S', cmd);
    const shown = r.segments.map((s) => s.words.join(' ')).join(' / ');
    assert.equal(r.segments.length, 1, `${JSON.stringify(cmd)}: expected no child segment, got ${shown}`);
    const [env] = r.segments;
    assert.equal(cmdOf(env), 'env', cmd);
    assert.equal(env.unparsed, 'env -S', cmd);
    assert.equal(env.via, 'top', cmd);
    return env;
  };

  // Every spelling of -S: alone, clustered, attached, joined, long, and abbreviated the way GNU
  // getopt allows (`--split` is `--split-string`).
  for (const cmd of [
    "env -S 'cat x'",
    "env -i -S 'cat x'",
    "env -S'cat x'",
    "env -iS 'cat x'",
    "env -i0S 'cat x'",
    "env -iS'cat x'",
    "env --split-string='cat x'",
    "env --split-string 'cat x'",
    "env --split='cat x'",
    "env --split 'cat x'",
    "env --split-str='cat x'",
    "env --s 'cat x'",
    "sudo env -S 'cat x'",
    "sudo -u root env -i -S 'cat x'",
    "nohup env -S 'cat x'",
    "FOO=1 env -S 'cat x'",
    "env -u FOO -S'cat x' y",
    "env -i env -S 'cat x'",
    // With words after STR, which env appends to the split string, and with odd STR.
    'env -S cat ~/.ssh/id_rsa',
    "env -S 'cat x' y z",
    "env -S '' rm -rf ~",
    "env -S 'FOO=1' cat x",
    'env -S cat -u x',
    'env -S cat -- x',
    'env -S cat -S x ~/.ssh/id_rsa',
    "env -S '-i cat' x",
    "env -S ''",
    "env -S '#c'",
    // An empty or comment-only STR followed by env's own options (env re-reads them).
    "env -S '' -i cat /x/f",
    "env -S ' ' -u FOO cat /x/f",
    "env -S '#c' -i cat /x/f",
    "env -S '\\c' -- cat /x/f",
    "env -S '' -i -u A cat /x/f",
  ]) envOnly(cmd);

  // Characters a shell reads as comments, redirects, pipes or separators are plain text inside the
  // quoted STR, and nothing turns them into a second segment or a redirect.
  for (const cmd of [
    "env -S 'cat #' ~/.ssh/id_rsa",
    "env -S 'cat #c' ~/.ssh/id_rsa",
    "env -S 'cat a #c' x",
    "env -S 'cat\n' ~/.ssh/id_rsa",
    "env -S 'cat >' x",
    "env -S 'cat <' ~/.ssh/id_rsa",
    "env -S 'cat |' x",
    "env -S 'cat &' x",
    "env -S 'cat (' x",
    "env -S 'cat a;b' x",
    "env -S 'cat \\c' x",
    "env -S 'cat \"#\" x'",
    "env -S 'cat x#y' z",
    "env -S 'cat a\\_b' x",
    "env -S 'cat \"a\\\"b\" c'",
    "env -S cat ';' '>' x",
  ]) {
    const env = envOnly(cmd);
    assert.deepEqual(env.redirects, [], cmd);
  }

  // A backslash inside single quotes in STR: env keeps `\'` inside the quote, a shell closes it.
  // Whichever is right, the parser does not choose: no `cat` segment, and the key path stays an
  // operand of the unparsed env segment instead of vanishing into a comment.
  const key = envOnly('env -S "cat \'\\\' #\' ~/.ssh/id_rsa"');
  assert.deepEqual(key.words, ['env', '-S', "cat '\\' #' ~/.ssh/id_rsa"]);
  assert.deepEqual(envOnly('env -S "cat \'\\\' #" some/key/file').words, ['env', '-S', "cat '\\' #", 'some/key/file']);
  assert.deepEqual(envOnly('env -S "PA \'a\\\'b c\'" z').words, ['env', '-S', "PA 'a\\'b c'", 'z']);
  assert.deepEqual(envOnly('env -S "PA x \'a\\\' b\'" z').words, ['env', '-S', "PA x 'a\\' b'", 'z']);
  assert.deepEqual(envOnly('env -S "PA \'\\\\\' b" z').words, ['env', '-S', "PA '\\' b", 'z']);

  // Nested inside anything that runs text or words, the env segment is still marked and still has
  // no child, and the segments around it are not marked.
  for (const [cmd, via] of [
    ["bash -c \"env -S 'cat x'\"", 'shell-c'],
    ["sh -lc \"env -S 'cat x'\"", 'shell-c'],
    ["eval \"env -S 'cat x'\"", 'shell-c'],
    ["echo $(env -S 'cat x')", 'subst'],
    ["echo `env -S 'cat x'`", 'subst'],
    ["xargs env -S 'cat x'", 'xargs'],
    ["find . -exec env -S 'cat x' {} \\;", 'find-exec'],
    ["find . -exec env -S 'cat x' {} +", 'find-exec'],
    ["sh -c 'if true; then env -S \"cat x\"; fi'", 'shell-c'],
  ]) {
    const r = parse(cmd);
    assert.equal(r.unparsed, 'env -S', cmd);
    const env = r.segments.find((s) => cmdOf(s) === 'env');
    assert.ok(env, cmd);
    assert.equal(env.via, via, cmd);
    assert.equal(env.unparsed, 'env -S', cmd);
    assert.ok(r.segments.every((s) => cmdOf(s) !== 'cat'), cmd);
    assert.ok(r.segments.every((s) => s.parent !== env.position), `${cmd}: env has a child`);
    assert.deepEqual(r.segments.filter((s) => s !== env && s.unparsed !== null), [], cmd);
  }

  // The parse result keeps the first reason it saw; the env segment is marked either way.
  assert.equal(parse('env -S x ; ' + nest(4, 'x', bashC)).unparsed, 'env -S');
  const late = parse(nest(4, 'x', bashC) + ' ; env -S x');
  assert.equal(late.unparsed, 'depth');
  assert.equal(late.segments.filter((s) => s.unparsed === 'env -S').length, 1);
  const padded = parse('env -S x ' + ' '.repeat(70000));
  assert.equal(padded.unparsed, 'size');
  assert.equal(padded.segments[0].unparsed, 'env -S');

  // No -S, no mark: env just runs its command, and an S that is a value or a command word is not -S.
  for (const cmd of [
    'env -u FOO cat x',
    'env -i',
    'env -i FOO=1 cat x',
    'env -u Scat x',
    'env -uS cat x',
    'env --unset=S cat x',
    'env cat -S x',
    'env -- -S x',
    'env -u -S x cat',
    'echo env -S x',
    'cat x',
  ]) {
    const r = parse(cmd);
    assert.equal(r.unparsed, null, cmd);
    assert.ok(r.segments.every((s) => s.unparsed === null), cmd);
  }
});

// The one segment `parse(cmd)` marks unparsed: the segment, the parse result and the reason agree,
// and no child hangs under it. Returns the marked segment.
const unreadBy = (cmd, reason) => {
  const r = parse(cmd);
  assert.equal(r.unparsed, reason, cmd);
  const marked = r.segments.filter((s) => s.unparsed !== null);
  assert.equal(marked.length, 1, `${JSON.stringify(cmd)}: expected one unparsed segment, got ${marked.length}`);
  assert.equal(marked[0].unparsed, reason, cmd);
  assert.ok(r.segments.every((s) => s.parent !== marked[0].position), `${JSON.stringify(cmd)}: the unparsed segment has a child`);
  return marked[0];
};

test('an env option outside the modeled set is unparsed, whatever follows (round-5 repros)', () => {
  // Round 5: an option the table did not know was read as a flag with no value, so the value of a
  // real valued option became the command word and a later -S was never seen. Each of these is
  // marked now, and the env segment keeps `env` as its command word instead of `x`, `FOO` or `tmp`.
  const rows = [
    ["env -a x -S 'echo hi'", '-a'],
    ["env --argv0 x -S 'echo hi'", '--argv0'],
    ["env -i -a x -S 'echo hi'", '-a'],
    ["env --uns FOO -S 'echo hi'", '--uns'],
    ["env --unse FOO -S 'echo hi'", '--unse'],
    ["env --ch /tmp -S 'echo hi'", '--ch'],
    ["env --chd /tmp -S 'echo hi'", '--chd'],
  ];
  for (const [cmd, opt] of rows) {
    const r = parse(cmd);
    assert.notEqual(r.unparsed, null, cmd);
    const env = unreadBy(cmd, `unknown option ${opt} for env`);
    assert.equal(cmdOf(env), 'env', cmd);
    assert.equal(r.segments.length, 1, cmd);
    assert.equal(env.via, 'top', cmd);
  }
  // The same with a deny-tier read behind the unread option: still one unparsed env segment.
  for (const cmd of ["env -a x -S 'cat ~/.ssh/id_rsa'", 'env -P /usr/bin -S cat ~/.ssh/id_rsa', 'env -C /d cat ~/.ssh/id_rsa']) {
    const r = parse(cmd);
    assert.notEqual(r.unparsed, null, cmd);
    assert.deepEqual(r.segments.map(cmdOf), ['env'], cmd);
  }
});

test('env: only -i -0 -v -u, their long forms, a bare -, and assignments are modeled', () => {
  // Modeled: read exactly, nothing marked, and the command word found behind them.
  for (const cmd of [
    'env -i cat y',
    'env --ignore-environment cat y',
    'env -0 cat y',
    'env --null cat y',
    'env -v cat y',
    'env --debug cat y',
    'env -u FOO cat y',
    'env -uFOO cat y',
    'env --unset=FOO cat y',
    'env - cat y',
    'env - FOO=1 cat y',
    'env FOO=1 cat y',
    'env -iv0 cat y',
    'env -0v -i cat y',
    'env -i -u A -u B C=1 cat y',
    'env -- cat y',
    'env -i -- cat y',
    '/usr/bin/env -i cat y',
  ]) {
    const r = parse(cmd);
    assert.equal(r.unparsed, null, cmd);
    assert.deepEqual(commandOf(r.segments[0].words), { cmd: 'cat', args: ['y'] }, cmd);
  }
  // Everything else is unparsed: other options, combined flags with a letter outside i0v (-u is
  // modeled only as a word of its own), abbreviations of the long forms, GNU and BSD extras.
  const outside = [
    ['env -C /d cat y', '-C'],
    ['env -C/d cat y', '-C'],
    ['env --chdir /d cat y', '--chdir'],
    ['env --chdir=/d cat y', '--chdir'],
    ['env -a x cat y', '-a'],
    ['env -ax cat y', '-a'],
    ['env --argv0 x cat y', '--argv0'],
    ['env --argv0=x cat y', '--argv0'],
    ['env -P /usr/bin cat y', '-P'],
    ['env -x cat y', '-x'],
    ['env -ia x cat y', '-a'],
    ['env -iC /d cat y', '-C'],
    ['env -0x cat y', '-x'],
    ['env -iu FOO cat y', '-u'],
    ['env -vu FOO cat y', '-u'],
    ['env -iuFOO cat y', '-u'],
    ['env --ignore cat y', '--ignore'],
    ['env --ignore-env cat y', '--ignore-env'],
    ['env --nul cat y', '--nul'],
    ['env --null=1 cat y', '--null'],
    ['env --deb cat y', '--deb'],
    ['env --uns FOO cat y', '--uns'],
    // BSD env has no long options, so for `--unset NAME` it runs NAME as the command; only `=NAME` is read.
    ['env --unset FOO cat y', '--unset'],
    ['env --unset cat y', '--unset'],
    ['env --u FOO cat y', '--u'],
    ['env --unse=FOO cat y', '--unse'],
    ['env --c /d cat y', '--c'],
    ['env --help', '--help'],
    ['env --version', '--version'],
    ['env --constructor cat y', '--constructor'],
    ['env - -i cat y', '-i'],
    ['env - -- cat y', '--'],
    ['env - -u FOO cat y', '-u'],
    ['env -i - -x cat y', '-x'],
    ['env -- - cat y', '-'],
    ['env -i -- - cat y', '-'],
    ['env -i -- -x cat y ; env -i -x cat y', '-x'],
  ];
  for (const [cmd, opt] of outside) {
    const r = parse(cmd);
    assert.equal(r.unparsed, `unknown option ${opt} for env`, cmd);
    assert.ok(r.segments.some((s) => s.unparsed === r.unparsed && cmdOf(s) === 'env'), cmd);
  }
  // -S keeps its own reason, however it is spelled, and whichever of two problems comes first wins.
  assert.equal(parse("env -i -S 'cat y'").unparsed, 'env -S');
  assert.equal(parse("env -iS 'cat y'").unparsed, 'env -S');
  assert.equal(parse("env --split 'cat y'").unparsed, 'env -S');
  assert.equal(parse("env -C /d -S 'cat y'").unparsed, 'unknown option -C for env');
  assert.equal(parse("env -S 'cat y' -C /d").unparsed, 'env -S');
  // An option after the command word is the command's, not env's.
  assert.equal(parse('env cat -C /d').unparsed, null);
  assert.equal(parse('env FOO=1 -C').unparsed, null);
  assert.equal(parse('env -- -C').unparsed, null);
  assert.equal(parse('env -u -C cat').unparsed, null);
});

test('env and sudo: a word with a = that is not a valid assignment is not read', () => {
  // Real env (GNU and BSD) takes every word that contains a `=` for an assignment, so `env a-b=1 cat
  // y` runs cat. Only valid names are stripped here, so the other words are marked, not mistaken for
  // the command word.
  for (const [cmd, word, name] of [
    ['env a-b=1 cat y', 'a-b=1', 'env'],
    ['env a.b=c cat y', 'a.b=c', 'env'],
    ['env 1x=2 cat y', '1x=2', 'env'],
    ['env =x cat y', '=x', 'env'],
    ['env FOO=1 --x=1 cat y', '--x=1', 'env'],
    ['env -- --chdir=/d cat y', '--chdir=/d', 'env'],
    ['env FOO=1 a-b=2 cat y', 'a-b=2', 'env'],
    ['env -u FOO a-b=2 cat y', 'a-b=2', 'env'],
    ['sudo a-b=1 cat y', 'a-b=1', 'sudo'],
    ['sudo -u root A=1 --x=1 cat y', '--x=1', 'sudo'],
    ['nohup env a-b=1 cat y', 'a-b=1', 'env'],
    ['env -i sudo a-b=1 cat y', 'a-b=1', 'sudo'],
  ]) {
    const seg = unreadBy(cmd, `unknown assignment ${word} for ${name}`);
    assert.equal(cmdOf(seg), name, cmd);
  }
  // Valid assignments are stripped, and an `=` after the command word belongs to the command.
  for (const cmd of ['env A=1 cat y', 'env A= B+=2 _C=3 cat y', 'sudo A=1 cat y', 'env cat a-b=1', 'env -- cat --x=1', 'sudo cat a-b=1']) {
    const r = parse(cmd);
    assert.equal(r.unparsed, null, cmd);
    assert.equal(cmdOf(r.segments[0]), 'cat', cmd);
  }
  // Without env or sudo it is the shell's rule: a word that is not a valid assignment is the command.
  assert.equal(parse('a-b=1 cat y').unparsed, null);
  assert.equal(cmdOf(segs('a-b=1 cat y')[0]), 'a-b=1');
  assert.equal(parse('nice a-b=1 cat y').unparsed, null);
});

test('env: no option outside the modeled set is ever read by a guess', () => {
  // A reference reading of env's modeled grammar, written out independently of the parser. For any
  // run of words: if it stays inside the grammar the parser must find the same command word and
  // leave it unmarked; if it steps outside, the parser must mark it. Silent and wrong never happens.
  const pool = ['-i', '-0', '-v', '-iv0', '-u', '-uFOO', '--unset', '--unset=FOO', '-', '--', 'A=1', '--ignore-environment', '--null',
    '--debug', 'FOO', 'cat', 'x', '-a', '--argv0', '-C', '--chdir', '--chdir=/d', '-S', '--split-string', '--split', '--uns', '--ch',
    '-ia', '-iC', '-iu', '--nul', '-P', '-x', '--ignore', '--help', '-v0', 'a-b=1', '=x', 'B+=2'];
  const modeled = (words) => {
    let i = 0;
    for (; i < words.length; i++) {
      const w = words[i];
      if (w === '--') {
        if (words[i + 1] === '-') return null; // GNU env reads that `-` as -i, BSD env runs it
        i++;
        break;
      }
      if (w === '-') {
        // GNU and BSD env disagree about an option-like word after a bare `-`.
        if (i + 1 < words.length && words[i + 1].length > 1 && words[i + 1][0] === '-') return null;
        continue;
      }
      if (/^-[i0v]+$/.test(w) || ['--ignore-environment', '--null', '--debug', '--unset=FOO'].includes(w)) continue;
      if (w === '-u') { i++; continue; }
      if (w === '--unset') return null;
      if (/^-u./.test(w)) continue;
      if (w.length > 1 && w[0] === '-') return null;
      break;
    }
    // Real env takes any word with a `=` for an assignment; only valid names are inside the model.
    for (; i < words.length && words[i].includes('='); i++) if (!/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(words[i])) return null;
    return i < words.length ? words[i].slice(words[i].lastIndexOf('/') + 1) : 'env';
  };
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let inside = 0;
  let outside = 0;
  for (let n = 0; n < 4000; n++) {
    const words = [];
    for (let k = Math.floor(rand() * 7); k > 0; k--) words.push(pool[Math.floor(rand() * pool.length)]);
    const text = 'env ' + words.map(shq).join(' ');
    const r = parse(text);
    const want = modeled(words);
    if (want === null) {
      outside++;
      assert.notEqual(r.unparsed, null, text);
    } else {
      inside++;
      assert.equal(r.unparsed, null, text);
      assert.equal(commandOf(['env', ...words]).cmd, want, text);
    }
  }
  assert.ok(inside > 300 && outside > 300, `the pool must exercise both sides (${inside} inside, ${outside} outside)`);
});

test('every prefix command and xargs fails closed at the option level', () => {
  // An option outside the command's table, or a long option given as an abbreviation, makes the
  // segment unparsed with `unknown option <opt> for <cmd>`. Nothing behind it is read: a guess at
  // whether the option takes a value would put the wrong word in command position.
  const rows = [
    // [command, option named in the reason, command named in the reason]
    ['sudo -R /x env -S "cat y"', '-R', 'sudo'],
    ['sudo --chroot /x cat y', '--chroot', 'sudo'],
    ['sudo --use root cat y', '--use', 'sudo'],
    ['sudo --user= --pass x cat y', '--pass', 'sudo'],
    ['sudo -a bsd cat y', '-a', 'sudo'],
    ['sudo -u root -c class cat y', '-c', 'sudo'],
    ['sudo --login=x cat y', '--login', 'sudo'],
    ['timeout -x 5 cat y', '-x', 'timeout'],
    ['timeout --sig KILL 5 cat y', '--sig', 'timeout'],
    ['timeout --kill 3 5 cat y', '--kill', 'timeout'],
    ['timeout --foreg 5 cat y', '--foreg', 'timeout'],
    ['nice -x cat y', '-x', 'nice'],
    ['nice --adj 5 cat y', '--adj', 'nice'],
    ['nice --5 cat y', '--5', 'nice'],
    ['nohup -x cat y', '-x', 'nohup'],
    ['nohup --version', '--version', 'nohup'],
    ['time -x cat y', '-x', 'time'],
    ['time --out f cat y', '--out', 'time'],
    ['command -x cat y', '-x', 'command'],
    ['command --help', '--help', 'command'],
    ['builtin -x cd y', '-x', 'builtin'],
    ['exec -x cat y', '-x', 'exec'],
    ['exec -cx cat y', '-x', 'exec'],
    ['stdbuf -x L cat y', '-x', 'stdbuf'],
    ['stdbuf --out L cat y', '--out', 'stdbuf'],
    ['stdbuf -oL --err L cat y', '--err', 'stdbuf'],
    ['xargs -J{} cat y', '-J', 'xargs'],
    ['xargs -i cat {}', '-i', 'xargs'],
    ['xargs -0 -R 3 cat y', '-R', 'xargs'],
    ['xargs --max-arg 1 cat y', '--max-arg', 'xargs'],
    ['xargs --process-slot-var X cat y', '--process-slot-var', 'xargs'],
    ['xargs -rx --nul cat y', '--nul', 'xargs'],
    // Behind other prefixes, so the chain stops at the first option it cannot read.
    ['sudo -u root nice --adj 5 cat y', '--adj', 'nice'],
    ['nohup sudo -R /x cat y', '-R', 'sudo'],
    ['env -i sudo -R /x cat y', '-R', 'sudo'],
    ['FOO=1 time -x cat y', '-x', 'time'],
    ['if ! timeout -x 5 cat y', '-x', 'timeout'],
    ['sudo xargs -J{} cat y', '-J', 'xargs'],
    ['/usr/bin/xargs -R 3 cat y', '-R', 'xargs'],
  ];
  for (const [cmd, opt, name] of rows) {
    const seg = unreadBy(cmd, `unknown option ${opt} for ${name}`);
    // No command word was guessed: the segment's command is the prefix that stopped the scan (or xargs).
    assert.equal(cmdOf(seg), name, cmd);
  }
  // A long option name cut by one letter is never read as the option.
  for (const [prefix, names, operand] of [
    ['sudo', ['user', 'group', 'host', 'prompt', 'close-from', 'chdir', 'role', 'type', 'other-user', 'command-timeout', 'preserve-env', 'askpass', 'login'], ''],
    ['env', ['unset', 'ignore-environment', 'null', 'debug'], ''],
    ['nice', ['adjustment'], ''],
    ['timeout', ['signal', 'kill-after', 'foreground', 'preserve-status', 'verbose'], '5'],
    ['stdbuf', ['input', 'output', 'error'], ''],
    ['time', ['output', 'format', 'verbose'], ''],
    ['xargs', ['arg-file', 'delimiter', 'max-args', 'max-procs', 'max-chars', 'replace', 'max-lines', 'eof', 'null', 'verbose'], ''],
  ]) {
    for (const name of names) {
      const cut = name.slice(0, -1);
      const cmd = `${prefix} --${cut} V ${operand} cat y`;
      assert.equal(parse(cmd).unparsed, `unknown option --${cut} for ${prefix}`, cmd);
    }
  }
  // The same inside every place a command can hide: each marks its own segment.
  for (const [cmd, via, reason] of [
    ['bash -c "sudo -R /x cat y"', 'shell-c', 'unknown option -R for sudo'],
    ['sh -lc "env -a x -S \'cat y\'"', 'shell-c', 'unknown option -a for env'],
    ['eval "nice -x cat y"', 'shell-c', 'unknown option -x for nice'],
    ['echo $(timeout --sig K 5 cat y)', 'subst', 'unknown option --sig for timeout'],
    ['echo `env -C /d cat y`', 'subst', 'unknown option -C for env'],
    ['xargs env -C /d cat y', 'xargs', 'unknown option -C for env'],
    ['xargs -0 sudo -R /x cat y', 'xargs', 'unknown option -R for sudo'],
    ['find . -exec env -a x -S "cat y" {} \\;', 'find-exec', 'unknown option -a for env'],
    ['find . -execdir sudo -R /x cat {} +', 'find-exec', 'unknown option -R for sudo'],
    ['find . -ok nohup -x cat {} \\;', 'find-exec', 'unknown option -x for nohup'],
    ["sh -c 'find . -exec xargs -J{} cat {} \\;'", 'find-exec', 'unknown option -J for xargs'],
  ]) {
    assert.equal(unreadBy(cmd, reason).via, via, cmd);
  }
  // The first reason stays, and the segments around the marked ones are not marked.
  const mixed = parse('ls ; sudo -R /x cat y ; env -a x cat z ; cat w');
  assert.equal(mixed.unparsed, 'unknown option -R for sudo');
  assert.deepEqual(mixed.segments.map((s) => s.unparsed), [null, 'unknown option -R for sudo', 'unknown option -a for env', null]);
  // A long option word is cut in the reason; the segment is marked all the same.
  const long = parse('env --' + 'x'.repeat(5000) + ' cat y');
  assert.match(long.unparsed, /^unknown option --x+ for env$/);
  assert.ok(long.unparsed.length < 80);
});

test('options a prefix command or xargs does know are read, not flagged', () => {
  // Value-less options, long and short, clustered and not. None may be flagged, and the command
  // word must be the one behind them.
  for (const cmd of [
    'sudo -A -B -b -E -e -H -i -K -k -l -n -P -S -s -V -v cat y',
    'sudo -nEHk cat y',
    'sudo --askpass --background --bell --edit --set-home --login --remove-timestamp --reset-timestamp --list cat y',
    'sudo --non-interactive --preserve-groups --stdin --shell --validate --help --version cat y',
    'sudo --preserve-env cat y',
    'sudo --preserve-env=PATH cat y',
    'timeout -f -p -v 5 cat y',
    'timeout -fpv 5 cat y',
    'timeout --foreground --preserve-status --verbose 5 cat y',
    'nice -n -5 cat y',
    'nice -10 cat y',
    'time -a -h -l -p -q -v cat y',
    'time --append --portability --verbose --quiet cat y',
    'command -p cat y',
    'command -pvV cat y',
    'exec -c -l cat y',
    'exec -cl -a name cat y',
    'stdbuf -iL -o0 -e 0 cat y',
    'nohup cat y',
    'builtin cat y',
    'sudo -- cat y',
    'timeout -- 5 cat y',
  ]) {
    const r = parse(cmd);
    assert.equal(r.unparsed, null, cmd);
    assert.equal(commandOf(r.segments[0].words).cmd, 'cat', cmd);
  }
  for (const cmd of [
    'xargs -0 -o -p -r -t -x cat y',
    'xargs -0oprtx cat y',
    'xargs --null --open-tty --interactive --no-run-if-empty --verbose --exit cat y',
    'xargs --replace=R --max-lines=2 --eof=E --max-args=1 --max-procs=2 --max-chars=9 --delimiter=, --arg-file=f cat y',
    'xargs -I R -L 2 -n 1 -P 2 -d , -E E -s 9 -a f cat y',
    'xargs -- cat y',
  ]) {
    const r = parse(cmd);
    assert.equal(r.unparsed, null, cmd);
    assert.deepEqual(r.segments.find((s) => s.via === 'xargs').words, ['cat', 'y'], cmd);
  }
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
  // Every reason parse() may report: a limit, env -S, or an option a prefix command does not know.
  const reasonOk = (u) => u === null || ['size', 'depth', 'env -S'].includes(u)
    || /^unknown (option|assignment) [^]+ for (sudo|env|command|builtin|nohup|exec|nice|timeout|stdbuf|time|xargs)$/.test(u);
  const pieces = ['bash -c', 'sh -lc', 'eval', 'env -S', 'env -a', 'sudo -R', 'nice --adj', 'xargs', 'xargs -I{}', 'xargs -J', 'find .',
    '-exec', '-execdir', '\\;', '+', '{}', '$(', ')', '`', '"', "'", ';', '|', '&&', '\n', '<<E', 'E', 'cat', '.env', 'echo', 'sudo', 'x',
    ' ', ' ', ' ', '-c', '$((', '))'];
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
    assert.ok(reasonOk(r.unparsed), ctx);
    // A marked segment always shows in the parse result, so a caller that checks only that is safe.
    if (r.segments.some((s) => s.unparsed !== null)) assert.notEqual(r.unparsed, null, ctx);
    r.segments.forEach((s, i) => {
      assert.ok(reasonOk(s.unparsed) && s.unparsed !== 'size' && s.unparsed !== 'depth', ctx);
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
    'env ' + '-i '.repeat(20000) + 'cat x',
    'sudo ' + '-u x '.repeat(10000) + 'cat x',
    'nice --adj 5 '.repeat(12000),
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
    ['env --unset=FOO rm x', 'rm', ['x']],
    ['env -i -u A B=1 rm x', 'rm', ['x']],
    ['env -- rm x', 'rm', ['x']],
    // The rest of env's modeled set: -v and -0 and their long forms, clusters of i0v, a bare `-`.
    ['env -v rm x', 'rm', ['x']],
    ['env --ignore-environment --null --debug rm x', 'rm', ['x']],
    ['env -iv0 rm x', 'rm', ['x']],
    ['env - rm x', 'rm', ['x']],
    ['env - FOO=1 rm x', 'rm', ['x']],
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
    // env -S is not read: env stays the command, with every word after it as an argument, and
    // parse() marks the segment unparsed. The long form may be abbreviated, as GNU getopt allows.
    ['env -S cat', 'env', ['-S', 'cat']],
    ['env -S cat extra', 'env', ['-S', 'cat', 'extra']],
    ['env -i -S cat FOO=1', 'env', ['-i', '-S', 'cat', 'FOO=1']],
    ['env -iScat x', 'env', ['-iScat', 'x']],
    ['sudo env --split-string=cat', 'env', ['--split-string=cat']],
    ['env --split=cat x', 'env', ['--split=cat', 'x']],
    ['env --split cat x', 'env', ['--split', 'cat', 'x']],
    ['env --s cat x', 'env', ['--s', 'cat', 'x']],
    // Not -S: a value of -u, or a word after the command.
    ['env -u S cat x', 'cat', ['x']],
    ['env cat -S x', 'cat', ['-S', 'x']],
    // An option outside a prefix's table is not read by a guess. The prefix stays the command with
    // every word after it as `args`, and parse() marks the segment unparsed (as for env -S).
    ['env -C /d rm x', 'env', ['-C', '/d', 'rm', 'x']],
    ['env --chdir /d rm x', 'env', ['--chdir', '/d', 'rm', 'x']],
    ['env -C S cat x', 'env', ['-C', 'S', 'cat', 'x']],
    ['env --unset FOO cat x', 'env', ['--unset', 'FOO', 'cat', 'x']],
    ['env -i -u A -C /d B=1 rm x', 'env', ['-i', '-u', 'A', '-C', '/d', 'B=1', 'rm', 'x']],
    ['env -a x -S cat', 'env', ['-a', 'x', '-S', 'cat']],
    ['env --argv0 x cat', 'env', ['--argv0', 'x', 'cat']],
    ['env --uns FOO cat x', 'env', ['--uns', 'FOO', 'cat', 'x']],
    ['env -iu FOO cat x', 'env', ['-iu', 'FOO', 'cat', 'x']],
    // After a bare `-` GNU env stops reading options and BSD env goes on, so an option-like word
    // there is not read either way.
    ['env - -i rm x', 'env', ['-', '-i', 'rm', 'x']],
    // env and sudo take any word with a `=` for an assignment; only valid names are stripped.
    ['env a-b=1 rm x', 'env', ['a-b=1', 'rm', 'x']],
    ['sudo -u root a.b=1 rm x', 'sudo', ['-u', 'root', 'a.b=1', 'rm', 'x']],
    ['sudo -R /x rm y', 'sudo', ['-R', '/x', 'rm', 'y']],
    ['sudo -u root nice --adj 5 cat x', 'nice', ['--adj', '5', 'cat', 'x']],
    ['timeout --sig KILL 5 cat x', 'timeout', ['--sig', 'KILL', '5', 'cat', 'x']],
    ['nice -x cat y', 'nice', ['-x', 'cat', 'y']],
    ['nohup -x cat y', 'nohup', ['-x', 'cat', 'y']],
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
    // `--constructor` is not a valued long option of sudo (an inherited property is not an entry), so
    // it is an unknown option and does not swallow `rm`.
    ['sudo --constructor rm x', 'sudo', ['--constructor', 'rm', 'x']],
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
