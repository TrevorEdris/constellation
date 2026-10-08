#!/usr/bin/env node
/**
 * Plan Validator Reminder - PostToolUse Hook
 * After a PLAN file is written or edited, tells the agent what gates it:
 * a v3 plan still in draft or awaiting-approval gets the approval card, a legacy
 * plan gets the validator. The file's own `schema` and `status` decide, so an
 * approved plan, a README and a PLAN-INDEX.md all stay silent.
 * Non-blocking: injects a reminder into context, does not prevent the write.
 *
 * @hook {"event":"PostToolUse","matcher":"Write|Edit|MultiEdit","description":"Points the agent at the approval card (v3) or the validator (legacy) after a PLAN file changes"}
 *
 * Setup in .claude/settings.json (the plugin's hooks.json already wires this):
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Write|Edit|MultiEdit",
 *       "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/plan-validator-reminder.js" }]
 *     }]
 *   }
 * }
 */
const fs = require('fs');
const path = require('path');

const SILENT = { remind: false, message: '' };
// PLAN.md, PLAN-feature.md and so on; the index and the template are not plans.
const PLAN_NAME_RE = /^PLAN[^/\\]*\.md$/;
const NOT_PLANS = new Set(['PLAN-INDEX.md', 'PLAN-TEMPLATE.md']);
const SCHEMA_V3 = 'plan/v3';
const CARD_STATUSES = new Set(['draft', 'awaiting-approval']);
const COMMENT_RE = /(?:^|\s)#/;
const TOP_LEVEL_KEY_RE = /^(schema|status):(?:[ \t]+(.*))?$/;

/** A frontmatter scalar: a quoted value verbatim, else the text before an inline ` #` comment. */
function scalar(raw) {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, 1);
    if (close !== -1) return text.slice(1, close);
  }
  const comment = COMMENT_RE.exec(text);
  return (comment ? text.slice(0, comment.index) : text).trim();
}

/** The file's top-level `schema` and `status`; both are '' when the file or its frontmatter is missing. */
function readSchemaAndStatus(filePath) {
  const found = { schema: '', status: '' };
  let lines;
  try {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  } catch {
    return found;
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (lines[0].trimEnd() !== '---' || end === -1) return found;
  for (const line of lines.slice(1, end)) {
    const pair = TOP_LEVEL_KEY_RE.exec(line.trimEnd());
    if (pair) found[pair[1]] = scalar(pair[2] || '');
  }
  return found;
}

function checkForPlan(event) {
  const filePath = event?.tool_input?.file_path || '';
  const name = filePath.split(/[/\\]/).pop();
  if (!PLAN_NAME_RE.test(name) || NOT_PLANS.has(name)) return SILENT;

  const { schema, status } = readSchemaAndStatus(filePath);
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(__dirname);

  if (schema === SCHEMA_V3) {
    if (!CARD_STATUSES.has(status)) return SILENT;
    return {
      remind: true,
      message: `PLAN written: ${filePath}. Gate it with the approval card: run python3 "${root}/skills/plan-validator/scripts/card.py" render "${filePath}" and post its stdout as the approval message (constellation:writing-plans).`,
    };
  }

  // Legacy: remind only for something that looks like one of our plans, so an
  // unrelated docs/PLAN.md stays quiet.
  if (schema.startsWith('plan/') || filePath.includes('/.ai/sessions/')) {
    return {
      remind: true,
      message: `PLAN written: ${filePath}. Run constellation:plan-validator before presenting it: python3 "${root}/skills/plan-validator/scripts/validate_plan.py" "${filePath}" --verbose`,
    };
  }
  return SILENT;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const event = JSON.parse(input);
    const result = checkForPlan(event);
    if (result.remind) {
      return console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: result.message,
        },
      }));
    }
    console.log('{}');
  } catch {
    console.log('{}');
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { checkForPlan };
}
