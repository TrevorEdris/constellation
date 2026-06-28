---
name: eval
description: "Use when evaluating a skill, generating golden test files, or promoting learnings -- wraps the eval harness with interactive guidance."
user-invocable: true
argument-hint: "[<skill>|--all|generate-golden <skill>|promote <skill>]"
allowed-tools: Bash(fotw:*), Bash(python:*), Read, Write, Grep, Glob
tags: [meta, testing]
tier: core
---

# Eval

Run golden test evaluations and manage skill quality.

---

## Modes

Determine mode from the argument:

### 1. Run Eval (default)

```
/eval code-review          # Eval single skill
/eval --all                # Eval all skills with golden tests
/eval --tier core          # Eval core-tier skills only
```

Execute: `./bin/fotw eval <args>`

Report results. If failures found, show the failing assertions and suggest fixes.

### 2. Generate Golden (`generate-golden <skill>`)

```
/eval generate-golden code-review
```

Generate candidate golden test cases for a skill:

1. Read the target skill's SKILL.md to understand purpose, modes, expected output
2. Classify as Category A (artifact processor) or Category B (workflow orchestrator)
3. For Category A: select synthetic artifacts from `references/demo-artifacts/`, craft as inline diff inputs
4. For Category B: generate scenario descriptions matching the skill's domain
5. Generate 5-10 candidate test cases with proposed assertions
6. Present each candidate to the user: show input, proposed assertions, rationale
7. User approves, edits, or rejects each candidate
8. Write approved cases to `skills/<name>/tests/golden.jsonl`

**Assertion guidelines:**
- `contains` for key findings the skill must identify
- `not-contains` for false positives it must avoid
- `regex` for structural patterns (severity labels, section headers)
- Include at least one "clean input" test to check false-positive resistance
- Every test needs a recorded `output` field for deterministic mode

### 3. Promote (`promote <skill>`)

```
/eval promote code-review
```

Review active learnings in `skills/<name>/learnings.md` and promote valuable ones:

1. Read the skill's `learnings.md`
2. For each active learning, ask the user: promote to SKILL.md, promote to a reference file, or discard?
3. For promotions: make the edit, remove from learnings.md
4. For discards: remove from learnings.md

---

## References

| File | Purpose |
|------|---------|
| `references/demo-artifacts/` | Synthetic code samples for golden test generation |
| `references/golden-guidelines.md` | Best practices for writing golden test assertions |
