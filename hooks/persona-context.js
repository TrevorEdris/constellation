#!/usr/bin/env node
/**
 * Persona Context - SessionStart Hook
 * Deterministically injects the active persona and intensity from
 * .claude/persona.yaml into session context, so persona activation never
 * depends on the model remembering to read the config.
 *
 * @fotw-hook {"event":"SessionStart","matcher":"","description":"Injects active persona and intensity from persona.yaml"}
 *
 * Setup in .claude/settings.json:
 * {
 *   "hooks": {
 *     "SessionStart": [{
 *       "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/persona-context.js" }]
 *     }]
 *   }
 * }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Minimal flat-YAML value extraction — persona.yaml is two scalar keys, and
// hooks stay dependency-free, so a full YAML parser is not warranted. A '#'
// inside a value is treated as an inline comment (persona slugs/intensities
// never contain '#'), so quoted values containing '#' are unsupported.
function yamlValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].split('#')[0].trim().replace(/^["']|["']$/g, '');
}

function personaContext(projectDir = process.cwd(), homeDir = os.homedir()) {
  // Prefer the project config; fall back to the global ~/.claude config so
  // global persona installs (which write ~/.claude/persona.yaml) still get
  // deterministic injection.
  const candidates = [
    path.join(projectDir, '.claude', 'persona.yaml'),
    path.join(homeDir, '.claude', 'persona.yaml'),
  ];
  let text;
  for (const configPath of candidates) {
    try {
      text = fs.readFileSync(configPath, 'utf8');
      break;
    } catch {
      // try next candidate
    }
  }
  if (text === undefined) {
    return { inject: false, message: '' };
  }

  const persona = yamlValue(text, 'persona');
  const intensity = yamlValue(text, 'intensity') || 'noticeable';
  if (!persona || persona === 'off' || intensity === 'off') {
    return { inject: false, message: '' };
  }

  return {
    inject: true,
    message: `Active persona: ${persona}, intensity: ${intensity} (from .claude/persona.yaml). Adopt this persona's voice per the persona definition; persona.yaml is authoritative over any output style.`,
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let projectDir = process.cwd();
  try {
    const payload = JSON.parse(input);
    if (payload.cwd) projectDir = payload.cwd;
  } catch {
    // No/invalid payload — fall back to process cwd
  }

  const result = personaContext(projectDir);
  if (result.inject) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: result.message,
      },
    }));
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { personaContext, yamlValue };
