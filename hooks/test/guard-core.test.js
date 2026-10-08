'use strict';
// Tests for hooks/guard.js, the tiered PreToolUse guard. It reads a Bash command the way the
// shell does (hooks/lib/shell-words.js) and answers one of three things: nothing (the command is
// not its business), `ask` (the user must approve) or `deny` (never approved from a prompt).
// This file covers the core: the deny tier (rm of / or home or a system dir, writes and formats of
// a disk, the fork bomb, reading a private key), how hits combine (deny beats ask, then position,
// then table order), the `read-secret` rule and the path classifier behind it, the two safety
// nets for text the parser does not fully read (unparsed commands and non-plain command words),
// the CONSTELLATION_GUARD / CONSTELLATION_GUARD_ASK switches, the conversion of an ask into a
// deny when nobody can answer (subagents, `claude -p`), and the spawned hook end to end.
// Every test drives the real decide() or the real `node hooks/guard.js`.
//
// Corpus tables stay inline in this file: `node --test` runs any non-test .js under hooks/test/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decide, classifyPath, globTargetsSecret, toOutput, RULES } = require('../guard.js');

const GUARD = path.join(__dirname, '..', 'guard.js');
const HOME = '/h';
// A real directory outside any git repo, so a later rule that probes `cwd` stays silent here.
const CWD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-core-cwd-')));
test.after(() => fs.rmSync(CWD, { recursive: true, force: true }));

const shq = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

// decide() on a Bash payload. `env` is always explicit: nothing leaks in from the test process.
function run(command, { env = {}, payload = {}, cwd = CWD, home = HOME } = {}) {
  const p = { tool_name: 'Bash', tool_input: { command }, cwd, session_id: 's1', ...payload };
  return decide(p, { env, home });
}

// The fixed ends of the reason templates (PLAN G5). The middle is the rule's own sentence.
const ASK_TAIL = '. Needs your approval (CONSTELLATION_GUARD=critical skips non-critical checks).';
const DENY_TAIL = '. This cannot be approved from a prompt; do not rephrase or split the command to get past it.';

test('deny tier: each command is denied by its rule', () => {
  const rows = {
    'rm-root-home': ['rm -rf ~', 'rm -rf "$HOME"', 'sudo rm -rf /', 'rm -rf /*', "bash -c 'rm -rf ~/'", 'rm -rf \\\n~'],
    'rm-system-dir': ['rm -rf /etc/'],
    'disk-write': ['dd if=/dev/zero of=/dev/disk2'],
    'disk-format': ['mkfs.ext4 /dev/sdb1'],
    'fork-bomb': [':(){ :|:& };:'],
    'read-secret': [
      'cat ~/.ssh/id_ed25519',
      'echo `cat ~/.aws/credentials`',
      'cat ~/.aws/credentials | sed s/a/b/',
      'for x in 1; do cat ~/.ssh/id_rsa; done',
      'cat <<EOF\n$(cat ~/.ssh/id_rsa)\nEOF',
    ],
  };
  for (const [id, cmds] of Object.entries(rows)) {
    for (const cmd of cmds) {
      const d = run(cmd);
      assert.equal(d?.decision, 'deny', cmd);
      assert.equal(d.id, id, cmd);
      assert.ok(d.reason.startsWith(`constellation-guard [${id}] blocked: `), d.reason);
      assert.ok(d.reason.endsWith(DENY_TAIL), d.reason);
    }
  }
});

test('deny rules: other spellings of the same dangerous commands', () => {
  const rows = [
    // [rule id, command]
    ['rm-root-home', 'rm -rf $HOME/'],
    ['rm-root-home', 'rm -rf ${HOME}/*'],
    ['rm-root-home', 'rm -r -f -- ~'],
    ['rm-root-home', 'rm -rf /tmp/x ~'],
    ['rm-root-home', '/bin/rm -rf ~'],
    ['rm-root-home', 'rm -rf //'],
    ['rm-root-home', 'rm -rf /usr/..'],
    ['rm-root-home', 'rm -Rf /h/*'],
    ['rm-root-home', 'rm -f ~/*'],
    ['rm-root-home', 'echo hi; rm -rf ~'],
    ['rm-root-home', 'ls && sudo -u root rm -rf /'],
    ['rm-system-dir', 'rm -rf /bin'],
    ['rm-system-dir', 'rm -rf /usr/*'],
    ['rm-system-dir', 'rm -rf /System/'],
    ['rm-system-dir', 'rm -rf /Users'],
    ['rm-system-dir', 'rm -rf /var /tmp/x'],
    ['disk-write', 'echo x > /dev/sda'],
    ['disk-write', 'cat img >> /dev/rdisk3'],
    ['disk-write', 'sudo dd if=img of=/dev/nvme0n1 bs=1m'],
    ['disk-write', 'dd of=/dev/mmcblk0 if=img'],
    ['disk-format', 'diskutil eraseDisk JHFS+ X disk2'],
    ['disk-format', 'diskutil eraseVolume HFS+ X /Volumes/Y'],
    ['disk-format', 'diskutil partitionDisk disk2 GPT JHFS+ X 0b'],
    ['disk-format', 'diskutil zeroDisk disk2'],
    ['disk-format', 'diskutil randomDisk 1 disk2'],
    ['disk-format', 'diskutil erasedisk JHFS+ X disk2'],
    ['disk-format', 'newfs_msdos -F 32 /dev/disk2'],
    ['disk-format', 'sudo mke2fs -t ext4 /dev/sdb1'],
    ['disk-format', 'mkfs -t ext4 /dev/sdb1'],
    ['fork-bomb', "bash -c ':(){ :|:& };:'"],
    ['fork-bomb', 'x() { :; }; :() {   : | :  &  }  ;  :'],
  ];
  for (const [id, cmd] of rows) {
    const d = run(cmd);
    assert.equal(d?.decision, 'deny', cmd);
    assert.equal(d.id, id, cmd);
  }
});

