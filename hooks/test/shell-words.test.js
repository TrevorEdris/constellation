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
// `echo $(($(( ... 1 )) ))` arithmetic nested k levels deep, balanced.
const nestedArith = (k) => 'echo ' + '$(('.repeat(k) + '1' + '))'.repeat(k);
// Pipeline ids renumbered by first appearance: only which segments share an id is meaningful.
const pipelines = (cmd) => {
  const ids = [];
  return scan(cmd).segments.map((s) => {
    if (!ids.includes(s.pipeline)) ids.push(s.pipeline);
    return ids.indexOf(s.pipeline);
  });
};

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

test('separators need no surrounding spaces', () => {
  // Each separator must consume exactly its own characters: a branch that also eats the next
  // character would drop the first letter of the next command, which spaced input never shows.
  assert.deepEqual(words('a;b'), [['a'], ['b']]);
  assert.deepEqual(words('a&b'), [['a'], ['b']]);
  assert.deepEqual(words('a&&b'), [['a'], ['b']]);
  assert.deepEqual(words('a||b'), [['a'], ['b']]);
  assert.deepEqual(words('a|b'), [['a'], ['b']]);
  assert.deepEqual(words('a|&b'), [['a'], ['b']]);
  assert.deepEqual(pipelines('a;b'), [0, 1]);
  assert.deepEqual(pipelines('a&b'), [0, 1]);
  assert.deepEqual(pipelines('a&&b'), [0, 1]);
  assert.deepEqual(pipelines('a||b'), [0, 1]); // `||` ends a pipeline; it is not two pipes
  assert.deepEqual(pipelines('a|b'), [0, 0]);
  assert.deepEqual(pipelines('a|&b'), [0, 0]);
  // A subshell opens a pipeline of its own on both sides.
  assert.deepEqual(words('a | (b) | c'), [['a'], ['b'], ['c']]);
  assert.deepEqual(pipelines('a | (b) | c'), [0, 1, 2]);
});

test('a newline right after | or |& continues the pipeline', () => {
  // Multi-line pipelines are ordinary formatting; rules that key on "same pipeline" must see them.
  assert.deepEqual(words('a |\n b'), [['a'], ['b']]);
  assert.deepEqual(pipelines('a |\n b'), [0, 0]);
  assert.deepEqual(pipelines('cat a |\n grep b'), [0, 0]);
  assert.deepEqual(pipelines('curl http://x |\n  sh'), [0, 0]);
  assert.deepEqual(pipelines('a |&\n b'), [0, 0]);
  assert.deepEqual(pipelines('a |\n b |\n c'), [0, 0, 0]);
  // Blank lines and comments between the pipe and the next member do not break it.
  assert.deepEqual(pipelines('a |\n\n b'), [0, 0]);
  assert.deepEqual(pipelines('a | # note\n b'), [0, 0]);
  // A heredoc on the first member still reads its body at the line break.
  assert.deepEqual(words('cat <<EOF |\nbody\nEOF\nsh'), [['cat'], ['sh']]);
  assert.deepEqual(pipelines('cat <<EOF |\nbody\nEOF\nsh'), [0, 0]);
  // The continuation lasts one line break: whatever follows the last member is a new pipeline.
  assert.deepEqual(pipelines('a | b\nc'), [0, 0, 1]);
  assert.deepEqual(pipelines('a |\n b\nc'), [0, 0, 1]);
  assert.deepEqual(pipelines('a | b ;\n c'), [0, 0, 1]);
  // Only pipes continue; `&&` and `;` before a newline start separate pipelines either way.
  assert.deepEqual(pipelines('a &&\n b'), [0, 1]);
  assert.deepEqual(pipelines('a ;\n b'), [0, 1]);
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
  // A stray `)` at top level ends the segment and nothing after it is lost.
  assert.deepEqual(words('a ) cat x'), [['a'], ['cat', 'x']]);
  // A top-level case arm: the pattern's `)` ends the pattern, the arm's command is its own segment.
  assert.deepEqual(words('case x in a) cat x;; esac'), [['case', 'x', 'in', 'a'], ['cat', 'x'], ['esac']]);
});

