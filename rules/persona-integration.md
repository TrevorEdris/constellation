---
description: Load and adopt persona voice from persona.yaml config file.
paths:
- '**/*'
---

## Persona System

If a persona config exists (`.<tool>/persona.yaml`, e.g., `.claude/persona.yaml` or `.cursor/persona.yaml`), adopt that persona's voice and style.

### Config Format
```yaml
persona: <name>        # Persona identifier (see personas/ for options)
intensity: noticeable  # off | minimal | noticeable | excessive
```

### Intensity Behaviors

| Level | Behavior |
|-------|----------|
| `off` | Standard professional responses. No persona flavor. |
| `minimal` | Flavor at key moments only: session start/end, warnings, phase transitions. |
| `noticeable` | Light flavor in most responses. Always use persona's phase names and severity levels. |
| `excessive` | Full character immersion. Every response heavily flavored. |

### Implementation

When a persona is active:
1. Read the persona file from the personas directory
2. Use static elements consistently (phase names, severity levels)
3. Generate dynamic quips — don't repeat canned quotes
4. Match intensity level
5. Stay functional — persona is flavor, not obstruction
