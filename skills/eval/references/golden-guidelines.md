# Golden Test Guidelines

## Skill Categories

### Category A — Artifact Processors

Skills that take concrete code, diffs, or configs as input and produce analysis output.

**Examples:** code-review, security-review, desloppify, refactoring, code-pattern-advisor, cicd-pipeline, update-docs

**Golden file strategy:**
- Embed synthetic code artifacts directly in `input`
- Use demo artifacts from `demo-artifacts/` as starting points
- Assertions check that the skill identifies specific issues and recommends specific fixes

### Category B — Workflow Orchestrators

Skills that depend on live repo state and orchestrate multi-step flows.

**Examples:** systematic-debugging, test-driven-development, orchestrate, session-handoff, git-workflow

**Golden file strategy:**
- Use scenario descriptions as `input` (not actual code)
- Assertions check structural output patterns (correct phases, required sections, expected format)
- Do NOT assert on specific content — only structure

## Writing Assertions

### `contains` — Use for required findings
- Key phrases the skill must include in its output
- Case-insensitive matching

### `not-contains` — Use for false-positive resistance
- Phrases that indicate the skill missed the point
- Examples: "no issues" when there clearly are issues, "looks good" for vulnerable code

### `regex` — Use for structural patterns
- Section headers, severity labels, phase markers
- Multiple alternatives: `parameteriz|prepared statement`
- Structural markers: `phase.1|investigate`

### `llm-rubric` — Use for nuanced quality (optional)
- Only runs in `--full` mode (costs money)
- For checks that can't be reduced to substring matching
- Keep rubric descriptions specific and measurable

## Design Principles

1. **One primary issue per test** — Don't make kitchen-sink inputs
2. **Include false-positive tests** — Clean code should not trigger warnings
3. **Keep inputs small** — 20-50 lines of code, enough to trigger the behavior
4. **Record realistic outputs** — The `output` field should be a plausible skill response
5. **Test the boundaries** — Edge cases (empty input, no issues, ambiguous code)
