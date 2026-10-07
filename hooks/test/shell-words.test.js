'use strict';
// Tests for hooks/lib/shell-words.js: the quote-aware tokenizer the guard hook uses to see
// which words a Bash command really contains. Every test drives the real scan(); the point of
// the tokenizer is that a name inside quotes, a comment or a heredoc body is not a word, and
// that a name hidden behind an escape, a subshell or a substitution still is.
//
// Corpus tables stay inline in this file: `node --test` runs any non-test .js under hooks/test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const { scan } = require('../lib/shell-words.js');

const words = (cmd) => scan(cmd).segments.map((s) => s.words);
const allWords = (cmd) => scan(cmd).segments.flatMap((s) => s.words);
const substs = (cmd) => scan(cmd).segments.flatMap((s) => s.substs);
// `echo $(...$(x)...)` nested k levels deep, balanced.
const nested = (k) => 'echo ' + '$('.repeat(k) + 'x' + ')'.repeat(k);

test('splits outside quotes', () => {
  const { segments, overflow } = scan('echo "a;b" && ls | wc -l');
  assert.equal(overflow, false);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].words[1], 'a;b');
  assert.deepEqual(segments.map((s) => s.pipeline), [0, 1, 1]);
  assert.deepEqual(words('echo "a;b" && ls | wc -l'), [['echo', 'a;b'], ['ls'], ['wc', '-l']]);
});

test('every unquoted separator ends a segment; only pipes share a pipeline', () => {
  const r = scan('a; b && c || d | e |& f & g\nh');
  assert.deepEqual(r.segments.map((s) => s.words[0]), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(r.segments.map((s) => s.pipeline), [0, 1, 2, 3, 3, 3, 4, 5]);
});

test('quotes are removed and their content stays one word', () => {
  assert.deepEqual(words(`echo 'a;b' "c d"`), [['echo', 'a;b', 'c d']]);
  assert.deepEqual(words(`echo 'a"b' "a'b"`), [['echo', 'a"b', "a'b"]]);
  assert.deepEqual(words(`echo '' x`), [['echo', '', 'x']]);
  assert.deepEqual(words(`echo a"b c"'d e'f`), [['echo', 'ab cd ef']]);
  assert.deepEqual(words('FOO="a b" cmd'), [['FOO=a b', 'cmd']]);
});

test('double quotes escape only $ ` " \\ and newline; single quotes escape nothing', () => {
  assert.deepEqual(words(String.raw`echo "a\"b\$c\\d\e"`), [['echo', String.raw`a"b$c\d\e`]]);
  assert.deepEqual(words('echo "a\\\nb"'), [['echo', 'ab']]);
  assert.deepEqual(words("echo 'a\\\nb'"), [['echo', 'a\\\nb']]);
  assert.deepEqual(words(String.raw`echo 'a\'b`), [['echo', String.raw`a\b`]]);
});

test('parens and braces', () => {
  assert.deepEqual(words('( cat .env )'), [['cat', '.env']]);
  assert.deepEqual(words('{ cat x; }')[0], ['{', 'cat', 'x']);
  assert.deepEqual(words('{ cat x; }'), [['{', 'cat', 'x'], ['}']]);
  assert.deepEqual(words('echo {a,b} ${X}'), [['echo', '{a,b}', '${X}']]);
  assert.deepEqual(words('echo {}'), [['echo', '{}']]);
  assert.deepEqual(words('! grep x f'), [['!', 'grep', 'x', 'f']]);
  assert.deepEqual(words('(a; (b)) c'), [['a'], ['b'], ['c']]);
  assert.deepEqual(words('f() { cat .env; }'), [['f'], ['{', 'cat', '.env'], ['}']]);
  // ( starts a new command even right after a word.
  assert.deepEqual(words('time (cat x)'), [['time'], ['cat', 'x']]);
  assert.deepEqual(words('x=1 (cat y)'), [['x=1'], ['cat', 'y']]);
});

test('escapes', () => {
  assert.deepEqual(words('rm -rf \\\n~'), [['rm', '-rf', '~']]);
  assert.deepEqual(words('find . -exec cat {} \\;'), [['find', '.', '-exec', 'cat', '{}', ';']]);
  assert.deepEqual(words('echo a\\ b'), [['echo', 'a b']]);
  assert.deepEqual(words('echo a\\\nb'), [['echo', 'ab']]);
  assert.deepEqual(words('\\rm x'), [['rm', 'x']]);
  assert.deepEqual(words('echo a\\&b \\| \\( \\#'), [['echo', 'a&b', '|', '(', '#']]);
});

test('redirects', () => {
  let s = scan('echo x >> .env').segments[0];
  assert.deepEqual(s.words, ['echo', 'x']);
  assert.deepEqual(s.redirects, [{ op: '>>', target: '.env' }]);

  s = scan('nc h 1 < .env').segments[0];
  assert.deepEqual(s.words, ['nc', 'h', '1']);
  assert.deepEqual(s.redirects, [{ op: '<', target: '.env' }]);

  s = scan('cmd 2>/dev/null').segments[0];
  assert.deepEqual(s.words, ['cmd']);
  assert.deepEqual(s.redirects, [{ op: '>', target: '/dev/null' }]);

  s = scan('cmd &>log').segments[0];
  assert.deepEqual(s.words, ['cmd']);
  assert.deepEqual(s.redirects, [{ op: '>', target: 'log' }]);

  const r = scan('cmd 2>&1 | tail -5');
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments[0].redirects, []);
  assert.deepEqual(r.segments[0].words, ['cmd']);
  assert.equal(r.segments[0].pipeline, r.segments[1].pipeline);
});