test('deny rules: the same words in harmless positions are not denied', () => {
  // `rm -rf .` and `rm -rf *` only reach the home directory when the cwd is home.
  assert.equal(run('rm -rf .', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm -rf *', { cwd: '/h/' })?.id, 'rm-root-home');
  assert.equal(run('rm -rf ./', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm -rf ./*', { cwd: '/h' })?.id, 'rm-root-home');
  // Away from home the same commands are not a deny; they ask (rm-recursive-cwd).
  for (const [cmd, cwd] of [['rm -rf .', CWD], ['rm -rf *', CWD], ['rm -rf .', '/h/project']]) {
    const d = run(cmd, { cwd });
    assert.equal(d?.decision, 'ask', cmd);
    assert.equal(d.id, 'rm-recursive-cwd', cmd);
  }
  assert.equal(run('rm -f *', { cwd: '/h' }), null, 'not recursive');
  assert.equal(run('rm -rf build', { cwd: '/h' }), null);
  // Every spelling of "recursive" counts: upper-case -R, a cluster holding it, and the long option.
  assert.equal(run('rm -R *', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm -fR .', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm --recursive .', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm --recursive --force *', { cwd: '/h' })?.id, 'rm-root-home');
  assert.equal(run('rm --force *', { cwd: '/h' }), null, 'a long option that is not --recursive');
  assert.equal(run('rm -R *', { cwd: CWD }).id, 'rm-recursive-cwd');
  assert.equal(run('rm --recursive .', { cwd: CWD }).id, 'rm-recursive-cwd');
  const rows = [
    'rm -rf ~/projects/x/build',
    'rm -rf /h/projects',
    'rm -rf /tmp/x',
    'rm -rf /private/tmp/x',
    'rm -rf /usr/local/lib/foo',
    'rm -rf /Users/u/p/build',
    'rm -rf $D',
    'rm -rf "$HOME"/x',
    'echo rm -rf ~',
    'ls ~',
    'dd if=/dev/zero of=out.img bs=1m count=1',
    'dd if=/dev/disk2 of=backup.img',
    'echo x > /dev/null',
    'cat a > /dev/stdout',
    'mkfs.ext4 disk.img',
    'diskutil list',
    'diskutil info disk2',
    // Only dd writes `of=`, only a path that starts at /dev is a device, and only diskutil erases.
    'echo of=/dev/sda',
    'dd of=build/dev/sda1.img',
    'dd of=./dev/sdb if=img',
    'echo x > ./dev/sdb',
    'echo x > build/dev/sda1.img',
    'echo x >> out/dev/disk2',
    'grep eraseDisk notes.md',
    'man diskutil eraseDisk',
    'echo diskutil eraseDisk disk2',
    'git log --grep=eraseDisk',
    'echo mkfs.ext4 /dev/sdb1',
    // A system directory is only dangerous as the target of rm, so naming one to another command is fine.
    'ls /usr',
    'cd /etc',
    'echo /var',
    'du -sh /opt',
    'stat /opt',
    'find /usr/local -name x',
    'ls -la /Users /home',
  ];
  for (const cmd of rows) assert.equal(run(cmd), null, cmd);
});

test('the fork bomb is the one raw-text rule: it matches the command text, whatever the spacing', () => {
  assert.equal(run(':()   {  : | :  &  }  ;  :')?.id, 'fork-bomb');
  assert.equal(run('echo start\n:(){ :|:& };:\necho end')?.id, 'fork-bomb');
});

test('not denied: look-alikes of the deny tier return null', () => {
  const rows = [
    'rm -f /var/folders/0t/a/T/s.json',
    'rm -rf /usr/local/lib/foo',
    'cat ~/.ssh/id_ed25519.pub',
    "env -i PATH=/usr/bin:/bin HOME=$HOME bash -c 'rm -rf /Users/u/p/build'",
  ];
  for (const cmd of rows) assert.equal(run(cmd), null, cmd);
});

test('deny rules: every system directory and every disk device prefix is covered', () => {
  const systemDirs = ['/bin', '/boot', '/dev', '/etc', '/lib', '/opt', '/private', '/proc', '/sbin', '/sys', '/usr', '/var', '/System',
    '/Library', '/Applications', '/Users', '/home', '/root'];
  for (const dir of systemDirs) {
    for (const cmd of [`rm -rf ${dir}`, `rm -rf ${dir}/`, `rm -rf ${dir}/*`, `sudo rm -r ${dir}`]) {
      const d = run(cmd);
      assert.equal(d?.decision, 'deny', cmd);
      assert.equal(d.id, 'rm-system-dir', cmd);
    }
    // Only the directory itself (or everything directly under it) is denied, never a lookalike name.
    for (const cmd of [`rm -rf ${dir}x`, `rm -rf ${dir}-old`, `rm -rf ${dir}/a/b`]) assert.equal(run(cmd), null, cmd);
  }

  // dd and a redirect, for every device family the rule names. Pseudo devices are not disks.
  const disks = ['/dev/disk2', '/dev/rdisk3', '/dev/sda', '/dev/sda1', '/dev/hda', '/dev/hdb2', '/dev/vda', '/dev/vdb1', '/dev/xvda', '/dev/xvdf1',
    '/dev/nvme0n1', '/dev/nvme0n1p1', '/dev/mmcblk0', '/dev/mmcblk0p1'];
  for (const dev of disks) {
    for (const cmd of [`dd if=img of=${dev}`, `echo x > ${dev}`, `echo x >> ${dev}`]) {
      const d = run(cmd);
      assert.equal(d?.decision, 'deny', cmd);
      assert.equal(d.id, 'disk-write', cmd);
    }
  }
  for (const dev of ['/dev/null', '/dev/zero', '/dev/tty', '/dev/stdout', '/dev/stderr', '/dev/random', '/dev/fd/3', '/dev/shm/x', '/dev/pts/0']) {
    for (const cmd of [`dd if=img of=${dev}`, `echo x > ${dev}`]) assert.equal(run(cmd), null, cmd);
  }
});

test('read-secret asks (never denies) for ask-tier paths', () => {
  const rows = [
    // [command, pathId]
    ['cat .env', 'env-file'],
    ['cat test/fixtures/fake.key', 'private-key-file'],
    ['grep KEY .env.local', 'env-file'],
    ['cat ~/.aws/config', 'aws-config'],
    ['ls | xargs -I{} cat {}/.env', 'env-file'],
    ['export $(cat .env | xargs)', 'env-file'],
    ['bash -c "cat .env"', 'env-file'],
    ['( cat .env )', 'env-file'],
  ];
  for (const [cmd, pathId] of rows) {
    const d = run(cmd);
    assert.equal(d?.decision, 'ask', cmd);
    assert.equal(d.id, 'read-secret', cmd);
    assert.equal(d.pathId, pathId, cmd);
    assert.ok(d.reason.startsWith('constellation-guard [read-secret] '), d.reason);
    assert.ok(d.reason.endsWith(ASK_TAIL), d.reason);
  }
});

test('read-secret: every reader denies a deny-tier path and asks for an ask-tier one', () => {
  const readers = ['cat', 'tac', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'view', 'nl', 'strings', 'xxd', 'hexdump', 'od', 'base64',
    'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'gawk', 'sed', 'cut', 'sort', 'uniq', 'diff', 'cmp', 'jq', 'yq'];
  // These take a pattern, script or filter first, so the file comes after it.
  const takesPattern = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'sed', 'awk', 'gawk', 'jq']);
  assert.equal(new Set(readers).size, readers.length, 'no name twice');
  for (const name of readers) {
    const lead = takesPattern.has(name) ? 'x ' : '';
    const deny = run(`${name} ${lead}~/.ssh/id_rsa`);
    assert.equal(deny?.decision, 'deny', name);
    assert.equal(deny.id, 'read-secret', name);
    assert.equal(deny.pathId, 'ssh-private-key', name);
    const ask = run(`${name} ${lead}.env`);
    assert.equal(ask?.decision, 'ask', name);
    assert.equal(ask.id, 'read-secret', name);
    assert.equal(ask.pathId, 'env-file', name);
    // A reader's name is only a reader as the command word. Anywhere else the key's name is only
    // mentioned: net B asks, and never denies.
    const text = run(`echo ${name} ~/.ssh/id_rsa`);
    assert.equal(text?.decision, 'ask', name);
    assert.equal(text.id, 'secret-path-mentioned', name);
  }
});

test('read-secret: which words of a reader are paths', () => {
  const rows = [
    // [command, expected pathId or null]
    // grep, rg, sed, awk and jq take their pattern (or script, or filter) first.
    ['grep .env src', null],
    ['grep -rn .env src', null],
    ['rg -n .env .', null],
    // After `--` a word that looks like an option is a word: here the pattern.
    ['grep -- --file=.env x', null],
    ['jq .env config.json', null],
    ["sed -n '/.env/p' notes.txt", null],
    ['awk /.env/ notes.txt', null],
    ['grep -e foo .env', 'env-file'],
    ['grep --regexp=foo .env', 'env-file'],
    ['grep -f pats .env', 'env-file'],
    ['grep --file=.env x', 'env-file'],
    ['grep -ie foo .env', 'env-file'],
    ['sed -e p .env', 'env-file'],
    ["sed -i '' s/a/b/ .env", 'env-file'],
    ['sed -n p .env', 'env-file'],
    ['jq -f prog.jq .env', 'env-file'],
    ["awk '{print}' .env", 'env-file'],
    ['awk -f prog.awk .env', 'env-file'],
    ['rg foo -- .env', 'env-file'],
    ['grep foo -- .env', 'env-file'],
    // The other readers take every word as a path.
    ['cat -n .env', 'env-file'],
    ['head -5 .env.local', 'env-file'],
    ['tail -f .env', 'env-file'],
    ['less .env', 'env-file'],
    ['bat .env', 'env-file'],
    ['base64 .env', 'env-file'],
    ['strings server.pem', 'private-key-file'],
    ['xxd cert.p12', 'private-key-file'],
    ['diff .env .env.production', 'env-file'],
    ['diff a.txt .env', 'env-file'],
    ['sort .env', 'env-file'],
    ['cut -d= -f2 .env', 'env-file'],
    ['yq .a .env', 'env-file'],
    // yq is a reader but not a pattern reader (the brief lists jq only): its filter is checked as a
    // path too, which is a prompt at worst. jq's filter `.env` above is not.
    ['yq .env config.yml', 'env-file'],
    ['cat secrets.json', 'secrets-file'],
    ['cat .aws', 'secret-dir'],
    ['grep -r token ~/.ssh', 'secret-dir'],
    ['cat ~/.ssh/*', 'secret-dir'],
    // A glob argument is read as a glob too.
    ['cat .env*', 'env-file'],
    ['grep foo .env*', 'env-file'],
    ['cat certs/*.pem', 'private-key-file'],
    ['cat ~/.ssh/id_*', 'ssh-private-key'],
    ['cat ~/.ssh/id_*.pub', null],
    // A brace word is a glob too: the alternatives are expanded and each one is classified.
    ['cat ~/.ssh/{id_rsa,id_rsa.pub}', 'ssh-private-key'],
    ['cat ~/.ssh/{id_ed25519}', 'ssh-private-key'],
    ['cat {.env,x}', 'env-file'],
    ['grep -c . {.env,x}', 'env-file'],
    ['cat ~/.ssh/{id_rsa.pub,known_hosts}', null],
    ['cat {a,b}.txt', null],
    ['find . -exec cat {} +', null],
    ['cat src/*.ts', null],
    ['cat *', null],
    ['cat [a-z]*.md', null],
    ['cat /h/.config/gcloud/credentials.db', 'gcloud-creds'],
    // Any command reading a secret through `<` does.
    ['wc -l < .env', 'env-file'],
    ['tr a b < .env.local', 'env-file'],
    ['wc -l < .env.example', null],
    ['cat < .env.sh', null],
  ];
  for (const [cmd, pathId] of rows) {
    const d = run(cmd);
    if (pathId === null) assert.equal(d, null, cmd);
    else {
      assert.equal(d?.id, 'read-secret', cmd);
      assert.equal(d.pathId, pathId, cmd);
    }
  }
  const d = run('sort < ~/.ssh/id_rsa');
  assert.equal(d.decision, 'deny');
  assert.equal(d.pathId, 'ssh-private-key');
  // A command that is not a reader does not read. Naming the secret is still a mention, which
  // safety net B asks about (guard-secrets.test.js covers it), so it is not a read-secret hit.
  for (const cmd of ['ls .env', 'file .env', 'echo .env', 'wc -l .env', 'cd .ssh']) {
    assert.equal(run(cmd)?.id, 'secret-path-mentioned', cmd);
  }
});

test('read-secret: the value of an option is neither the pattern nor a file', () => {
  // A valued option in front of the pattern (-A 2, -t md, -v k=1, --arg k v) used to shift the words
  // by one: its value passed for the pattern and the real pattern was read as a file, so a search
  // FOR the name `id_rsa` was denied, and a deny cannot be approved. So was the value of -e.
  const searches = [
    'rg -t md id_rsa docs',
    'rg --type md id_rsa docs',
    'rg --type=md id_rsa docs',
    "rg -g '*.md' id_rsa",
    'rg -A 2 -B 2 id_rsa docs',
    'rg -r X id_rsa docs',
    'rg -it md id_rsa docs',
    'rg -e id_rsa docs',
    'ag -m 1 id_rsa docs',
    'grep -A 2 id_rsa README.md',
    'grep -A2 id_rsa README.md',
    'grep -C 3 id_rsa README.md',
    'grep -B 2 id_rsa README.md',
    'grep -m 1 id_rsa README.md',
    'grep -d skip -r id_rsa .',
    'grep -nA 2 id_rsa README.md',
    'grep -e id_rsa README.md',
    'grep -ie id_rsa README.md',
    'grep -ne id_rsa README.md',
    'fgrep -A 2 id_rsa README.md',
    'grep -rn -e id_rsa -e id_ed25519 docs',
    'grep --regexp id_rsa README.md',
    'grep --regexp=id_rsa README.md',
    'grep --include "*.md" -rn id_rsa .',
    'grep --exclude-dir node_modules -rn id_rsa .',
    'egrep -A 1 id_rsa README.md',
    'awk -v k=1 "/id_rsa/" README.md',
    'gawk -v k=1 "/id_rsa/" README.md',
    "awk -F: '/id_rsa/ {print $1}' notes.txt",
    "awk -F : -v k=1 '/id_rsa/' notes.txt",
    'sed -e id_rsa README.md',
    'sed --expression=id_rsa README.md',
    "sed -n -e '/id_rsa/p' notes.txt",
    "jq --arg k id_rsa '.[$k]' README.json",
    "jq -n --argjson n 1 --arg k id_rsa '$k'",
    "jq --arg k v '.id_rsa' README.json",
    'jq --argjson n 1 id_rsa README.json',
    'jq --indent 2 id_rsa README.json',
    // Not pattern suppliers there: ag's -f follows symlinks, jq's -e sets the exit status.
    'ag -f id_rsa docs',
    'jq -e id_rsa README.json',
    // The same shapes with an ask-tier name.
    'grep -A 2 .env README.md',
    'grep -e .env README.md',
    'rg -t md .env docs',
    'jq -e .ssh config.json',
  ];
  for (const cmd of searches) assert.equal(run(cmd), null, cmd);

  // A read after the same options is still a read: only the words that are not files are skipped.
  const reads = [
    'grep -n KEY ~/.ssh/id_rsa',
    'grep -rn -A 2 KEY ~/.ssh/id_rsa',
    'grep -e KEY -e TOKEN ~/.aws/credentials',
    'grep --regexp=KEY ~/.aws/credentials',
    'grep --include "*.md" -rn KEY ~/.aws/credentials',
    'grep -f ~/.ssh/id_rsa notes.txt',
    'grep --file ~/.ssh/id_rsa notes.txt',
    'grep --file=/h/.ssh/id_rsa notes.txt',
    'grep -f/h/.ssh/id_rsa notes.txt',
    'sed -f/h/.ssh/id_rsa notes.txt',
    'grep --exclude-from ~/.ssh/id_rsa -r KEY .',
    'rg --ignore-file ~/.ssh/id_rsa KEY .',
    "gawk -i ~/.ssh/id_rsa '{print}' notes.txt",
    'rg -n KEY ~/.ssh/id_rsa',
    'rg -t md KEY ~/.ssh/id_rsa',
    "rg -g '*.md' -e KEY ~/.ssh/id_rsa",
    "sed -n '1,5p' ~/.ssh/id_rsa",
    'sed -n p ~/.ssh/id_rsa',
    'sed -e p ~/.ssh/id_rsa',
    "sed -i '' s/a/b/ ~/.ssh/id_rsa",
    "awk '{print}' ~/.aws/credentials",
    "awk -F: '{print $1}' ~/.ssh/id_rsa",
    "awk -v k=1 '{print}' ~/.ssh/id_rsa",
    'awk -f prog.awk ~/.ssh/id_rsa',
    'jq . ~/.ssh/id_rsa',
    'jq -e . ~/.ssh/id_rsa',
    'jq -n . ~/.ssh/id_rsa',
    'jq -r .a ~/.aws/credentials',
    'jq --arg k v . ~/.ssh/id_rsa',
    "jq -n --slurpfile k ~/.ssh/id_rsa '$k'",
    'jq -f prog.jq ~/.ssh/id_rsa',
    'jq --from-file prog.jq ~/.ssh/id_rsa',
  ];
  for (const cmd of reads) {
    const d = run(cmd);
    assert.equal(d?.decision, 'deny', cmd);
    assert.equal(d.id, 'read-secret', cmd);
  }
  // `--args` ends the files of jq: what follows are values for $ARGS.
  assert.equal(run("jq -n '$ARGS' --args id_rsa x"), null);
  assert.equal(run("jq -n '$ARGS' --jsonargs 1 id_rsa"), null);
  assert.equal(run('jq . ~/.ssh/id_rsa --args x').decision, 'deny');

  // The common flags are known not to take a value, so they never turn a read into an ask.
  const flagged = ['grep -r', 'grep -rn', 'grep -rnI', 'grep -i', 'grep -v', 'grep -l', 'grep -c', 'grep -w', 'grep -o', 'grep -E', 'grep -F',
    'grep -H', 'grep -h', 'grep -s', 'grep -q', 'grep --color=never', 'grep --recursive', 'grep --ignore-case', 'grep --line-number',
    'egrep -n', 'fgrep -n', 'rg -n', 'rg -i', 'rg -l', 'rg -S', 'rg -s', 'rg -uu', 'rg -N', 'rg -F', 'rg -w', 'rg -H', 'rg --hidden',
    'rg --no-ignore', 'rg --files-with-matches', 'rg --line-number', 'ag -f', 'ag -i', 'ag -l', 'ag -Q', 'ag --hidden', 'sed -n', 'sed -E',
    'sed -r', 'sed -s', 'sed --quiet', 'sed --regexp-extended', 'awk -b', 'gawk --traditional', 'jq -r', 'jq -c', 'jq -e', 'jq -s', 'jq -S',
    'jq -n', 'jq -nr', 'jq --raw-output', 'jq --compact-output', 'grep -r --'];
  for (const prefix of flagged) {
    const d = run(`${prefix} KEY ~/.ssh/id_rsa`);
    assert.equal(d?.decision, 'deny', prefix);
  }
});

test('read-secret: a word that may be an option value or the pattern can ask but never deny', () => {
  // An option the tables do not list might take a value, so which word is the pattern is not
  // known. A deny-tier name in a place that is a file on only some readings asks instead.
  const asks = [
    ['grep --nope KEY ~/.ssh/id_rsa', 'ssh-private-key'],
    ['rg --nope KEY ~/.aws/credentials', 'aws-credentials'],
    ['grep -J KEY ~/.ssh/id_rsa', 'ssh-private-key'],
    ['sed -i s/a/b/ ~/.ssh/id_rsa', 'ssh-private-key'],
    ['awk -d KEY ~/.ssh/id_rsa', 'ssh-private-key'], // BSD grep -J and gawk -d are deliberately not in the tables
    ['grep --nope=~/.ssh/id_rsa KEY notes.txt', 'ssh-private-key'],
    // ag's context options take an optional value: `2` is their value or the pattern, so id_rsa is a path or the pattern.
    ['ag -A 2 id_rsa docs', 'ssh-private-key'],
  ];
  for (const [cmd, pathId] of asks) {
    const d = run(cmd);
    assert.equal(d?.decision, 'ask', cmd);
    assert.equal(d.id, 'read-secret', cmd);
    assert.equal(d.pathId, pathId, cmd);
    assert.ok(d.reason.endsWith(ASK_TAIL), d.reason);
  }
  // Nothing is lost for the ask tier, and a word that is a file on every reading still denies.
  assert.equal(run('grep --nope KEY .env').decision, 'ask');
  // (ag's context options take an optional value, so `-A 2 KEY` reads KEY as the pattern or as a file; the key is a file either way.)
  for (const cmd of ['grep --nope KEY a ~/.ssh/id_rsa', 'grep --nope=x KEY ~/.ssh/id_rsa', 'grep -n --nope KEY a ~/.aws/credentials',
    'ag -A 2 KEY ~/.ssh/id_rsa']) {
    assert.equal(run(cmd)?.decision, 'deny', cmd);
  }
  // And the pattern itself is still not a file, whatever the options before it.
  assert.equal(run('grep --nope id_rsa README.md'), null);
  assert.equal(run('grep --nope id_rsa'), null);
});

test('precedence: deny beats ask, then the lowest position wins, then table order', () => {
  const deny = run('cat .env; cat ~/.ssh/id_rsa');
  assert.equal(deny.decision, 'deny');
  assert.equal(deny.pathId, 'ssh-private-key');
  const denyFirst = run('cat ~/.ssh/id_rsa; cat .env');
  assert.equal(denyFirst.decision, 'deny');
  assert.equal(denyFirst.pathId, 'ssh-private-key');
  // Inside one segment too: an approved prompt must never read a key that sits beside an ask-tier file.
  for (const [cmd, pathId] of [
    ['cat .env ~/.ssh/id_rsa', 'ssh-private-key'],
    ['cat ~/.ssh/id_rsa .env', 'ssh-private-key'],
    ['grep KEY .env ~/.aws/credentials', 'aws-credentials'],
    ['grep KEY ~/.aws/credentials .env', 'aws-credentials'],
    ['cat .env < ~/.ssh/id_rsa', 'ssh-private-key'],
  ]) {
    const d = run(cmd);
    assert.equal(d?.decision, 'deny', cmd);
    assert.equal(d.id, 'read-secret', cmd);
    assert.equal(d.pathId, pathId, cmd);
  }

  const ask = run('cat .env; cat .env.local');
  assert.equal(ask.decision, 'ask');
  assert.match(ask.reason, /reading \.env \(env-file\)/);
  assert.doesNotMatch(ask.reason, /\.env\.local/);
  const later = run('cat .env.local; cat .env');
  assert.match(later.reason, /reading \.env\.local /);

  // A deny from a different rule still beats an earlier ask, wherever it hides.
  assert.equal(run('cat .env && rm -rf ~').id, 'rm-root-home');
  assert.equal(run('cat .env; echo $(rm -rf /)').id, 'rm-root-home');
  assert.equal(run("cat .env; bash -c 'cat ~/.aws/credentials'").pathId, 'aws-credentials');
  // Same tier, same segment: the rule that comes first in the table wins.
  const same = run('mkfs.ext4 /dev/sdb1 > /dev/sda');
  assert.equal(same.id, 'disk-write');
  assert.ok(RULES.findIndex((r) => r.id === 'disk-write') < RULES.findIndex((r) => r.id === 'disk-format'));
});

test('classifier units: classifyPath', () => {
  assert.deepEqual(classifyPath('.env', HOME), { pathId: 'env-file', tier: 'ask' });
  assert.equal(classifyPath('.env.sh', HOME), null);
  assert.equal(classifyPath('.env.example', HOME), null);
  assert.equal(classifyPath('id_ed25519.pub', HOME), null);
  assert.deepEqual(classifyPath('/h/.ssh', HOME), { pathId: 'secret-dir', tier: 'ask' });

  // Deny tier, with ~, $HOME and ${HOME} expanded first.
  const ssh = { pathId: 'ssh-private-key', tier: 'deny' };
  for (const p of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ed25519_sk', 'id_ecdsa_sk', '/x/y/id_rsa', '~/.ssh/id_ed25519',
    '$HOME/.ssh/id_rsa', '${HOME}/.ssh/id_rsa', '/h/.ssh/id_custom', '.ssh/id_work', '/h/.ssh/id_rsa.bak', '/h/.ssh/./id_rsa', '/h/.ssh//id_rsa']) {
    assert.deepEqual(classifyPath(p, HOME), ssh, p);
  }
  for (const p of ['/h/.ssh/id_rsa.pub', '/h/.ssh/id_custom.pub', 'id_rsa.pub', 'id_rsa_old', 'my_id_rsa', '/p/id_rsa.txt', 'id_x']) {
    assert.equal(classifyPath(p, HOME), null, p);
  }
  const aws = { pathId: 'aws-credentials', tier: 'deny' };
  // The aws pattern is anchored on the normalized path, so `.`, `//` and `..` cannot hide the file.
  for (const p of ['~/.aws/credentials', '$HOME/.aws/credentials', '${HOME}/.aws/credentials', '/h/.aws/credentials', '.aws/credentials',
    '~/.aws/./credentials', '~/.aws//credentials', '~/.aws/x/../credentials']) {
    assert.deepEqual(classifyPath(p, HOME), aws, p);
  }
  assert.equal(classifyPath('/h/.aws/credentials.bak', HOME), null);
  // ...and on a whole directory name, so a directory that only ends in `.aws` or `.ssh` is not the
  // real one. A deny cannot be approved, so a false deny here would block a harmless read for good.
  for (const p of ['/h/my.aws/credentials', '/h/foo.ssh/id_x']) assert.equal(classifyPath(p, HOME), null, p);

  // Ask tier.
  for (const p of ['.env', '.env.local', '.env.production', '/p/.env', '~/proj/.env.test', '.env.local.bak', './.env', 'a/../.env']) {
    assert.deepEqual(classifyPath(p, HOME), { pathId: 'env-file', tier: 'ask' }, p);
  }
  for (const p of ['.env.example', '.env.sample', '.env.template', '.env.schema', '.env.defaults', '.env.dist', '.env.sh', '.env.md',
    '.env.local.example', 'process.env.ts', 'foo.env', 'env', '.environment', '.env.', '~/.env.sh']) {
    assert.equal(classifyPath(p, HOME), null, p);
  }
  const ask = (pathId) => ({ pathId, tier: 'ask' });
  const rows = [
    ['server.pem', 'private-key-file'], ['tls.KEY', 'private-key-file'], ['a/b.p12', 'private-key-file'], ['c.pfx', 'private-key-file'],
    ['store.jks', 'private-key-file'], ['x.keystore', 'private-key-file'], ['test/fixtures/fake.key', 'private-key-file'],
    ['secrets.json', 'secrets-file'], ['secret.yaml', 'secrets-file'], ['credentials.toml', 'secrets-file'], ['credential.yml', 'secrets-file'],
    ['/p/Secrets.JSON', 'secrets-file'],
    ['~/.ssh', 'secret-dir'], ['/h/.ssh/', 'secret-dir'], ['/h/.ssh/*', 'secret-dir'], ['.aws', 'secret-dir'], ['/h/.aws/', 'secret-dir'],
    ['.envrc', 'envrc'], ['/p/.envrc', 'envrc'],
    ['/h/.ssh/authorized_keys', 'ssh-authorized-keys'],
    ['/h/.aws/config', 'aws-config'],
    ['/h/.kube/config', 'kube-config'],
    ['/p/service-account.json', 'service-account'], ['/p/gcp_serviceaccount-prod.json', 'service-account'],
    ['/h/.config/gcloud/credentials.db', 'gcloud-creds'], ['/h/.config/gcloud/application_default_credentials.json', 'gcloud-creds'],
    ['/h/.azure/accessTokens.json', 'azure-creds'], ['/h/.azure/credentials', 'azure-creds'],
    ['/h/.docker/config.json', 'docker-config'],
    ['/h/.netrc', 'netrc'], ['/h/.npmrc', 'npmrc'], ['/h/.pypirc', 'pypirc'],
    ['/h/.gem/credentials', 'gem-credentials'],
    ['/h/.vault-token', 'vault-token'], ['vault-token', 'vault-token'],
    ['/etc/apache2/.htpasswd', 'htpasswd'], ['htpasswd', 'htpasswd'],
    ['/h/.pgpass', 'pgpass'], ['/h/.my.cnf', 'my-cnf'],
  ];
  for (const [p, pathId] of rows) assert.deepEqual(classifyPath(p, HOME), ask(pathId), p);

  // A path longer than any file system allows is not classified (and costs no time to skip).
  assert.equal(classifyPath('a/'.repeat(2100) + '.env', HOME), null);
  assert.deepEqual(classifyPath('a/'.repeat(1000) + '.env', HOME), { pathId: 'env-file', tier: 'ask' });
  const slow = process.hrtime.bigint();
  assert.equal(run('cat ' + 'serviceaccount'.repeat(4500)), null);
  assert.ok(Number(process.hrtime.bigint() - slow) / 1e6 < 1000, 'one huge word must not take a second');

  for (const p of ['', undefined, null, 42, 'README.md', 'src/index.js', '/h/.claude.json', '/h/.sshd', '/h/.awsome', 'a.pem.txt', '-', '.']) {
    assert.equal(classifyPath(p, HOME), null, String(p));
  }
});

test('classifier units: globTargetsSecret', () => {
  for (const g of ['.env*', '.env.*', '**/*.pem', '*.key', '.envrc', 'id_rsa*', '**/.env', 'src/**/.env.*', '*.{pem,key}', '{.env,x}', '*.ts,*.pem', '.env, x']) {
    assert.ok(globTargetsSecret(g, HOME), g);
  }
  assert.deepEqual(globTargetsSecret('.env*', HOME), { pathId: 'env-file', tier: 'ask' });
  assert.deepEqual(globTargetsSecret('.env.*', HOME), { pathId: 'env-file', tier: 'ask' });
  assert.deepEqual(globTargetsSecret('**/*.pem', HOME), { pathId: 'private-key-file', tier: 'ask' });
  assert.deepEqual(globTargetsSecret('id_rsa*', HOME), { pathId: 'ssh-private-key', tier: 'deny' });
  assert.equal(globTargetsSecret('{.env,id_rsa}', HOME).tier, 'deny', 'a deny alternative wins');
  for (const g of ['*.ts', '**/*.ts', '*', '**', 'src/**', '*.{ts,tsx}', '.env.example', '.environment*', '', undefined, null]) {
    assert.equal(globTargetsSecret(g, HOME), null, String(g));
  }
  // Only the last `/` segment of a glob is judged. The directory part is classifyPath's job, which
  // readSecret runs on the whole word first: `cat ~/.ssh/id_*` and `cat ~/.ssh/*` are caught there.
  assert.equal(globTargetsSecret('~/.ssh/id_*', HOME), null);
  assert.equal(globTargetsSecret('/h/.ssh/*', HOME), null);
  assert.deepEqual(globTargetsSecret('/h/.ssh/{id_rsa,x}', HOME), { pathId: 'ssh-private-key', tier: 'deny' });
  assert.deepEqual(globTargetsSecret('a/b/c/*.pem', HOME), { pathId: 'private-key-file', tier: 'ask' });
});

test('unparsed: input the parser could not read asks, and hits in the read part still count', () => {
  const big = 'echo ' + 'a'.repeat(65 * 1024);
  const four = "bash -c " + shq("bash -c " + shq("bash -c " + shq("bash -c 'echo hi'")));
  for (const cmd of [big, four, "env -S 'echo hi'", 'env -a x -S "cat y"']) {
    const d = run(cmd);
    assert.equal(d?.decision, 'ask', cmd.slice(0, 40));
    assert.equal(d.id, 'unparsed-command', cmd.slice(0, 40));
    assert.equal(run(cmd, { env: { CONSTELLATION_GUARD: 'critical' } }), null, cmd.slice(0, 40));
  }
  assert.match(run(big).reason, /could not .*read.*\(size\)/);
  assert.match(run(four).reason, /\(depth\)/);
  assert.match(run("env -S 'echo hi'").reason, /\(env -S\)/);

  // A deny in the part that was read still denies, with or without padding behind it.
  assert.equal(run('rm -rf ~;' + ' '.repeat(65 * 1024)).id, 'rm-root-home');
  assert.equal(run('rm -rf ~; echo ' + 'a'.repeat(65 * 1024)).decision, 'deny');
  assert.equal(run('cat ~/.ssh/id_rsa\n' + '#'.repeat(65 * 1024)).decision, 'deny');
  // The unread part of 65 KiB of comments could hold a command: ask even with no segment at all.
  const comment = run('# ' + 'x'.repeat(65 * 1024) + '\nrm -rf ~');
  assert.equal(comment.id, 'unparsed-command');
  // A read secret and an unread tail: both ask, and the read-secret rule (earlier in the table) names it.
  assert.equal(run('cat .env\n' + '#'.repeat(65 * 1024)).id, 'read-secret');
  // Within the limits nothing is unparsed.
  assert.equal(run('echo ' + 'a'.repeat(60 * 1024)), null);
  assert.equal(run("bash -c 'bash -c \"bash -c \\\"echo hi\\\"\"'"), null);
});

test('env: CONSTELLATION_GUARD=critical keeps only the deny tier', () => {
  const critical = { CONSTELLATION_GUARD: 'critical' };
  assert.equal(run('cat .env', { env: critical }), null);
  assert.equal(run('cat ~/.aws/config', { env: critical }), null);
  assert.equal(run('cat ~/.ssh/id_rsa', { env: critical }).decision, 'deny');
  assert.equal(run('rm -rf ~', { env: critical }).id, 'rm-root-home');
  assert.equal(run('a[0]=1 ls', { env: critical }), null);
  // Every other value runs every rule.
  for (const v of ['off', 'high', 'all', '', 'strict', 'CRITICAL', ' critical']) {
    const d = run('cat .env', { env: { CONSTELLATION_GUARD: v } });
    assert.equal(d?.decision, 'ask', JSON.stringify(v));
  }
  assert.equal(run('cat .env', { env: { CONSTELLATION_GUARD: undefined } }).decision, 'ask');
});

test('env: CONSTELLATION_GUARD_ASK=deny turns an ask into a deny with the fallback text', () => {
  const env = { CONSTELLATION_GUARD_ASK: 'deny' };
  const d = run('cat .env', { env });
  assert.equal(d.decision, 'deny');
  assert.equal(d.id, 'read-secret');
  assert.equal(d.pathId, 'env-file');
  assert.match(d.reason, /CONSTELLATION_GUARD=critical/);
  assert.match(d.reason, /^constellation-guard \[read-secret\] .+\. Denied because CONSTELLATION_GUARD_ASK=deny; ask the user to run it, or to restart with CONSTELLATION_GUARD=critical to skip non-critical checks\.$/);
  // It leaves a real deny alone, and any other value leaves an ask alone.
  assert.doesNotMatch(run('cat ~/.ssh/id_rsa', { env }).reason, /ASK=deny/);
  assert.equal(run('cat .env', { env: { CONSTELLATION_GUARD_ASK: 'ask' } }).decision, 'ask');
  assert.equal(run('cat .env', { env: { CONSTELLATION_GUARD_ASK: 'DENY' } }).decision, 'ask');
  // With the critical tier on as well, the ask never exists, so nothing is converted.
  assert.equal(run('cat .env', { env: { ...env, CONSTELLATION_GUARD: 'critical' } }), null);
});

test('env is read on every call, never cached', () => {
  assert.equal(run('cat .env', { env: { CONSTELLATION_GUARD: 'critical' } }), null);
  assert.equal(run('cat .env', { env: {} }).decision, 'ask');
  assert.equal(run('cat .env', { env: { CONSTELLATION_GUARD_ASK: 'deny' } }).decision, 'deny');
  assert.equal(run('cat .env', { env: {} }).decision, 'ask');
});

test('non-interactive: an ask becomes a deny when nobody can answer it', () => {
  const sub = run('cat .env', { payload: { agent_id: 'a1' } });
  assert.equal(sub.decision, 'deny');
  assert.equal(sub.id, 'read-secret');
  assert.equal(sub.pathId, 'env-file');
  assert.match(sub.reason, /^constellation-guard \[read-secret\] .+\. Subagents cannot ask, so this was denied; report the exact command to your controller instead of working around it\.$/);

  const headless = run('cat .env', { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } });
  assert.equal(headless.decision, 'deny');
  assert.match(headless.reason, /^constellation-guard \[read-secret\] .+\. Headless runs cannot ask, so this was denied; report the exact command instead of working around it\.$/);

  // SDK apps can answer through a permission callback, and the desktop app has a user.
  for (const v of ['sdk-ts', 'sdk-py', 'claude-desktop', 'cli', 'SDK-CLI', 'sdk-cli ', 'sdk-cli-x', '']) {
    assert.equal(run('cat .env', { env: { CLAUDE_CODE_ENTRYPOINT: v } }).decision, 'ask', JSON.stringify(v));
  }
  // agent_id counts only when set.
  for (const v of [undefined, '', null]) assert.equal(run('cat .env', { payload: { agent_id: v } }).decision, 'ask', String(v));

  // A deny keeps the deny template: it is not an ask that was converted.
  const hard = run('cat ~/.ssh/id_rsa', { payload: { agent_id: 'a1' } });
  assert.equal(hard.decision, 'deny');
  assert.match(hard.reason, /blocked: .+ This cannot be approved from a prompt/);
  assert.doesNotMatch(hard.reason, /Subagents cannot ask/);
  const hardHeadless = run('rm -rf ~', { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } });
  assert.match(hardHeadless.reason, /^constellation-guard \[rm-root-home\] blocked: .+\. This cannot be approved/);

  // Order: subagent, then headless, then the ASK=deny fallback.
  assert.match(run('cat .env', { payload: { agent_id: 'a1' }, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_GUARD_ASK: 'deny' } }).reason, /Subagents cannot ask/);
  assert.match(run('cat .env', { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_GUARD_ASK: 'deny' } }).reason, /Headless runs cannot ask/);
  assert.match(run('cat .env', { env: { CONSTELLATION_GUARD_ASK: 'deny' } }).reason, /Denied because CONSTELLATION_GUARD_ASK=deny/);

  // The critical tier still removes the ask first, so a subagent is not blocked on it.
  assert.equal(run('cat .env', { payload: { agent_id: 'a1' }, env: { CONSTELLATION_GUARD: 'critical' } }), null);
});

