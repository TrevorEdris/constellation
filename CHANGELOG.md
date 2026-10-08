# Changelog

## 0.4.6 — 2026-10-07

- feat(hooks): ask before merging or pushing into the default branch

## 0.4.5 — 2026-10-07

- fix(hooks): guard secrets across Grep, MultiEdit and NotebookEdit

## 0.4.4 — 2026-10-07

- feat(hooks): route Bash through the tiered guard and retire block-dangerous-commands

## 0.4.3 — 2026-10-07

- feat(hooks): ask before copying, sending or printing secrets from Bash

## 0.4.2 — 2026-10-07

- feat(hooks): add tiered guard core with critical deny rules

## 0.4.1 — 2026-10-07

- feat(hooks): parse substitutions, -c, xargs and find -exec into command segments

## 0.4.0 — 2026-10-07

- feat(hooks): add quote-aware shell tokenizer for guard rules
## 0.3.10 — 2026-10-07

- fix(git-workflow): route merge, land and ship-to-main requests to the skill

## 0.3.9 — 2026-10-07

- feat(ci): lint skill links, bundled-script calls and generated-file drift

## 0.3.8 — 2026-10-07

- fix(skills): resolve dangling skill links and run bundled scripts through their interpreter

## 0.3.7 — 2026-10-07

- docs(git-workflow): port v6.4.2 worktree isolation and point SKILL.md at its references

## 0.3.6 — 2026-10-07

- fix(git-workflow): finish branches PR-first and worktree-safe, without Discard

## 0.3.5 — 2026-10-07

- feat(git-workflow): add workspace.sh to detect, merge and clean up worktrees safely

## 0.3.4 — 2026-10-07

- fix(git-workflow): accept hyphens, feat/ and ticket IDs in branch-check

## 0.3.3 — 2026-10-07

- fix(session): announce the journal once per session and log compactions

## 0.3.2 — 2026-10-07

- fix(session): adopt agent-made session dirs and PLAN-named dirs

## 0.3.1 — 2026-10-07

- fix(session): journal each session in its own local-dated dir

## 0.3.0 — 2026-10-07

- ci: run plugin checks on every pull request and add a version bump helper
## 0.2.5 — 2026-10-07

- feat(writing-plans): hand off every plan as a 120-word approval card

## 0.2.4 — 2026-10-07

- feat(plan-validator): classify chat replies and record approvals

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
