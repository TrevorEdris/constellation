---
name: session-bootstrap
description: Use when starting work with no session directory for today (the session-reminder hook fired, or you are beginning a new task/ticket) and you need to scaffold SESSION/DISCOVERY/PLAN docs and mark the active session
---

# Session Bootstrap

Create the session directory and its docs from templates, with frontmatter pre-filled, and set the `.active` pointer so the session-doc hooks (context-snapshot, post-compact-logger) target THIS session — not the wrong same-day one.

## When to use
- The `session-reminder` hook reported no session dir for today.
- You are starting a new ticket or task and the workspace requires session docs (Discover → Plan → Implement).

## Do this

Run the scaffolder (it is idempotent — existing files are left untouched):

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/new-session.sh" "<Title-Slug>" "<TICKET-or-empty>" "<claude-session-id-if-known>"
```

- `<Title-Slug>` — short Pascalish slug, e.g. `Add-User-Auth`.
- `<TICKET>` — Jira/issue id if there is one, else omit.
- `<session-id>` — the Claude Code session UUID when you know it; otherwise omit and it defaults to `<date>_<slug>`.

This creates `~/src/.ai/sessions/<date>_<TICKET>_<slug>/` with:
- `SESSION.md` (schema v1 frontmatter: schema/date/slug/tags/status/session_id)
- `DISCOVERY.md`
- `PLAN.md` (canonical PLAN v2 template)

and writes `~/src/.ai/sessions/.active` so hooks resolve the right session.

## Then
- Fill `SESSION.md` Goal + log the first prompt.
- Capture findings in `DISCOVERY.md` during discovery.
- Author `PLAN.md` per constellation:writing-plans, validate with constellation:plan-validator (PASS ≥ 70) before presenting, and wait for approval before implementing.

## Notes
- Setting `.active` is what fixes the wrong-session bug — always run the script rather than hand-creating the directory.
- The `status` field drives phase inference (draft/awaiting-approval → Plan; approved/in-progress → Implement; complete → done).