test('reasons never contain the plugin namespace prefix that the skill lint flags', () => {
  const cmds = ['cat .env', 'cat ~/.ssh/id_rsa', 'rm -rf ~', 'a[0]=1 ls', "env -S 'x'", 'dd of=/dev/sda'];
  const variants = [{}, { payload: { agent_id: 'a' } }, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }, { env: { CONSTELLATION_GUARD_ASK: 'deny' } }];
  for (const cmd of cmds) {
    for (const v of variants) {
      const d = run(cmd, v);
      assert.ok(d.reason.startsWith('constellation-guard ['), cmd);
      assert.ok(!d.reason.includes('constellation' + ':'), cmd);
    }
  }
});

test('reasons quote a word safely: control characters become spaces and long words are cut', () => {
  // The word comes from the command, so it is shortened (80 characters at most) before it is shown.
  const at = (len) => 'd'.repeat(len - 5) + '/.env';
  const ok = at(80);
  assert.equal(ok.length, 80);
  assert.ok(run('cat ' + ok).reason.includes(`reading ${ok} (env-file)`), 'a word of 80 characters is shown whole');
  const cut = at(81);
  assert.equal(cut.length, 81);
  assert.ok(run('cat ' + cut).reason.includes(`reading ${cut.slice(0, 77)}... (env-file)`), 'a word of 81 characters is cut to 77 plus ...');
  const huge = at(2000);
  const reason = run('cat ' + huge).reason;
  assert.ok(!reason.includes(huge) && reason.length < 400, 'a long word does not flood the reason');
  // The same for the words that deny rules quote.
  const longRoot = '/' + 'a/'.repeat(50) + '../'.repeat(50);
  const rm = run('rm -rf ' + longRoot);
  assert.equal(rm.id, 'rm-root-home');
  assert.ok(rm.reason.includes(`removing ${longRoot.slice(0, 77)}... would delete`), rm.reason);

  // Newline, tab and other control characters inside a quoted word cannot reshape the message.
  for (const [cmd, shownWord] of [['cat "a\nb/.env"', 'a b/.env'], ['cat "a\tb/.env"', 'a b/.env'], ['cat "a\x01b/.env"', 'a b/.env']]) {
    const d = run(cmd);
    assert.equal(d?.id, 'read-secret', JSON.stringify(cmd));
    assert.ok(d.reason.includes(`reading ${shownWord} (env-file)`), d.reason);
    assert.doesNotMatch(d.reason, /[\x00-\x1f]/);
  }
});