test('redirect operators normalize to < > >>', () => {
  const ops = (cmd) => scan(cmd).segments[0].redirects;
  assert.deepEqual(ops('c &>>log'), [{ op: '>>', target: 'log' }]);
  assert.deepEqual(ops('c 2>>log'), [{ op: '>>', target: 'log' }]);
  assert.deepEqual(ops('c >|log'), [{ op: '>', target: 'log' }]);
  assert.deepEqual(ops('c <>f'), [{ op: '>', target: 'f' }]);
  assert.deepEqual(ops('c >&log'), [{ op: '>', target: 'log' }]);
  assert.deepEqual(ops('c >f 2>g <h'), [
    { op: '>', target: 'f' }, { op: '>', target: 'g' }, { op: '<', target: 'h' },
  ]);
  assert.deepEqual(ops('c > "my file"'), [{ op: '>', target: 'my file' }]);
  assert.deepEqual(ops('c >2>g'), [{ op: '>', target: '2' }, { op: '>', target: 'g' }]);
});

test('descriptor duplication takes no target', () => {
  for (const cmd of ['c >&2', 'c 2>&1', 'c 3<&0', 'c >&-', 'c 2>&-', 'c 1>&2-']) {
    const s = scan(cmd).segments[0];
    assert.deepEqual(s.words, ['c'], cmd);
    assert.deepEqual(s.redirects, [], cmd);
  }
});

test('digits inside a word are not a descriptor; a redirect with no word records nothing', () => {
  assert.deepEqual(scan('echo a2>f').segments[0].words, ['echo', 'a2']);
  assert.deepEqual(scan('echo a2>f').segments[0].redirects, [{ op: '>', target: 'f' }]);
  assert.deepEqual(words('echo x>f'), [['echo', 'x']]);
  assert.deepEqual(scan('cat > ; ls').segments.map((s) => s.redirects), [[], []]);
  assert.deepEqual(scan('cat >').segments[0].redirects, []);
  // A redirect alone is still a segment: it truncates or reads its target.
  assert.deepEqual(scan('> .env').segments[0].redirects, [{ op: '>', target: '.env' }]);
});

test('heredocs', () => {
  let r = scan("cat > f.js <<'EOF'\nx='.env'\nEOF\nls");
  assert.deepEqual(r.segments.map((s) => s.words), [['cat'], ['ls']]);
  assert.ok(!r.segments.flatMap((s) => s.words).includes('.env'));
  assert.deepEqual(r.segments[0].redirects, [{ op: '>', target: 'f.js' }]);
  assert.deepEqual(r.segments.flatMap((s) => s.substs), []);

  r = scan('cat <<EOF\n$(cat ~/.ssh/id_rsa)\nEOF');
  assert.deepEqual(r.segments.map((s) => s.words), [['cat']]);
  assert.deepEqual(r.segments[0].substs, ['cat ~/.ssh/id_rsa']);

  assert.deepEqual(allWords('cat <<< .env'), ['cat']);
});

test('a heredoc with no command still reports its substitutions, and nothing else', () => {
  const r = scan('<<EOF\n$(cat x)\nEOF');
  assert.deepEqual(r.segments.map((s) => [s.words, s.substs]), [[[], ['cat x']]]);
  assert.deepEqual(scan('<<EOF\nplain\nEOF').segments, []);
  assert.deepEqual(scan("<<'EOF'\n$(cat x)\nEOF").segments, []);
});

test('heredoc body text is dropped; unquoted bodies still run $(...) and backticks', () => {
  assert.deepEqual(words('cat <<EOF\ncat .env; rm -rf ~\nEOF'), [['cat']]);
  assert.deepEqual(substs('cat <<EOF\n`cat x`\nEOF'), ['cat x']);
  assert.deepEqual(substs('cat <<EOF\n\\$(cat x) "$(cat y)"\nEOF'), ['cat y']);
  // A quoted delimiter of any form makes the body literal.
  for (const d of ["'EOF'", '"EOF"', '\\EOF', 'E"O"F']) {
    assert.deepEqual(substs(`cat <<${d}\n$(cat x)\nEOF`), [], d);
  }
  assert.deepEqual(substs('cat <<EOF\n$(cat\nx)\nEOF'), ['cat\nx']);
});

