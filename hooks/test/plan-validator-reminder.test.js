'use strict';
/**
 * Tests for hooks/plan-validator-reminder.js. Every case writes a real plan file
 * under a temp dir and drives the real hook: checkForPlan in-process, plus the
 * script itself over stdin for the CLI contract. Nothing here touches the real
 * session root.
 */
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.resolve(__dirname, '..', 'plan-validator-reminder.js');
const HOOKS_JSON = path.resolve(__dirname, '..', 'hooks.json');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const { checkForPlan } = require(HOOK);

const FAKE_ROOT = '/plugin/root';
const CARD_PY = `${FAKE_ROOT}/skills/plan-validator/scripts/card.py`;
const VALIDATE_PY = `${FAKE_ROOT}/skills/plan-validator/scripts/validate_plan.py`;

const cardMessage = (planPath) =>
  `PLAN written: ${planPath}. Gate it with the approval card: run python3 "${CARD_PY}" render "${planPath}" and post its stdout as the approval message (constellation:writing-plans).`;
const validatorMessage = (planPath) =>
  `PLAN written: ${planPath}. Run constellation:plan-validator before presenting it: python3 "${VALIDATE_PY}" "${planPath}" --verbose`;

// A bare slash command: "/plan-validator" at the start or after whitespace or a
// quote. The bundled script path ".../skills/plan-validator/scripts/..." is not one.
const BARE_SLASH_COMMAND = /(^|[\s"'`(])\/plan-validator/;

let tmp;
let savedRoot;

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reminder-')));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  savedRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = FAKE_ROOT;
});
afterEach(() => {
  if (savedRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = savedRoot;
});

/** Frontmatter plus a one-line body; pass raw `key: value` lines. */
function planText(...frontmatterLines) {
  return ['---', ...frontmatterLines, '---', '', '# PLAN: Fixture', ''].join('\n');
}

/** Write `text` at `rel` under the temp dir and return the absolute path. */
function writeFile(rel, text) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

const writeEvent = (file) => ({ tool_name: 'Write', tool_input: { file_path: file, content: 'ignored' } });
const sessionPlan = (slug, text, name = 'PLAN.md') => writeFile(`.ai/sessions/2026-10-07_T_${slug}/${name}`, text);

test('v3 draft gives card render message', () => {
  const file = sessionPlan('v3-draft', planText('schema: plan/v3', 'status: draft'));
  const result = checkForPlan(writeEvent(file));
  assert.equal(result.remind, true);
  assert.equal(result.message, cardMessage(file));
});

test('v3 awaiting-approval gives card render message', () => {
  const file = sessionPlan('v3-awaiting', planText('schema: plan/v3', 'status: awaiting-approval'));
  assert.equal(checkForPlan(writeEvent(file)).message, cardMessage(file));
});

test('legacy session plan gives qualified validator message', () => {
  const file = sessionPlan('legacy', planText('date: 2026-10-07', 'status: draft'));
  const result = checkForPlan(writeEvent(file));
  assert.equal(result.remind, true);
  assert.equal(result.message, validatorMessage(file));
  assert.match(result.message, /constellation:plan-validator/);
  assert.doesNotMatch(result.message, BARE_SLASH_COMMAND);
});

test('legacy plan/ schema outside a session dir gives the validator message', () => {
  const file = writeFile('docs/PLAN.md', planText('schema: plan/v2', 'status: draft'));
  assert.equal(checkForPlan(writeEvent(file)).message, validatorMessage(file));
});

test('EXPLANATION.md, PLAN-INDEX.md and PLAN-TEMPLATE.md silent', () => {
  // v3 draft content in a session dir: each would remind if the name check let it through.
  const body = planText('schema: plan/v3', 'status: draft');
  for (const name of ['EXPLANATION.md', 'PLAN-INDEX.md', 'PLAN-TEMPLATE.md']) {
    const file = sessionPlan('not-a-plan', body, name);
    assert.deepEqual(checkForPlan(writeEvent(file)), { remind: false, message: '' }, name);
  }
});

test('a basename that merely ends in PLAN.md is silent', () => {
  const body = planText('schema: plan/v3', 'status: draft');
  for (const name of ['NOTPLAN.md', 'XPLAN.md', 'PLAN.md.bak', 'PLAN.txt']) {
    const file = sessionPlan('lookalike', body, name);
    assert.deepEqual(checkForPlan(writeEvent(file)), { remind: false, message: '' }, name);
  }
});

test('PLAN-prefixed names other than the index and template still count', () => {
  const file = sessionPlan('prefixed', planText('schema: plan/v3', 'status: draft'), 'PLAN-feature-x.md');
  assert.equal(checkForPlan(writeEvent(file)).message, cardMessage(file));
});

test('status with inline comment reads as draft', () => {
  const file = sessionPlan(
    'commented',
    planText('schema: plan/v3   # exact match', 'status: draft  # draft | awaiting-approval | approved')
  );
  assert.equal(checkForPlan(writeEvent(file)).message, cardMessage(file));
});

test('v3 approved silent', () => {
  for (const status of ['approved', 'in-progress', 'complete']) {
    const file = sessionPlan(`v3-${status}`, planText('schema: plan/v3', `status: ${status}`));
    assert.deepEqual(checkForPlan(writeEvent(file)), { remind: false, message: '' }, status);
  }
});

test('docs/PLAN.md without schema silent', () => {
  const noFrontmatter = writeFile('docs/a/PLAN.md', '# PLAN: Roadmap\n\nNo frontmatter at all.\n');
  const noSchema = writeFile('docs/b/PLAN.md', planText('status: draft'));
  assert.deepEqual(checkForPlan(writeEvent(noFrontmatter)), { remind: false, message: '' });
  assert.deepEqual(checkForPlan(writeEvent(noSchema)), { remind: false, message: '' });
});

test("only the leading frontmatter block's top-level keys are read", () => {
  const silent = { remind: false, message: '' };

  // (a) A plan that documents plan frontmatter: the body quotes column-0 keys in a
  // fenced example. A whole-file scan would let them override the real ones.
  const documents = sessionPlan('documents-frontmatter', [
    '---', 'schema: plan/v3', 'status: draft', '---', '',
    '# PLAN: Documents frontmatter', '',
    'A plan opens with a block like this:', '',
    '```yaml', '---', 'schema: plan/v2', 'status: approved', '---', '```', '',
  ].join('\n'));
  assert.equal(checkForPlan(writeEvent(documents)).message, cardMessage(documents), '(a) body example overrode the frontmatter');

  // (b) No leading fence, so no frontmatter at all. A later rule must not turn the
  // lines above it into one.
  const noFence = writeFile('docs/leading-fence/PLAN.md', [
    '# PLAN: Roadmap', 'schema: plan/v3', 'status: draft', '', '---', '', 'Prose, not frontmatter.', '',
  ].join('\n'));
  assert.deepEqual(checkForPlan(writeEvent(noFence)), silent, '(b) body lines read without a leading fence');

  // (c) A delivery item's indented keys are not the plan's own schema and status.
  const nested = sessionPlan('nested-keys', [
    '---', 'schema: plan/v3', 'date: 2026-10-07', 'slug: nested-keys', 'status: draft',
    'delivery:', '  - repo: /tmp/fixture-repo', '    mode: pr', '    status: approved', '    schema: plan/v2',
    'tags: [fixture]', '---', '', '# PLAN: Nested keys', '',
  ].join('\n'));
  assert.equal(checkForPlan(writeEvent(nested)).message, cardMessage(nested), '(c) indented key overrode the top-level one');

  // (d) The closing fence is exactly `---`. Frontmatter that is never closed, with a
  // longer rule further down, is not frontmatter.
  const unclosed = writeFile('docs/closing-fence/PLAN.md', [
    '---', 'schema: plan/v3', 'status: draft', '', '# PLAN: Never closed', '', '----', '', 'Prose.', '',
  ].join('\n'));
  assert.deepEqual(checkForPlan(writeEvent(unclosed)), silent, '(d) a ---- rule closed the frontmatter');
});

test('Edit event reminds', () => {
  // An Edit carries no file content, so the hook has to read the schema off disk.
  const file = sessionPlan('edit', planText('schema: plan/v3', 'status: awaiting-approval'));
  for (const tool_name of ['Edit', 'MultiEdit']) {
    const event = { tool_name, tool_input: { file_path: file, old_string: 'a', new_string: 'b' } };
    assert.deepEqual(checkForPlan(event), { remind: true, message: cardMessage(file) }, tool_name);
  }
});

test('events without a plan path are silent', () => {
  assert.deepEqual(checkForPlan({}), { remind: false, message: '' });
  assert.deepEqual(checkForPlan({ tool_input: {} }), { remind: false, message: '' });
});

test('root falls back to the plugin directory when CLAUDE_PLUGIN_ROOT is unset', () => {
  delete process.env.CLAUDE_PLUGIN_ROOT;
  const file = sessionPlan('fallback', planText('schema: plan/v3', 'status: draft'));
  const { message } = checkForPlan(writeEvent(file));
  assert.ok(message.includes(`python3 "${PLUGIN_ROOT}/skills/plan-validator/scripts/card.py"`), message);
});

test('hooks.json PostToolUse matcher is Write|Edit|MultiEdit', () => {
  const postToolUse = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8')).hooks.PostToolUse;
  const commandsOf = (entry) => entry.hooks.map((h) => h.command);
  const reminderIdx = postToolUse.findIndex((e) => commandsOf(e).some((c) => c.includes('plan-validator-reminder.js')));
  const writeIdx = postToolUse.findIndex((e) => e.matcher === 'Write');

  assert.notEqual(reminderIdx, -1, 'no PostToolUse entry runs plan-validator-reminder.js');
  assert.equal(postToolUse[reminderIdx].matcher, 'Write|Edit|MultiEdit');
  assert.equal(postToolUse[reminderIdx].hooks.length, 1, 'the reminder entry holds this hook only');
  assert.ok(writeIdx !== -1 && writeIdx < reminderIdx, 'the Write entry comes first');
  const writeCommands = commandsOf(postToolUse[writeIdx]);
  assert.ok(writeCommands.some((c) => c.includes('section-sign-lint.js')), 'Write keeps section-sign-lint.js');
  assert.ok(!writeCommands.some((c) => c.includes('plan-validator-reminder.js')), 'Write must not also run the reminder');
});

function runCli(event, env = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('CLI emits hookSpecificOutput JSON', () => {
  const file = sessionPlan('cli', planText('schema: plan/v3', 'status: draft'));
  const out = JSON.parse(runCli(writeEvent(file), { CLAUDE_PLUGIN_ROOT: FAKE_ROOT }));
  assert.deepEqual(out, {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: cardMessage(file) },
  });
});

test('CLI prints {} when there is nothing to remind', () => {
  const file = sessionPlan('cli-approved', planText('schema: plan/v3', 'status: approved'));
  assert.deepEqual(JSON.parse(runCli(writeEvent(file), { CLAUDE_PLUGIN_ROOT: FAKE_ROOT })), {});
});