test('safety net A: a command word that is not a plain program name asks', () => {
  const asks = [
    'a[0]=1 cat ~/.ssh/id_rsa',
    'a[0]=1 ls',
    '{fd}>f ls',
    '$CC -o x y.c',
    '"$HOME/bin/tool" arg',
    '${TOOL} --run',
    '$(echo ls) -l',
    '"" x',
    'FOO=bar "" x',
    './build/*.sh',
    'rm\\ x',
    '@foo run',
    '+x run',
    '-x run',
    // Only the exact words `[`, `[[` and `:` run no program. A word that merely starts like them is not plain.
    '[x] run',
    ':x run',
    '*',
    'ls; *',
    'ls; $X',
    'echo $(echo a b) | $X',
    'bash -c "$X"',
    "bash -c 'a[0]=1 ls'",
    'find . -exec {} \\;',
    'echo x | xargs -I% %',
    // A complete `[[ x ]]` closes its own test (it has no `&&` inside, so it is one segment that
    // ends in `]]`). What follows is judged as before; if the test stayed open, every later
    // command word in the same body would skip this net.
    '[[ -f x ]] && $X',
    '[[ -f x ]]; a[0]=1 ls',
    'if [[ -f x ]]; then $X; fi',
    '[[ -f x ]] && ls && $CC y',
  ];
  for (const cmd of asks) {
    const d = run(cmd);
    assert.equal(d?.decision, 'ask', cmd);
    assert.equal(d.id, 'unrecognized-command-word', cmd);
    assert.match(d.reason, /^constellation-guard \[unrecognized-command-word\] unrecognized command word\./, cmd);
    assert.equal(run(cmd, { env: { CONSTELLATION_GUARD: 'critical' } }), null, cmd);
  }
  // Plain: names, and paths made of name characters plus / . ~
  const plain = [
    'ls', 'git status', 'python3 x.py', 'g++ -o x x.cc', 'x86_64-linux-gnu-gcc -c x.c', './scripts/x.sh', '/usr/bin/env FOO=1 ls', 'x=1y=2 ls',
    '~/bin/tool', '../tool', '.venv/bin/pytest', './node_modules/.bin/jest', '/bin/ls', 'a.out', './a.out', '. ./env.sh', 'source ~/.env.sh',
    'FOO=bar ./run.sh', 'ITEM1="5486f8c2" ./run.sh', 'env FOO=bar', 'GITHUB_TOKEN= gh pr list', 'sudo -u root ls', 'command -v git',
    // `[`, `[[` and `:` run no program, so they are as plain as `test -f x`, which passes.
    'test -f x', '[ -f x ] && ls', '[[ -f x ]] && ls', 'if [ -f x ]; then cat x; fi', '[ -d .git ] && git status',
    '[[ -n $X ]] || ls', 'if [ -z "$X" ]; then ls; fi', ': > out.txt', 'while :; do ls; done', 'until [ -f done ]; do sleep 1; done',
    // The parser splits `[[ a && b ]]` at the inner `&&` or `||`; the rest of the test is not a command either.
    '[[ -f x && -d y ]] && echo ok', '[[ -z "$X" || "$X" = foo ]]', 'if [[ $(uname) == Darwin && -f /etc/x ]]; then ls; fi',
    'while [[ $i -lt 3 && -f x ]]; do ls; done', '[[ -f x && ! -d y ]]', '[[ -f x || -d y || -e z ]] && ls', '[[ ( -f x || -d y ) && -f z ]]',
    '[[ -f x && ( -d y || -d z ) ]]', "bash -c '[[ -f x && -d y ]]'", '[[ $( [[ a && b ]] ) == x && -f y ]]',
    '[[ -f x && -d y ]]; [[ -f x && -d y ]]', 'case $x in a) [[ -f x && -d y ]] && ls;; esac',
    // The same checks written the other ways always passed.
    '[[ -f x ]]', '[ -f x -a -d y ]', '[ a ] && [ b ]', '(( a && b ))',
    // The default arm of a case (`*)`) is read as a segment that is only a glob.
    'case $x in a) ls;; *) echo hi;; esac', 'case $x in a) ls;; ?) echo hi;; esac', "bash -c 'case $x in a) ls;; *) echo hi;; esac'",
  ];
  for (const cmd of plain) assert.equal(run(cmd), null, cmd);
  // Nothing behind a `[` is hidden: a reader after `&&` or `||` is its own segment and `$( )` inside the test is a substitution.
  assert.equal(run('[ -f x ] && cat ~/.ssh/id_rsa').pathId, 'ssh-private-key');
  assert.equal(run('[ -f x ] || cat ~/.ssh/id_rsa').decision, 'deny');
  assert.equal(run('[ -f $(cat ~/.ssh/id_rsa) ]').decision, 'deny');
  assert.equal(run('[[ -f x ]] && cat .env').id, 'read-secret');
  assert.equal(run('if [ -f x ]; then cat .env; fi').id, 'read-secret');
  assert.equal(run('if [ -f x ]; then rm -rf ~; fi').id, 'rm-root-home');
  assert.equal(run('case $x in a) cat .env;; *) echo hi;; esac').id, 'read-secret');
  // ...and the same inside `[[ a && b ]]`: only net A skips the rest of the test, every other rule still reads it.
  assert.equal(run('[[ -f x && -d y ]] && cat .env').id, 'read-secret');
  assert.equal(run('[[ -f x && -d y ]] && rm -rf ~').id, 'rm-root-home');
  assert.equal(run('[[ -f x && $(cat ~/.ssh/id_rsa) = y ]]').pathId, 'ssh-private-key');
  assert.equal(run('[[ -f x && -d $(rm -rf ~) ]]').id, 'rm-root-home');
  // A command in a `$( )` inside the test is a segment of its own and net A still judges it.
  assert.equal(run('[[ -f x && $(a[0]=1 ls) = y ]]')?.id, 'unrecognized-command-word');
  assert.equal(run('[[ $(a[0]=1 ls) = y && -f x ]]')?.id, 'unrecognized-command-word');
  // The rest of a test ends at its `]]`: what follows is judged as before.
  assert.equal(run('[[ -f x && -d y ]] && a[0]=1 ls')?.id, 'unrecognized-command-word');
  assert.equal(run('[[ -f x && -d y ]]; $X')?.id, 'unrecognized-command-word');
  assert.equal(run('[[ -f x && -d y ]] && $X')?.id, 'unrecognized-command-word');
  assert.equal(run('if [[ -f x && -d y ]]; then $X; fi')?.id, 'unrecognized-command-word');
  assert.equal(run('[[ a && b ]] && [[ c && d ]] && $X')?.id, 'unrecognized-command-word');
  // A test operand is only exempt behind a `[[`: on its own it is a command word that is not plain.
  assert.equal(run('echo hi && $X ]]')?.id, 'unrecognized-command-word');
  assert.equal(run('[ -f x ] && $X ]]')?.id, 'unrecognized-command-word');
  assert.equal(run('$X [[ -f x && -d y ]]')?.id, 'unrecognized-command-word');
  // The `*)` exemption is for a case statement only: a lone glob as a command asks.
  assert.equal(run('*')?.id, 'unrecognized-command-word');
  assert.equal(run('echo hi; *')?.id, 'unrecognized-command-word');
  // ...and only for a bare `*` or `?`: any other word that is not plain still asks inside a case.
  assert.equal(run('case $x in a) ls;; *) ./*.sh;; esac')?.id, 'unrecognized-command-word');
  assert.equal(run('case $x in a) $CC y;; esac')?.id, 'unrecognized-command-word');
  assert.equal(run('case $x in a) * y;; esac')?.id, 'unrecognized-command-word', 'a glob with arguments is a command');
  // A segment with no command at all has no command word to judge.
  for (const cmd of ['D=/tmp/x', 'A=1 B=2', '> out.txt', '2>/dev/null', '{ ls; }', '! ls', 'X=$(date)', 'if true; then ls; fi', 'for x in 1 2; do ls; done',
    'while true; do ls; done']) {
    assert.equal(run(cmd), null, cmd);
  }
  // A deny still wins over a net-A ask, wherever the ask is.
  assert.equal(run('a[0]=1 ls; rm -rf ~').id, 'rm-root-home');
  assert.equal(run('$X; cat ~/.ssh/id_rsa').pathId, 'ssh-private-key');
  assert.equal(run('a[0]=1 ls; cat .env').id, 'unrecognized-command-word', 'same tier: the lower position wins');
});

