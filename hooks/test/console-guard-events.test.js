'use strict';
/**
 * Where Claude Code's built-in guard (cc-plugin-sec-default) loads, on a
 * machine with managed settings or a Team or Enterprise login, a hook that a
 * user-installed mod registers on certain events never runs, and the person
 * sees a "hook was skipped" line for each. Constellation is a user-installed
 * mod there, so the console module must not hook any of those events.
 *
 * The list is the table under "Hooks the guard passes over" in
 * https://code.claude.com/docs/en/plugins/mods/admin.md.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { HOOKS_DIR } = require('./helpers');

const MODULE = path.join(HOOKS_DIR, 'console', 'register.tsx');
const PASSED_OVER = [
  /^classic\./,
  /^prompt\.section$/, /^prompt\.context$/, /^prompt\.attachment$/,
  /^skill\.prompt$/, /^attribution\.text$/, /^session\.compact$/,
  /^settings\.read$/, /^session\.append$/,
];

/** Every event name the module passes to `on(...)` as a string literal. */
function hookedEvents(source) {
  return [...source.matchAll(/\bon\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
}

test('the console module hooks events', () => {
  const events = hookedEvents(fs.readFileSync(MODULE, 'utf8'));
  assert.ok(events.includes('tool.call'), `found: ${events.join(', ')}`);
});

test('the console module hooks no event the built-in guard passes over', () => {
  const events = hookedEvents(fs.readFileSync(MODULE, 'utf8'));
  const reserved = events.filter(name => PASSED_OVER.some(re => re.test(name)));
  assert.deepEqual(reserved, []);
});
