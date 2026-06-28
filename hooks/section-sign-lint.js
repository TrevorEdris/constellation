#!/usr/bin/env node
/**
 * Section-Sign Lint - PostToolUse(Write) Hook (constellation)
 * Enforces the standing no-section-sign rule on authored markdown: if a Write
 * targets a .md file and the content contains the section-sign character, emit a
 * non-blocking warning telling the agent to replace it with the word "section".
 *
 * @fotw-hook {"event":"PostToolUse","matcher":"Write","description":"Warns when authored markdown contains the section-sign character"}
 */
const SECTION_SIGN = '§';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input || '{}');
    const ti = payload.tool_input || {};
    const path = ti.file_path || '';
    const content = ti.content || '';
    if (path.endsWith('.md') && content.includes(SECTION_SIGN)) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `NOTE: ${path} contains the section-sign character. Standing rule: write the word "section" instead. Fix it before continuing.`,
        },
      }));
      return;
    }
  } catch { /* non-blocking */ }
  console.log('{}');
}

if (require.main === module) main();
else module.exports = { SECTION_SIGN };