test('harmless commands pass: 33 real commands that today\'s guards often block', () => {
  // Sources: the hook logs, the old-guard false positives found while planning, and the check run.
  const corpus = [
    'git diff HEAD~1 -- hooks/x.js',
    'git diff HEAD~1 -- hooks/protect-secrets.js',
    'source ~/.env.sh && make build',
    'source ~/.env.sh && make -j$(sysctl -n hw.ncpu) 2>&1 | tail -5',
    'find skills -name SKILL.md | xargs grep -l CATALOG',
    'rm -rf node_modules && ls',
    'git log --oneline | head -5 && grep -rn Object.keys src',
    'cat -n hooks/protect-secrets.js',
    'cat .claude-plugin/plugin.json | head -20; git log -1 -- hooks/protect-secrets.js',
    'cat .env.example | head -5',
    'head -40 src/process.env.ts',
    "find . -name '*.md' -exec grep -l category {} +",
    'find skills -type f -exec cat {} + | wc -w',
    'git ls-files | xargs wc -l',
    'lsof -ti:5174 | xargs kill',
    'rm -f /tmp/x.log; cd ~',
    'rm -rf dist && node -e "console.log(process.env.HOME)"',
    'printenv PATH',
    'echo "tokens: $TOKEN_COUNT"',
    'echo ${CLAUDE_CODE_OAUTH_TOKEN:+SET}',
    'GITHUB_TOKEN= gh pr list',
    'D=/tmp/x; rm -rf $D',
    "cat > /tmp/b.md <<'EOF'\nreads .env and id_rsa\nEOF",
    "sed -i '' 's/git reset --hard/x/' notes.md",
    'git push --force-with-lease origin feat/x',
    'git branch -d feat/x',
    'git worktree remove .worktrees/x',
    'git clean -n',
    'chmod -R 755 build',
    "curl -X POST https://api.example.com -d '{\"a\":1}'",
    'grep -rn "API_KEY" src',
    'ITEM1="5486f8c2" ./run.sh',
    "cat ~/.claude.json | jq '.mcpServers | keys'",
  ];
  assert.equal(corpus.length, 33);
  assert.equal(new Set(corpus).size, 33);
  for (const cmd of corpus) {
    assert.equal(run(cmd), null, cmd);
    // The same commands are also silent for a subagent and for `claude -p`: nothing to convert.
    assert.equal(run(cmd, { payload: { agent_id: 'a1' } }), null, cmd);
    assert.equal(run(cmd, { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CONSTELLATION_GUARD_ASK: 'deny' } }), null, cmd);
  }
});