test('escapes', () => {
  assert.deepEqual(words('rm -rf \\\n~'), [['rm', '-rf', '~']]);
  assert.deepEqual(words('find . -exec cat {} \\;'), [['find', '.', '-exec', 'cat', '{}', ';']]);
  assert.deepEqual(words('echo a\\ b'), [['echo', 'a b']]);
  assert.deepEqual(words('echo a\\\nb'), [['echo', 'ab']]);
  assert.deepEqual(words('\\rm x'), [['rm', 'x']]);
  assert.deepEqual(words('echo a\\&b \\| \\( \\#'), [['echo', 'a&b', '|', '(', '#']]);
  // A trailing lone backslash has nothing to escape and stays.
  assert.deepEqual(words('echo a\\'), [['echo', 'a\\']]);
  // A tab separates words like a space.
  assert.deepEqual(words('cat\t.env'), [['cat', '.env']]);
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

  // A descriptor followed by a space before its target is the common real shape: the target is
  // still the redirect's, never a word of the command.
  s = scan('cmd 2> /dev/null').segments[0];
  assert.deepEqual(s.words, ['cmd']);
  assert.deepEqual(s.redirects, [{ op: '>', target: '/dev/null' }]);

  s = scan('c 2>> log').segments[0];
  assert.deepEqual(s.words, ['c']);
  assert.deepEqual(s.redirects, [{ op: '>>', target: 'log' }]);

  s = scan('cat sec 2> err').segments[0];
  assert.deepEqual(s.words, ['cat', 'sec']);
  assert.deepEqual(s.redirects, [{ op: '>', target: 'err' }]);

  // `&>` needs no space before it: `cmd` is still a word and the target is `log`.
  s = scan('cmd&>log').segments[0];
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
    const r = scan(cmd);
    assert.equal(r.segments.length, 1, cmd);
    assert.deepEqual(r.segments[0].words, ['c'], cmd);
    assert.deepEqual(r.segments[0].redirects, [], cmd);
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
  // A here-string word is data, not a redirect target.
  assert.deepEqual(scan('cat <<< .env').segments[0].redirects, []);
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
  for (const d of ["'EOF'", '"EOF"', '\\EOF', 'E"O"F', "$'EOF'", '$"EOF"']) {
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
  // A body ends at the FIRST line equal to its delimiter. The same text later on is an ordinary
  // word again: reading on to a later copy would hide every command in between.
  assert.deepEqual(words('cat <<E\nx\nE\nls\nE\nrm y'), [['cat'], ['ls'], ['E'], ['rm', 'y']]);
  assert.deepEqual(words('cat <<E\nx\nE\nrm y\nE'), [['cat'], ['rm', 'y'], ['E']]);
  assert.deepEqual(
    words('cat <<A <<B\na\nA\nb\nB\nls\nA\nB\nrm z'),
    [['cat'], ['ls'], ['A'], ['B'], ['rm', 'z']],
  );
  // A here-string word is dropped but its substitutions are live.
  const h = scan('cat <<< "$(cat x)"').segments[0];
  assert.deepEqual(h.words, ['cat']);
  assert.deepEqual(h.substs, ['cat x']);
});

test('a heredoc that never finds its delimiter sets overflow', () => {
  // Bash reads `<<` as arithmetic in `$[..]`, a subscript or a `${x:off}` offset. scan does not
  // model those, so it sees a heredoc whose body would run to end of input and hide every later
  // command. Setting overflow makes the caller treat the whole command as unparsed instead.
  for (const cmd of [
    'echo $[1<<2]\nm2 q',
    'a[1<<2]=5\nm2 q',
    'echo ${a[1<<2]}\nm2 q',
    'echo ${x:1<<2}\nm2 q',
    'cat <<EOF\nabc',
    'cat <<EOF\nrm -rf ~\n',
    'cat <<EOF\n',
    "cat <<'EOF'\nabc",
    'cat <<A <<B\na\nA\nb',
    'echo $(cat <<EOF\nabc',
  ]) {
    assert.equal(scan(cmd).overflow, true, cmd);
  }
  // A heredoc that finds its delimiter does not, whatever the form.
  for (const cmd of [
    'cat <<EOF\nx\nEOF',
    'cat <<EOF\nx\nEOF\nls',
    "cat <<'EOF'\nx\nEOF\n",
    'cat <<-EOF\n\tx\n\tEOF',
    'cat <<A <<B\na\nA\nb\nB',
    'echo $(cat <<EOF\nx\nEOF\n)',
    '<<EOF\n$(cat x)\nEOF',
    'cat <<< x\nls',
  ]) {
    assert.equal(scan(cmd).overflow, false, cmd);
  }
  // The text before the swallowed `<<` is still reported.
  assert.deepEqual(words('echo $[1<<2]\nm2 q'), [['echo', '$[1']]);
});

test('a heredoc inside a substitution may end on DELIM) as bash allows', () => {
  // Bash accepts `DELIM)` on the closing line (with a warning): the body ends at DELIM and the
  // `)` closes the substitution. Read as an ordinary body line it swallowed `; m2 q`.
  const closed = (cmd, body) => {
    const r = scan(cmd);
    assert.deepEqual(r.segments.map((s) => s.words), [['echo', ''], ['m2', 'q']], cmd);
    assert.deepEqual(r.segments[0].substs, [body], cmd);
    assert.equal(r.overflow, false, cmd);
  };
  closed('echo $(cat <<E\nhi\nE) ; m2 q', 'cat <<E\nhi\nE');
  closed("echo $(cat <<'E'\nhi\nE) ; m2 q", "cat <<'E'\nhi\nE");
  closed('echo $(cat <<"E"\nhi\nE) ; m2 q', 'cat <<"E"\nhi\nE');
  closed('echo $(cat <<EOF\nhi\nEOF) ; m2 q', 'cat <<EOF\nhi\nEOF');
  closed('echo $(cat <<-E\n\thi\n\tE) ; m2 q', 'cat <<-E\n\thi\n\tE');
  closed('echo $(cat <<E\nE) ; m2 q', 'cat <<E\nE');
  // Inside double quotes the text after the `)` is part of the string, as in bash.
  let r = scan('echo "$(cat <<E\nhi\nE) ; m2 q"');
  assert.deepEqual(r.segments.map((s) => s.words), [['echo', ' ; m2 q']]);
  assert.deepEqual(r.segments[0].substs, ['cat <<E\nhi\nE']);
  // ...and when the string closes right after the `)`, the next command is a command.
  r = scan('echo "$(cat <<E\nhi\nE)" ; m2 q');
  assert.deepEqual(r.segments.map((s) => s.words), [['echo', ''], ['m2', 'q']]);
  assert.deepEqual(r.segments[0].substs, ['cat <<E\nhi\nE']);
  // A body that ended on `DELIM)` ends there too: a later line equal to the delimiter is an
  // ordinary word, and the commands before it are not swallowed.
  assert.deepEqual(words('echo $(cat <<E\nhi\nE) ; m2\nE\n)'), [['echo', ''], ['m2'], ['E']]);
  // Process substitution takes the same form, and so does a subshell inside a substitution.
  assert.deepEqual(words('cat <(cat <<E\nhi\nE) ; m2 q'), [['cat', ''], ['m2', 'q']]);
  assert.deepEqual(words('echo $( (cat <<E\nhi\nE) ) ; m2 q'), [['echo', ''], ['m2', 'q']]);
  // An unquoted body still reports its substitutions to the re-parse (here via the outer body).
  assert.deepEqual(substs('echo $(cat <<E\n$(cat x)\nE) ; m2 q'), ['cat <<E\n$(cat x)\nE']);
  // Pending heredocs after the one that ended on `)` are dropped: their lines are read as commands.
  assert.deepEqual(words('echo $(cat <<A <<B\na\nA) ; m2 q\nb\nB\n)'), [['echo', ''], ['m2', 'q'], ['b'], ['B']]);
  // Only the exact form closes: a line that merely contains `E)`, or has other text before it,
  // or a longer word that starts with the delimiter, does not. These never find a delimiter.
  assert.deepEqual(substs('echo $(cat <<E\nhi E) x\nE\n) ; m2 q'), ['cat <<E\nhi E) x\nE\n']);
  for (const cmd of ['echo $(cat <<E\nhi\n E) ; m2 q', 'echo $(cat <<E\nhi\nEOF) ; m2 q', 'echo $(cat <<E\nhi\n\tE) ; m2 q']) {
    assert.equal(scan(cmd).overflow, true, cmd);
    assert.deepEqual(words(cmd), [['echo', '']], cmd);
  }
  // Outside a substitution `E)` is an ordinary body line; with no later `E` the body never ends.
  assert.equal(scan('cat <<E\nhi\nE) ; m2 q').overflow, true);
  assert.deepEqual(words('cat <<E\nhi\nE) ; m2 q'), [['cat']]);
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
  // The closing backtick or paren is consumed exactly: the next character is not eaten with it.
  assert.deepEqual(words('echo `a`b'), [['echo', 'b']]);
  assert.deepEqual(words('echo "`a`b"'), [['echo', 'b']]);
  assert.deepEqual(words('echo $(a)b'), [['echo', 'b']]);
  assert.deepEqual(words('echo <(a)b'), [['echo', 'b']]);
});

test('substitution bodies honor quotes, parens, nesting and heredocs', () => {
  assert.deepEqual(substs('echo $(echo ")" ; echo \'(\')'), ['echo ")" ; echo \'(\'']);
  assert.deepEqual(substs('echo $( (a; b) | c )'), [' (a; b) | c ']);
  assert.deepEqual(substs('echo $(a $(b))'), ['a $(b)']);
  assert.deepEqual(substs('echo `echo \\`cat x\\``'), ['echo `cat x`']);
  // Inside backticks `\$` and `\\` lose their backslash; any other backslash pair stays.
  assert.deepEqual(substs('echo `a \\$x \\\\y \\z`'), ['a $x \\y \\z']);
  assert.deepEqual(substs('echo ${X:-$(cat y)}'), ['cat y']);
  assert.deepEqual(substs('echo $(( $(cat x) + 1 ))'), ['cat x']);
  assert.deepEqual(substs('echo $(( (1+2) * 3 )) $(b)'), ['b']);
  assert.deepEqual(substs('echo $(cat <<EOF\n)\nEOF\n)'), ['cat <<EOF\n)\nEOF\n']);
  // Words after the substitution are still parsed.
  assert.deepEqual(words('echo $(a; b) && ls'), [['echo', ''], ['ls']]);
});

test('arithmetic is skipped, and the text after it still parses', () => {
  // The command after `;` must survive: an arithmetic body that ends early would swallow it.
  assert.deepEqual(words('echo $((1+2)) ; cat x'), [['echo', ''], ['cat', 'x']]);
  assert.deepEqual(words('echo $(( (1+2)*3 )); cat x'), [['echo', ''], ['cat', 'x']]);
  assert.deepEqual(words('echo $(( 1 + (2 * (3 - 4)) )); cat x'), [['echo', ''], ['cat', 'x']]);
  // Quotes inside the body hide their parens from the closing-paren count.
  assert.deepEqual(words('echo $(( "a)" + 1 )); cat x'), [['echo', ''], ['cat', 'x']]);
  assert.deepEqual(words("echo $(( 'a)' + 1 )); cat x"), [['echo', ''], ['cat', 'x']]);
  assert.deepEqual(words('echo "$((1+2))" && cat x'), [['echo', ''], ['cat', 'x']]);
  // A command substitution or backtick inside the body still runs.
  assert.deepEqual(substs('echo $(( `cat y` + 1 ))'), ['cat y']);
  assert.deepEqual(substs('echo $(( $(a)$(b) + 1 ))'), ['a', 'b']);
  assert.deepEqual(substs('echo $(( "$(cat y)" + 1 ))'), ['cat y']);
  // Arithmetic nests like substitutions do: 16 levels are followed, a 17th sets overflow.
  assert.equal(scan(nestedArith(16)).overflow, false);
  assert.equal(scan(nestedArith(17)).overflow, true);
});

test('the arithmetic look-ahead reads quotes the way bash does', () => {
  // Words alone cannot tell arithmetic from a substitution; `substs` can.
  const arith = (cmd, inner = []) => {
    assert.deepEqual(words(cmd), [['echo', ''], ['cat', 'x']], cmd);
    assert.deepEqual(substs(cmd), inner, cmd);
  };
  // A `)` inside quotes does not close the second paren, so these stay arithmetic.
  arith("echo $(( 'a)' + 1 )); cat x");
  arith('echo $(( "a)" + 1 )); cat x');
  arith("echo $(( $'a\\')' + 1 )); cat x");
  arith('echo $(( 1 + \\) )); cat x');
  // `$(` inside double quotes nests, quotes inside it nest again, and its body is reported.
  arith('echo $(( "$(echo ")")" + 1 )); cat x', ['echo ")"']);
  // Inside double quotes a backtick body is skipped whole, so its stray quote closes nothing.
  arith('echo $(( "a`echo "`b" + 1 )); cat x', ['echo "']);
  // A paren inside double quotes opens nothing, and `$(` inside them is skipped as a pair.
  arith('echo $(( "(" + 1 )); cat x');
  arith('echo $(( "$()" )); cat x', ['']);
  arith('echo $(( "$x" + 1 )); cat x');
  // Skipped spans end exactly where they end: the character after one is still read, so a `)`
  // right after an escape, an empty quote pair, a `$'...'` or a backtick pair still counts.
  arith('echo $(( 1 + \\a)); cat x');
  arith("echo $(( '' + 1 )); cat x");
  arith("echo $(( $'a')); cat x");
  arith("echo $(( 'a')); cat x");
  arith('echo $(( "`a`" + 1 )); cat x', ['a']);
  arith('echo $(( "``" + 1 )); cat x', ['']);
  // Outside quotes bash does not skip a backtick body: its `)` closes the pair, `))` never
  // follows, and the text is a substitution that starts with a subshell paren.
  assert.deepEqual(substs('echo $(( 1 + `echo )` )); cat x'), ['( 1 + `echo )` )']);
  // `$(` is live even inside single quotes in arithmetic (bash expands the body as if in double
  // quotes). When it runs past the `))`, the text after the `))` must still be read.
  assert.deepEqual(words("echo $(( '$(' )); cat x"), [['echo', ''], ['cat', 'x']]);
});

test('$(( is a substitution unless it closes as )), as bash decides', () => {
  // `$((cat x) | sh)` and `$((cat x); y)` run `cat x`: a subshell paren right after `$(`.
  assert.deepEqual(substs('echo $((cat x) | sh)'), ['(cat x) | sh']);
  assert.deepEqual(substs('echo $((cat x); y)'), ['(cat x); y']);
  assert.deepEqual(substs('echo "$((cat x) | sh)"'), ['(cat x) | sh']);
  assert.deepEqual(substs('echo `echo $((cat x) | sh)`'), ['echo $((cat x) | sh)']);
  // The substitution ends where bash ends it, so the rest of the command line is still parsed.
  assert.deepEqual(words('echo $((cat x) | sh) && ls'), [['echo', ''], ['ls']]);
  assert.deepEqual(words('echo $((cat x); y); cat z'), [['echo', ''], ['cat', 'z']]);
  // `$((a) )` and `$((a)(b))` do not close as `))` either.
  assert.deepEqual(substs('echo $((a) )'), ['(a) ']);
  assert.deepEqual(substs('echo $((a)(b))'), ['(a)(b)']);
  // An unterminated `$((` is read as a substitution, so nothing after it is hidden.
  assert.deepEqual(substs('echo $((1+'), ['(1+']);
});

test('a command-leading (( )) is arithmetic; a << inside it opens no heredoc', () => {
  // Read as two subshell parens, `<< 2` was a heredoc whose body swallowed every later line.
  assert.deepEqual(words('((x=1<<2))\ncat x'), [['cat', 'x']]);
  assert.deepEqual(words('(( n <<= 1 )); cat x'), [['cat', 'x']]);
  assert.deepEqual(words('((i++)) && cat x'), [['cat', 'x']]);
  assert.deepEqual(words('echo a; (( x )); cat x'), [['echo', 'a'], ['cat', 'x']]);
  assert.deepEqual(words('(( (1+2)*3 ))\ncat x'), [['cat', 'x']]);
  // Inside a substitution too: the heredoc must not eat the closing paren.
  assert.deepEqual(words('echo $( ((x=1<<2)); cat y ) && ls'), [['echo', ''], ['ls']]);
  // A substitution inside the body is still reported.
  assert.deepEqual(substs('((x=$(cat y)))'), ['cat y']);
  // Not arithmetic unless it closes as `))`: these are nested subshells and run their commands.
  assert.deepEqual(words('((cat x); y)'), [['cat', 'x'], ['y']]);
  assert.deepEqual(words('(( a ) )'), [['a']]);
  assert.deepEqual(words('((cat x) | sh)').flat(), ['cat', 'x', 'sh']);
  assert.deepEqual(words('((a))b'), [['b']]);
});

test('(( )) is arithmetic after a reserved word too, so a << inside it opens no heredoc', () => {
  // Each of these used to open a heredoc whose body ran to end of input and hid `m2 q`.
  assert.deepEqual(words('while ((x)); do cat y; done'), [['while'], ['do', 'cat', 'y'], ['done']]);
  assert.deepEqual(words('if (( x << 2 )); then m1 q; fi\nm2 q'), [['if'], ['then', 'm1', 'q'], ['fi'], ['m2', 'q']]);
  assert.deepEqual(words('while ((x<<1)); do m1 q; done\nm2 q'), [['while'], ['do', 'm1', 'q'], ['done'], ['m2', 'q']]);
  assert.deepEqual(words('until ((x<<1)); do m1 q; done\nm2 q'), [['until'], ['do', 'm1', 'q'], ['done'], ['m2', 'q']]);
  assert.deepEqual(words('for a in b; do ((x<<1)); m1 q; done\nm2 q'), [['for', 'a', 'in', 'b'], ['do'], ['m1', 'q'], ['done'], ['m2', 'q']]);
  assert.deepEqual(words('{ ((x<<1)); m1 q; }\nm2 q'), [['{'], ['m1', 'q'], ['}'], ['m2', 'q']]);
  // Every reserved word that can precede a command lets `((` start arithmetic.
  for (const kw of ['if', 'elif', 'while', 'until', 'then', 'else', 'do', '{', '!', 'time']) {
    assert.deepEqual(words(`${kw} ((x<<2)); m1 q\nm2 q`), [[kw], ['m1', 'q'], ['m2', 'q']], kw);
  }
  // Bash splits a keyword from `((` without a space.
  assert.deepEqual(words('while((x<<1)); do m1 q; done\nm2 q'), [['while'], ['do', 'm1', 'q'], ['done'], ['m2', 'q']]);
  assert.deepEqual(words('if((x<<1)); then m1 q; fi\nm2 q'), [['if'], ['then', 'm1', 'q'], ['fi'], ['m2', 'q']]);
  // The C-style for loop: `((` right after `for` is arithmetic, with or without a space.
  const forLoop = [['for'], ['do', 'm1', 'q'], ['done'], ['m2', 'q']];
  assert.deepEqual(words('for ((i=1;i<=(1<<3);i++)); do m1 q; done\nm2 q'), forLoop);
  assert.deepEqual(words('for((i=1;i<=(1<<3);i++)); do m1 q; done\nm2 q'), forLoop);
  // A substitution inside the loop header is still reported.
  assert.deepEqual(substs('for ((i=0; i<$(cat n); i++)); do m1 q; done'), ['cat n']);
  // Only where a command can start. After an ordinary word, or after `for`'s own variable, the
  // parens are subshell parens as before, and a quoted `for` is not the keyword.
  assert.deepEqual(words('echo ((a)); cat x'), [['echo'], ['a'], ['cat', 'x']]);
  assert.deepEqual(words('for x ((a)); cat y'), [['for', 'x'], ['a'], ['cat', 'y']]);
  assert.deepEqual(words("'for' ((a)); cat y"), [['for'], ['a'], ['cat', 'y']]);
  assert.deepEqual(words('echo a >f ((b)); cat y'), [['echo', 'a'], ['b'], ['cat', 'y']]);
  // A `((` that does not close as `))` is still two subshell parens after a keyword.
  assert.deepEqual(words('while ((cat x); y); do z; done'), [['while'], ['cat', 'x'], ['y'], ['do', 'z'], ['done']]);
});

test('a case pattern ) does not close the substitution around it', () => {
  const inDouble = scan('echo "$(case x in a) cat .env;; esac)"');
  assert.deepEqual(inDouble.segments.map((s) => s.words), [['echo', '']]);
  assert.deepEqual(inDouble.segments[0].substs, ['case x in a) cat .env;; esac']);
  const bare = scan('echo $(case x in a) cat .env;; esac)');
  assert.deepEqual(bare.segments.map((s) => s.words), [['echo', '']]);
  assert.deepEqual(bare.segments[0].substs, ['case x in a) cat .env;; esac']);
  // The substitution still ends at the `)` after `esac`, so what follows is parsed normally.
  assert.deepEqual(words('echo $(case x in a) y;; esac) && ls'), [['echo', ''], ['ls']]);
  // Optional leading paren, alternatives, several arms and a default arm.
  assert.deepEqual(substs('echo $(case x in (a|b) cat y;; *) cat z;; esac)').length, 1);
  assert.deepEqual(words('echo $(case x in (a|b) cat y;; *) cat z;; esac); ls'), [['echo', ''], ['ls']]);
  assert.deepEqual(words('echo $(case x in a|b) y;; c) z;; esac); ls'), [['echo', ''], ['ls']]);
  // The last arm may omit `;;`, and `;&` / `;;&` end an arm like `;;`.
  assert.deepEqual(words('echo $(case x in a) y\nesac); ls'), [['echo', ''], ['ls']]);
  assert.deepEqual(words('echo $(case x in a) y;& b) z;;& c) w\nesac); ls'), [['echo', ''], ['ls']]);
  // Patterns on their own lines, and a case after a reserved word.
  assert.deepEqual(words('echo $(case x in\n a) y;;\n b) z;;\nesac); ls'), [['echo', ''], ['ls']]);
  assert.deepEqual(words('echo $(if a; then case x in a) y;; esac; fi); ls'), [['echo', ''], ['ls']]);
  // Nested cases and a subshell inside an arm.
  assert.deepEqual(words('echo $(case a in x) case b in y) c;; esac;; z) (d; e);; esac); ls'), [['echo', ''], ['ls']]);
  assert.deepEqual(words('echo $(( case a in b) c;; esac )); ls'), [['echo', ''], ['ls']]);
  // A quoted `case` or `in` is not the keyword, so the first `)` closes the substitution.
  assert.deepEqual(substs('echo $(\\case x in a) y)'), ['\\case x in a']);
  assert.deepEqual(substs('echo $(case x "in" a) y)'), ['case x "in" a']);
  // `case` that is not in command position is just a word.
  assert.deepEqual(substs('echo $(echo case x in a) y)'), ['echo case x in a']);
  // After a closed case the next `)` closes the substitution again.
  assert.deepEqual(substs('echo $(case x in a) y;; esac; z)'), ['case x in a) y;; esac; z']);
  // Every reserved word that can precede a command lets `case` start one.
  for (const kw of ['if', 'elif', 'while', 'until', 'then', 'else', 'do', '{', '!', 'time']) {
    assert.deepEqual(words(`echo $(${kw} case x in a) y;; esac; true); ls`), [['echo', ''], ['ls']], kw);
  }
  // A case inside a subshell inside a substitution: its pattern `)` is not the subshell's.
  assert.deepEqual(substs('echo $( (case x in a) y;; esac) ); ls'), [' (case x in a) y;; esac) ']);
});

test('case patterns are words of the case segment; an arm is parsed normally', () => {
  // `a|b)` separates patterns, it is not a pipe; `(a)` is an optional leading paren.
  assert.deepEqual(words('case x in a|b) y;; esac'), [['case', 'x', 'in', 'a', 'b'], ['y'], ['esac']]);
  assert.deepEqual(words('case x in (a) y;; esac'), [['case', 'x', 'in', 'a'], ['y'], ['esac']]);
  // Inside an arm `|` is a pipe again and `(` opens a subshell.
  assert.deepEqual(words('case x in a) cat x | grep y;; esac'), [['case', 'x', 'in', 'a'], ['cat', 'x'], ['grep', 'y'], ['esac']]);
  assert.deepEqual(pipelines('case x in a) cat x | grep y;; esac'), [0, 1, 1, 2]);
  assert.deepEqual(words('case x in a) (cd d; ls);; esac'), [['case', 'x', 'in', 'a'], ['cd', 'd'], ['ls'], ['esac']]);
  // A pattern's `)` needs no space after it, and a `;` that is not `;;` does not start a new
  // pattern list: the arm's next commands are still commands, so `|` is still a pipe.
  assert.deepEqual(words('case x in a)m1 q;; esac'), [['case', 'x', 'in', 'a'], ['m1', 'q'], ['esac']]);
  assert.deepEqual(words('case x in a) y; (z) ;; esac'), [['case', 'x', 'in', 'a'], ['y'], ['z'], ['esac']]);
  assert.deepEqual(pipelines('case x in a) y; (z) ;; esac'), [0, 1, 2, 3]);
  assert.deepEqual(words('case x in a) y; cat x | grep z;; esac'), [['case', 'x', 'in', 'a'], ['y'], ['cat', 'x'], ['grep', 'z'], ['esac']]);
  assert.deepEqual(pipelines('case x in a) y; cat x | grep z;; esac'), [0, 1, 2, 2, 3]);
  // Known gap (see the file header, which also lists extglob patterns): `in` on its own line is
  // not recognized, so the case is not tracked and a `)` at top level just ends a segment.
  assert.deepEqual(words('case x\nin a) y;; esac'), [['case', 'x'], ['in', 'a'], ['y'], ['esac']]);
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
  // $'...' unescapes \\, \" and \' and keeps every other backslash pair (here `\n`) as written.
  assert.deepEqual(words(String.raw`echo $'a\\b\"c\'d\n'`), [['echo', String.raw`a\b"c'd\n`]]);
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
  // An unclosed heredoc runs to end of input, and says so.
  assert.equal(scan('cat <<EOF\nabc').overflow, true);

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
    // Arithmetic look-ahead: every one of these starts a look-ahead that cannot succeed.
    '(('.repeat(50000),
    '((\n'.repeat(30000),
    '((a) '.repeat(25000),
    '$((a '.repeat(25000),
    '"$(('.repeat(30000),
    '$(( #"\n) ; x)\n'.repeat(7000),
    // Case tracking and pipe continuation.
    'case x in a) '.repeat(8000),
    '$(case x in a) '.repeat(8000),
    'a |\n'.repeat(30000),
    // Heredoc bodies: closed by `E)`, never closed, and nested without closing.
    '$(cat <<E\nx\nE) '.repeat(10000),
    'echo $[1<<2]\n'.repeat(20000),
    '$(cat <<E\n'.repeat(30000),
    'for ((a<<1)); do :; done\n'.repeat(10000),
  ];
  const started = Date.now();
  for (const cmd of inputs) {
    const r = scan(cmd);
    assert.ok(Array.isArray(r.segments));
  }
  assert.ok(Date.now() - started < 10000, 'scan must stay roughly linear on hostile input');
});

test('the arithmetic look-ahead is metered: hostile input sets overflow, a long real script does not', () => {
  // Without a budget each `(` would rescan the rest of the input for a `))`.
  assert.equal(scan('('.repeat(100000)).overflow, true);
  const script = 'echo $((1+2)); ((x++)); (cat y); echo $((a) | sh)\n'.repeat(1500);
  const r = scan(script);
  assert.equal(r.overflow, false);
  // Per line: `echo`, `cat y` and the `echo` that carries the `$((a) | sh)` substitution.
  assert.equal(r.segments.length, 1500 * 3);
  assert.equal(r.segments.flatMap((s) => s.substs).length, 1500);
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
