#!/usr/bin/env node
/**
 * Plan Validator Reminder - PostToolUse Hook
 * Nudges the agent to run /plan-validator after writing a PLAN.md file.
 * Non-blocking: injects a reminder into context, does not prevent the write.
 *
 * @hook {"event":"PostToolUse","matcher":"Write","description":"Reminds agent to run /plan-validator after writing PLAN.md"}
 *
 * Setup in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Write",
 *       "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/plan-validator-reminder.js" }]
 *     }]
 *   }
 * }
 */

function checkForPlan(event) {
  const filePath = event?.tool_input?.file_path || '';
  if (!filePath.endsWith('PLAN.md')) {
    return { remind: false, message: '' };
  }

  return {
    remind: true,
    message: `PLAN.md was just written to ${filePath}. Run /plan-validator before presenting this plan to the user.`,
  };
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