test('decide never throws on shell-shaped garbage and always answers null, ask or deny', () => {
  // Seeded, so a failure reproduces: random runs of pieces that stress quoting, nesting,
  // substitutions, heredocs, prefixes and secret names.
  let seed = 20261007;
  const rand = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
  const pieces = ['cat', 'rm', '-rf', '~', '$HOME', '/', '/*', '.env', '~/.ssh/id_rsa', '"', "'", '`', '$(', ')', '(', '{', '}', ';', '&&', '|', '&',
    '<', '>', '>>', '<<EOF', '\n', 'EOF', '\\', 'bash -c', 'sudo', 'env -S', 'xargs', 'find . -exec', '{}', '+', 'a[0]=1', 'X=1', ' ', ' ', ' ',
    'grep', 'sed', '-e', '--', 'dd of=/dev/sda', 'mkfs.ext4 /dev/sdb1', '*.pem', '#', '$((', '))', 'eval', String.fromCharCode(233), String.fromCharCode(0)];
  const decisions = new Set();
  for (let n = 0; n < 4000; n++) {
    let cmd = '';
    for (let k = 1 + rand(14); k > 0; k--) cmd += pieces[rand(pieces.length)] + (rand(3) === 0 ? '' : ' ');
    const d = run(cmd, { payload: rand(4) === 0 ? { agent_id: 'a' } : {}, env: rand(5) === 0 ? { CONSTELLATION_GUARD: 'critical' } : {} });
    if (d !== null) {
      assert.ok(d.decision === 'ask' || d.decision === 'deny', JSON.stringify(cmd));
      assert.equal(typeof d.id, 'string', JSON.stringify(cmd));
      assert.ok(d.reason.startsWith(`constellation-guard [${d.id}] `), JSON.stringify(cmd));
    }
    decisions.add(d && d.decision);
  }
  assert.ok(decisions.has(null) && decisions.has('ask') && decisions.has('deny'), 'the fuzz reached every outcome');
});

