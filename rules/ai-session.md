---
description: Maintain a session journal in ~/src/.ai/sessions/ for every AI coding
  session.
paths:
- '**/*'
---

Session root: `~/src/.ai/`

Create a new directory within the `.ai/sessions/` directory with the format `YYYY-MM-DD_<JIRA>_<TITLE_SLUG>/`
Example `~/src/.ai/sessions/2026-01-22_ENT-1240_Taxonomy-Codes/`

Within this directory, create the following documents

---

## SESSION.md

Open every new SESSION.md with a YAML frontmatter block, then the document body.

### Frontmatter (schema v1)

```yaml
---
schema: v1                          # required — parser negotiation key
date: YYYY-MM-DD                    # required — session start date
slug: My-Session-Slug               # required — matches directory slug
tags: [tag1, tag2]                  # optional — topic labels
status: planning                    # optional — planning | in-progress | complete | blocked
session_id: <uuid-or-date-slug>     # optional — stable cross-reference ID
---
```

`session_id` should be the Claude Code session UUID when available; fall back to `YYYY-MM-DD_<slug>`.
All fields except `schema`, `date`, and `slug` are optional. Sessions written before v1 (no frontmatter)
remain valid — parsers treat missing frontmatter as schema version `unknown`.

### Body headings

Use these sections in order. Omit sections with nothing to report.

```
# Session — <Title>

## Goal
One-paragraph statement of what this session is trying to accomplish.

## Prompts & Responses

### Prompt 1
> <user prompt verbatim or close summary>

<summarized response — what was done, what was found, what was decided>

### Prompt 2 (YYYY-MM-DD)
> <user prompt>

<response summary>

## Decisions

- **YYYY-MM-DD** — <decision text. State what was chosen and why. One entry per decision.>
- **YYYY-MM-DD** — <decision text>

## Status
<one-line current state: e.g. "Plan approved, awaiting implementation" or "complete">
```

**Heading conventions:**
- `### Prompt N` — N is a 1-indexed integer. Append `(YYYY-MM-DD)` when the session spans multiple days.
- `## Decisions` — canonical name. Each entry must match the pattern `- **YYYY-MM-DD** — <text>` so parsers can extract them via regex.
- `## Status` — plain text or matches the `status` frontmatter value.

**Backward compatibility:** existing sessions without frontmatter remain valid. Apply schema v1 only to
new sessions created after this rule ships.

---

## DISCOVERY.md

Refer to `discover-plan-implement.md` for exact details on the contents.

---

## PLAN.md

Refer to `discover-plan-implement.md` for exact details on the contents.

---

## INDEX.md (at `~/src/.ai/sessions/INDEX.md`, maintained by `/session-index`)

- Run `/session-index generate` periodically to update the cross-session index.
- Use `/session-index link` to record blocking relationships between sessions.