test('heredoc delimiter rules', () => {
  // <<- strips leading tabs from the delimiter line; plain << does not.
  assert.deepEqual(words('cat <<-EOF\n\tbody\n\tEOF\nls'), [['cat'], ['ls']]);
  assert.deepEqual(words('cat <<EOF\n\tEOF\nls\nEOF'), [['cat']]);
  // Only a line that is exactly the delimiter closes the body.
  assert.deepEqual(words('cat <<EOF\nEOF x\nxEOF\nEOF\nls'), [['cat'], ['ls']]);
  // The rest of the operator line is still parsed, and the body starts on the next line.
  const r = scan('cat <<EOF | grep x\nbody\nEOF\nls');
  assert.deepEqual(r.segments.map((s) => s.words), [['cat'], ['grep', 'x'], ['ls']]);
  assert.deepEqual(r.segments.map((s) => s.pipeline), [0, 0, 1]);
  // Several heredocs on one line read their bodies in order.
  assert.deepEqual(words('cat <<A <<B\na\nA\nb\nB\nls'), [['cat'], ['ls']]);
  // A here-string word is dropped but its substitutions are live.
  const h = scan('cat <<< "$(cat x)"').segments[0];
  assert.deepEqual(h.words, ['cat']);
  assert.deepEqual(h.substs, ['cat x']);
});

test('substitution quoting', () => {
  assert.deepEqual(substs('echo "$(cat x)"'), ['cat x']);
  assert.deepEqual(substs('echo "`cat x`"'), ['cat x']);
  assert.deepEqual(substs("echo '$(cat x)'"), []);
  assert.deepEqual(substs("echo '`cat x`'"), []);
  assert.deepEqual(substs('diff <(cat a) b'), ['cat a']);
  assert.deepEqual(substs('tee >(cat a) b'), ['cat a']);
  assert.deepEqual(substs('echo $((1+2))'), []);
  assert.deepEqual(substs('echo \\$(cat x)').length, 0);
  assert.deepEqual(substs('echo $(cat x)'), ['cat x']);
  assert.deepEqual(substs('export $(cat .env)'), ['cat .env']);
});

test('substitutions become empty strings in their word', () => {
  assert.deepEqual(words('echo $(cat x)'), [['echo', '']]);
  assert.deepEqual(words('echo a$(cat x)b'), [['echo', 'ab']]);
  assert.deepEqual(words('echo "a $(cat x) b"'), [['echo', 'a  b']]);
  assert.deepEqual(words('diff <(cat a) b'), [['diff', '', 'b']]);
  assert.deepEqual(words('echo $((1+2))'), [['echo', '']]);
  assert.deepEqual(words('$(cat x)'), [['']]);
});

test('substitution bodies honor quotes, parens, nesting and heredocs', () => {
  assert.deepEqual(substs('echo $(echo ")" ; echo \'(\')'), ['echo ")" ; echo \'(\'']);
  assert.deepEqual(substs('echo $( (a; b) | c )'), [' (a; b) | c ']);
  assert.deepEqual(substs('echo $(a $(b))'), ['a $(b)']);
  assert.deepEqual(substs('echo `echo \\`cat x\\``'), ['echo `cat x`']);
  assert.deepEqual(substs('echo ${X:-$(cat y)}'), ['cat y']);
  assert.deepEqual(substs('echo $(( $(cat x) + 1 ))'), ['cat x']);
  assert.deepEqual(substs('echo $(( (1+2) * 3 )) $(b)'), ['b']);
  assert.deepEqual(substs('echo $(cat <<EOF\n)\nEOF\n)'), ['cat <<EOF\n)\nEOF\n']);
  // Words after the substitution are still parsed.
  assert.deepEqual(words('echo $(a; b) && ls'), [['echo', ''], ['ls']]);
});

test('commit message', () => {
  const cmd = 'git commit -m "$(cat <<\'EOF\'\nfix (scope: unbalanced\nmentions .env\nEOF\n)"';
  const r = scan(cmd);
  assert.equal(r.segments.length, 1);
  assert.deepEqual(r.segments[0].words, ['git', 'commit', '-m', '']);
  assert.equal(r.segments[0].substs.length, 1);
  assert.equal(r.segments[0].substs[0], "cat <<'EOF'\nfix (scope: unbalanced\nmentions .env\nEOF\n");
  assert.ok(!allWords(cmd).includes('.env'));
  assert.equal(r.overflow, false);

  // The command after the message is not swallowed.
  assert.deepEqual(words(cmd + ' && git status'), [['git', 'commit', '-m', ''], ['git', 'status']]);
});