test('decide ignores what is not a Bash command and never throws on odd payloads', () => {
  const odd = [
    {},
    { tool_name: 'Bash' },
    { tool_name: 'Bash', tool_input: null },
    { tool_name: 'Bash', tool_input: { command: 42 } },
    { tool_name: 'Bash', tool_input: { command: '' } },
    { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', '~'] } },
    { tool_name: 'Glob', tool_input: { pattern: '.env' } },
    { tool_name: 'mcp__x__y', tool_input: { command: 'rm -rf ~' } },
    { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: 42 },
    { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: null },
  ];
  for (const p of odd) assert.equal(decide(p, { env: {}, home: HOME }), null, JSON.stringify(p));
  // No options at all: env and home default to the process's.
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  assert.equal(decide(null), null);
  assert.equal(decide(undefined), null);
  // Without a usable home or cwd, only the home rules go quiet.
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, { env: {}, home: '' }).id, 'rm-root-home');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'rm -rf ~' } }, { env: {}, home: '' }), null);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'rm -rf .' }, cwd: '' }, { env: {}, home: '' }).id, 'rm-recursive-cwd');
});

test('toOutput: the hook JSON for a decision, and {} for none', () => {
  assert.deepEqual(toOutput(null), {});
  assert.deepEqual(toOutput(undefined), {});
  const d = run('cat .env');
  assert.deepEqual(toOutput(d), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: d.reason },
  });
  assert.equal(toOutput(run('rm -rf ~')).hookSpecificOutput.permissionDecision, 'deny');
  // No decision ever turns into allow or defer, which would skip the user's own prompts.
  for (const cmd of ['cat .env', 'rm -rf ~', 'a[0]=1 ls', 'cat ~/.aws/config']) {
    for (const v of [{}, { payload: { agent_id: 'a' } }, { env: { CONSTELLATION_GUARD_ASK: 'deny' } }]) {
      assert.ok(['ask', 'deny'].includes(toOutput(run(cmd, v)).hookSpecificOutput.permissionDecision));
    }
  }
});

