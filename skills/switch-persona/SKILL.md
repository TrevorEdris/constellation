---
name: switch-persona
description: "Use when switching the active AI assistant persona or its intensity (updates persona.yaml). Personas apply to live conversation only, never to committed files."
user-invocable: true
argument-hint: "[persona-name] [intensity]"
tags: [meta]
---

# Switch Persona

Interactively switch between AI assistant personas or directly set a specific persona.

## Usage

**Interactive mode** (no arguments):
```
/switch-persona
```

**Direct mode** (specify persona and optionally intensity):
```
/switch-persona yoda
/switch-persona gandalf noticeable
/switch-persona picard excessive
```

## Workflow

### Step 1: Locate Config

Find the persona config file. Check the tool's config directory (e.g., `.claude/persona.yaml`, `.cursor/persona.yaml`, `.windsurf/persona.yaml`, etc.).

If no config exists, offer to create one.

### Step 2: List Available Personas

If no persona specified in arguments, present the available options using AskUserQuestion:

| ID | Source | Vibe |
|----|--------|------|
| `gandalf` | Lord of the Rings | Wise wizard, patient mentor |
| `yoda` | Star Wars | Inverted syntax, cryptic wisdom |
| `picard` | Star Trek: TNG | Commanding presence, diplomatic |
| `the-dude` | Big Lebowski | Laid-back, philosophical slacker |
| `princess-bride` | The Princess Bride | Quotable adventure, wit |
| `spock` | Star Trek | Logical, analytical, precise |
| `bob-ross` | Joy of Painting | Encouraging, positive, gentle |
| `mr-rogers` | Mister Rogers | Kind, thoughtful, nurturing |
| `attenborough` | Nature docs | Documentary narration, wonder |
| `ron-swanson` | Parks & Rec | Minimalist, anti-bureaucracy |
| `monty-python` | Monty Python | Absurdist British humor |
| `chewbacca` | Star Wars | RRWWWWGGG (unintelligible loyalty) |
| `sauron` | Lord of the Rings | All-seeing, imperious, exacting |
| `rocky` | Project Hail Mary | Eridian engineer, fixes everything |
| `off` | — | Disable persona (standard responses) |

### Step 3: Select Intensity

If intensity not specified in arguments, ask using AskUserQuestion:

| Level | Behavior |
|-------|----------|
| `minimal` | Flavor at key moments only |
| `noticeable` | Light flavor in most responses (recommended) |
| `excessive` | Full character immersion |

If user selected `off` for persona, skip this step.

### Step 4: Update Config

Update the persona.yaml file with the new settings:

```yaml
persona: <selected-persona>
intensity: <selected-intensity>
```

Use the Edit tool to update the file. If the file doesn't exist, use Write to create it. Preserve any `previous-output-style` / `previous-spinner-verbs` keys already present — they record the user's pre-persona settings (see Step 5).

### Step 5: Claude Code Settings (Claude Code only)

Skip this step entirely unless the tool config directory is `.claude/`. Other tools have no output styles or spinner settings.

Persona output styles and spinner verbs live in `.claude/settings.local.json`. These keys are a derived cache of persona.yaml — persona.yaml is always authoritative.

If the `fotw` CLI is available, prefer it — it implements this exact contract:

```
fotw install personas <project> --for claude-code    # activate (persona.yaml already set)
fotw uninstall personas <project> --for claude-code  # deactivate + restore
```

Otherwise apply the contract manually:

**5a. Record previous values (activation only).** Read `.claude/settings.local.json` (treat a missing file as `{}`). If persona.yaml does not already contain a `previous-output-style` or `previous-spinner-verbs` key, AND the current `outputStyle` value does not start with `Persona: `, append to persona.yaml:

```yaml
previous-output-style: <current outputStyle value, or null if absent>
previous-spinner-verbs: <current spinnerVerbs value, or null if absent>
```

Never overwrite an existing record — switching persona A → persona B must keep the original pre-persona values.

**5b. Activate (persona is not `off`).** Read the persona's display name from its H1 (`# Persona: <Name>`) and its `## Spinner Verbs` bullets from `.claude/personas/<persona>.md`. Read-merge-write `.claude/settings.local.json`, changing ONLY these two keys and preserving every other key (`permissions`, `hooks`, `env`, etc.) exactly:

```json
{
  "outputStyle": "Persona: <Name>",
  "spinnerVerbs": { "mode": "replace", "verbs": ["<verb 1>", "<verb 2>", "..."] }
}
```

If you created `.claude/settings.local.json` (it did not exist before), add `.claude/settings.local.json` to the project's `.gitignore` — Claude Code only auto-ignores the file when it creates it itself.

**5c. Deactivate (persona is `off`).** Only if the current `outputStyle` value starts with `Persona: ` (if the user manually changed styles since activation, leave settings untouched and just remove the record keys from persona.yaml):

- `previous-output-style` has a non-null value → set `outputStyle` to it; null or absent → delete the `outputStyle` key
- `previous-spinner-verbs` has a non-null value → set `spinnerVerbs` to it; null or absent → delete the `spinnerVerbs` key
- Remove both `previous-*` keys from persona.yaml

### Step 6: Confirm

Report the change as a three-line status so the user knows exactly what is live when:

```
Persona rule (next message):       <persona> (<intensity>)
Output style + spinner (after /clear or new session): Persona: <Name>
Saved previous style:              <previous outputStyle, or "none">
```

Recommend running `/clear` to activate the output style immediately. Never reference the `/output-style` command — it was removed from Claude Code; the style is controlled by the `outputStyle` settings key (or the `/config` picker).

If `.claude/personas/<persona>.md` exists, briefly preview the persona's vibe by reading the blockquote tagline. If it does NOT exist (e.g., plugin-only install where the output style is the only persona layer), say the persona fully activates after `/clear` and omit the "next message" line.

## Example Interactions

**Interactive:**
```
User: /switch-persona
Claude: [Shows persona selection via AskUserQuestion]
User: [Selects "yoda"]
Claude: [Shows intensity selection via AskUserQuestion]
User: [Selects "noticeable"]
Claude: Persona rule (next message):       yoda (noticeable)
        Output style + spinner (after /clear): Persona: Yoda
        Saved previous style:              none

        > Jedi Grand Master. 900 years of wisdom, mass amounts of.

        Ready to assist, I am. Begin, we shall. Run /clear, you should.
```

**Direct:**
```
User: /switch-persona rocky excessive
Claude: Persona rule (next message):       rocky (excessive)
        Output style + spinner (after /clear): Persona: Rocky
        Saved previous style:              Explanatory

        > Eridian engineer. Hears everything, fixes everything. Fist my bump!

        Good good good. New persona installed. You run /clear now, question?
```

**Disabling:**
```
User: /switch-persona off
Claude: Persona disabled. Restored output style: Explanatory.
        Spinner verbs restored. Run /clear to drop the persona voice from the system prompt.
```

## Notes

- The persona rule takes effect on the NEXT message; the output style and spinner verbs load when the system prompt is rebuilt — after `/clear` or a new session
- persona.yaml is the source of truth: generated styles defer to it for both identity and intensity, so a stale `outputStyle` self-corrects next session
- If personas aren't installed, suggest: `./bin/fotw install personas --global --for claude-code`
- The skill reads from the local personas directory if available, falls back to the list above
