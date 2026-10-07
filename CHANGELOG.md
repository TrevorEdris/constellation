# Changelog

## 0.2.3 — 2026-10-07

- feat(plan-validator): render the approval card and point the PLAN hook at it

## 0.2.2 — 2026-10-07

- feat(plan-validator): check plan/v3 delivery against the live remote

## 0.2.1 — 2026-10-07

- feat(plan-validator): check the plan/v3 card Brief

## 0.2.0 — 2026-10-07

- fix(plan-validator): parse frontmatter and flag placeholders and unverified steps

## 0.1.0 (unreleased)

Initial release.

- 15 curated skills covering the dev loop — brainstorm, PRD, plan, TDD, debug, review, ship — plus the `using-constellation` router.
- 5 specialist agents for dispatched review and debugging (code-review, security, chaos, debugger, TDD enforcer).
- Automated session documentation (`.ai/sessions/`): write-time scaffolding, pre-compact snapshot, post-compact logging, and handoffs.
- Session scaffolding now captures Claude Code's own session title automatically (Stop hook) instead of requiring the agent to invent a slug and run `new-session.sh` by hand.
- PLAN v2 format with a scored `plan-validator` gate.
- PLAN v2 forecasts PR size: writing-plans estimates the total line delta, warns and offers an `AskUserQuestion`-confirmed split above 1,000 lines, and `plan-validator` checks the `Estimated PR size` section.
- PLAN v2 opens with a human-readable `## Brief` (Delivers / Changes / Decisions made for you, max 120 words, living); `plan-validator` Check 17 scores it and the plan reviewer checks it against the plan body.
- 9 hooks: dangerous-command and secret guards, session-doc automation, and plan-validation / section-sign reminders.
- Claude Code and Codex support, with catalog and bootstrap generation.