test('RULES: a table of {id, tier, test} with unique ids and the documented rules', () => {
  assert.ok(Array.isArray(RULES));
  for (const r of RULES) {
    assert.equal(typeof r.id, 'string');
    assert.ok(['deny', 'ask'].includes(r.tier), r.id);
    assert.equal(typeof r.test, 'function', r.id);
  }
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const tiers = Object.fromEntries(RULES.map((r) => [r.id, r.tier]));
  for (const id of ['rm-root-home', 'rm-system-dir', 'disk-write', 'disk-format', 'fork-bomb']) assert.equal(tiers[id], 'deny', id);
  for (const id of ['read-secret', 'unparsed-command', 'unrecognized-command-word']) assert.equal(tiers[id], 'ask', id);
  // Deny rules come first, so a tie inside one segment goes to the more dangerous rule.
  const lastDeny = Math.max(...['rm-root-home', 'rm-system-dir', 'disk-write', 'disk-format', 'fork-bomb'].map((id) => ids.indexOf(id)));
  assert.ok(lastDeny < ids.indexOf('read-secret'));
});

// -- The spawned hook --------------------------------------------------------------------------

// Run `node hooks/guard.js` the way Claude Code does: JSON on stdin, JSON on stdout. The child gets
// an explicit env with temp HOME, log dir and session root, and none of the switches under test.
//
// By default each call gets a fresh temp tree and removes it. Two options cover the log path:
// `root` reuses (and leaves in place) a tree the test made, so several runs share one log dir;
// `defaultLogDir` leaves CONSTELLATION_GUARD_LOG_DIR unset, so the child logs where production
// does, under its HOME. Either way `logs` and `lines` are read from the dir the child wrote to.
function spawnGuard(input, { env = {}, root: shared = null, defaultLogDir = false } = {}) {
  const root = shared ?? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-core-e2e-')));
  const home = path.join(root, 'home');
  const dirs = { home, log: defaultLogDir ? path.join(home, '.claude', 'hooks-logs') : path.join(root, 'logs'), sessions: path.join(root, 'sessions') };
  fs.mkdirSync(home, { recursive: true });
  const childEnv = { PATH: process.env.PATH, HOME: home, SESSION_ROOT: dirs.sessions };
  if (!defaultLogDir) childEnv.CONSTELLATION_GUARD_LOG_DIR = dirs.log;
  const r = spawnSync(process.execPath, [GUARD], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...childEnv, ...env },
    timeout: 20000,
  });
  const logs = fs.existsSync(dirs.log) ? fs.readdirSync(dirs.log) : [];
  const lines = logs.flatMap((f) => fs.readFileSync(path.join(dirs.log, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const out = { ...r, logs, lines, dirs, root, claudeDir: fs.existsSync(path.join(home, '.claude')) };
  if (shared === null) fs.rmSync(root, { recursive: true, force: true });
  return out;
}

const bashPayload = (command, extra = {}) => ({
  tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id: 'sess-1', permission_mode: 'default', ...extra,
});

test('e2e: an ask for cat .env is printed and logged once, without touching HOME', () => {
  const r = spawnGuard(bashPayload('cat .env'));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.startsWith('constellation-guard [read-secret]'));
  assert.equal(r.logs.length, 1);
  assert.match(r.logs[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.equal(r.lines.length, 1);
  const [line] = r.lines;
  assert.equal(line.hook, 'constellation-guard');
  assert.equal(line.decision, 'ask');
  assert.equal(line.id, 'read-secret');
  assert.equal(line.pathId, 'env-file');
  assert.equal(line.tool, 'Bash');
  assert.equal(line.target, 'cat .env');
  assert.equal(line.session_id, 'sess-1');
  assert.equal(line.cwd, CWD);
  assert.equal(line.permission_mode, 'default');
  assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.claudeDir, false, 'the temp HOME gained a .claude directory');
});

test('e2e: a deny is printed and logged with the subagent id', () => {
  const r = spawnGuard(bashPayload('rm -rf ~', { agent_id: 'agent-7' }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /^constellation-guard \[rm-root-home\] blocked: /);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].decision, 'deny');
  assert.equal(r.lines[0].agent_id, 'agent-7');
  assert.equal(r.lines[0].pathId, undefined);
});

test('e2e: the child reads its own env on each run (headless, fallback, critical)', () => {
  const headless = JSON.parse(spawnGuard(bashPayload('cat .env'), { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }).stdout).hookSpecificOutput;
  assert.equal(headless.permissionDecision, 'deny');
  assert.match(headless.permissionDecisionReason, /Headless runs cannot ask/);
  const fallback = JSON.parse(spawnGuard(bashPayload('cat .env'), { env: { CONSTELLATION_GUARD_ASK: 'deny' } }).stdout).hookSpecificOutput;
  assert.match(fallback.permissionDecisionReason, /CONSTELLATION_GUARD_ASK=deny/);
  const critical = spawnGuard(bashPayload('cat .env'), { env: { CONSTELLATION_GUARD: 'critical' } });
  assert.equal(critical.stdout.trim(), '{}');
  assert.equal(critical.lines.length, 0);
  const still = JSON.parse(spawnGuard(bashPayload('cat ~/.ssh/id_rsa'), { env: { CONSTELLATION_GUARD: 'critical' } }).stdout).hookSpecificOutput;
  assert.equal(still.permissionDecision, 'deny');
});

test('e2e: the home rules use the child\'s own HOME', () => {
  const r = spawnGuard(bashPayload('cat ~/.ssh/id_rsa'));
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(r.lines[0].pathId, 'ssh-private-key');
});

test('e2e: a benign command prints {} and writes no log line', () => {
  const r = spawnGuard(bashPayload('git status && ls -la'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {});
  assert.deepEqual(r.logs, []);
  assert.equal(r.claudeDir, false);
});

test('e2e: a search for the name of a key is not a read of the key', () => {
  // These were denied when the value of an option passed for the pattern; nothing here reads a secret.
  for (const cmd of ['rg -t md id_rsa docs', 'grep -A 2 id_rsa README.md', 'grep -e id_rsa README.md', "awk -v k=1 '/id_rsa/' README.md"]) {
    const r = spawnGuard(bashPayload(cmd));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {}, cmd);
    assert.deepEqual(r.logs, [], cmd);
  }
  // The same options in front of a real read still deny, and the log says which path.
  const read = spawnGuard(bashPayload('grep -A 2 KEY ~/.ssh/id_rsa'));
  assert.equal(JSON.parse(read.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(read.lines[0].pathId, 'ssh-private-key');
});

test('e2e: input that is not a decision prints {} and exits 0, failing open', () => {
  const inputs = ['', 'not json', '{"tool_name":', 'null', '42', '[]', '"cat .env"', JSON.stringify({ tool_name: 'Bash' }),
    JSON.stringify({ tool_name: 'Glob', tool_input: { pattern: '.env' } })];
  for (const input of inputs) {
    const r = spawnGuard(input);
    assert.equal(r.status, 0, JSON.stringify(input));
    assert.deepEqual(JSON.parse(r.stdout), {}, JSON.stringify(input));
    assert.doesNotMatch(r.stdout, /permissionDecision/);
  }
  // An exception is logged as ERROR (and only that): the garbage input produced no decision.
  const bad = spawnGuard('not json');
  assert.equal(bad.lines.length, 1);
  assert.equal(bad.lines[0].level, 'ERROR');
  assert.equal(bad.lines[0].hook, 'constellation-guard');
  assert.equal(typeof bad.lines[0].error, 'string');
  assert.equal(bad.lines[0].decision, undefined);
});

test('e2e: the log target is cut to 200 characters', () => {
  const r = spawnGuard(bashPayload('cat .env ' + 'x'.repeat(500)));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].target.length, 200);
});

test('e2e: each decision is appended to the log, never written over it', () => {
  // Every other e2e test uses a fresh log dir and one decision, so none would notice a log that
  // keeps only the last line (the audit trail would be gone) or one that cannot be written twice.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-core-e2e-shared-')));
  try {
    const first = spawnGuard(bashPayload('cat .env'), { root });
    assert.equal(first.lines.length, 1);
    const second = spawnGuard(bashPayload('rm -rf ~'), { root });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.lines.length, 2, 'the second decision replaced or skipped the first line');
    assert.deepEqual(second.lines.map((l) => l.id).sort(), ['read-secret', 'rm-root-home']);
    const third = spawnGuard(bashPayload('cat .env.local'), { root });
    assert.equal(third.lines.length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: without CONSTELLATION_GUARD_LOG_DIR the log goes to HOME/.claude/hooks-logs, created as needed', () => {
  // A fresh machine has no ~/.claude, so the default dir needs a recursive mkdir. spawnGuard reads
  // the log from that exact path, so a different default name finds nothing.
  const r = spawnGuard(bashPayload('cat .env'), { defaultLogDir: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.dirs.log, path.join(r.dirs.home, '.claude', 'hooks-logs'));
  assert.equal(r.logs.length, 1, 'exactly one log file under HOME/.claude/hooks-logs');
  assert.match(r.logs[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].id, 'read-secret');
  assert.equal(r.claudeDir, true);
});