test('quote desync cannot hide a command', () => {
  // A comment runs to end of line, so an apostrophe in it does not open a quote.
  assert.deepEqual(words("echo hi # it's\ncat .env"), [['echo', 'hi'], ['cat', '.env']]);
  assert.deepEqual(words('echo a#b ${#X} $#'), [['echo', 'a#b', '${#X}', '$#']]);
  // $'...' honors \' where plain single quotes do not.
  assert.deepEqual(words("echo $'it\\'s'; cat .env"), [['echo', "it's"], ['cat', '.env']]);
  assert.deepEqual(words("cat $'.env'"), [['cat', '.env']]);
  // $"..." is a plain double-quoted string.
  assert.deepEqual(words('echo $"a b"'), [['echo', 'a b']]);
});

test('never throws', () => {
  const unterminated = {
    'unterminated double quote': 'echo "abc',
    'unterminated single quote': "echo 'abc",
    'lone $(': '$(',
    'lone backtick': '`',
    'lone arithmetic': '$((1+',
    'unclosed heredoc': 'cat <<EOF\nabc',
    'heredoc with no newline': 'cat <<EOF',
    'trailing backslash': 'echo a\\',
    'trailing redirect': 'cat >',
    'empty': '',
    'whitespace': ' \t\n ',
  };
  for (const [name, cmd] of Object.entries(unterminated)) {
    const r = scan(cmd);
    assert.ok(Array.isArray(r.segments), name);
    assert.equal(typeof r.overflow, 'boolean', name);
  }
  assert.deepEqual(words('echo "abc'), [['echo', 'abc']]);
  assert.deepEqual(words("echo 'abc def"), [['echo', 'abc def']]);
  assert.deepEqual(substs('echo $(cat x'), ['cat x']);
  assert.deepEqual(substs('echo `cat x'), ['cat x']);
  assert.deepEqual(words('cat <<EOF\nrm -rf ~\n'), [['cat']]);

  const big = scan('x'.repeat(100 * 1024));
  assert.equal(big.segments.length, 1);
  assert.equal(big.overflow, false);

  const deep = scan('$('.repeat(20));
  assert.ok(Array.isArray(deep.segments));
  assert.equal(deep.overflow, true);
  assert.equal(scan(nested(20)).overflow, true);
});

test('overflow starts past 16 nested substitutions', () => {
  assert.equal(scan(nested(16)).overflow, false);
  assert.equal(scan(nested(17)).overflow, true);
});

test('adversarial inputs return quickly and without recursion blowups', () => {
  const inputs = [
    '$(('.repeat(50000),
    '$('.repeat(50000),
    '$(a '.repeat(25000),
    '$(a) '.repeat(25000),
    '`'.repeat(100001),
    '('.repeat(100000),
    '"$('.repeat(30000),
    '<<EOF\n'.repeat(15000),
    'cat <<A <<B <<C '.repeat(6000),
    "'$(".repeat(30000),
  ];
  const started = Date.now();
  for (const cmd of inputs) {
    const r = scan(cmd);
    assert.ok(Array.isArray(r.segments));
  }
  assert.ok(Date.now() - started < 10000, 'scan must stay roughly linear on hostile input');
});

test('segments always have the documented shape', () => {
  // Deterministic fuzz over the characters that drive the state machine.
  const pieces = ['$(', ')', '(', '`', '"', "'", '\\', '\n', '<<', '<<-', '<<<', 'EOF', ';', '|', '&', '&&', '|&',
    '>', '>>', '<', '<(', '>(', ' ', 'a', 'cat', '.env', '$((', '))', '$', '{', '}', '#', "$'", '2', '>&', '&>', '-'];
  let seed = 0x5eed1234;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 4000; n++) {
    let cmd = '';
    for (let k = Math.floor(rand() * 40); k > 0; k--) cmd += pieces[Math.floor(rand() * pieces.length)];
    const r = scan(cmd);
    assert.equal(typeof r.overflow, 'boolean', JSON.stringify(cmd));
    for (const s of r.segments) {
      assert.ok(s.words.every((w) => typeof w === 'string'), JSON.stringify(cmd));
      assert.ok(s.substs.every((w) => typeof w === 'string'), JSON.stringify(cmd));
      assert.ok(Number.isInteger(s.pipeline) && s.pipeline >= 0, JSON.stringify(cmd));
      assert.ok(s.redirects.every((x) => ['<', '>', '>>'].includes(x.op) && typeof x.target === 'string'), JSON.stringify(cmd));
      assert.ok(s.words.length + s.redirects.length + s.substs.length > 0, JSON.stringify(cmd));
    }
  }
});
