---
name: writing-skills
description: Use when creating a new skill, editing or extending an existing skill, fixing a skill agents ignore or rationalize around, or verifying a skill before deployment. Symptoms — "add a section to this skill", "the description should summarize the workflow", "this skill is obviously clear, ship it", batching several skills without testing each.
---

# Writing Skills

## Overview

Writing a skill IS Test-Driven Development applied to process documentation. You write a test (a pressure scenario run on a subagent), watch it fail (baseline behavior without the skill), write the skill, watch it pass (agent complies), then refactor (close the loopholes the agent finds).

Core principle: **If you did not watch an agent fail without the skill, you do not know if the skill teaches the right thing.** Skills are reusable techniques, patterns, or references — never narratives about how you solved something once.

This skill is the gate between scaffolding a new skill (directory + frontmatter) and running it through the `constellation:eval` harness. Scaffolding produces a file; this skill makes that file change behavior; the eval harness is the GREEN gate that proves it.

**REQUIRED BACKGROUND:** You MUST understand `constellation:test-driven-development` before using this skill. It defines the RED-GREEN-REFACTOR cycle this skill adapts to documentation.

**REQUIRED SUB-SKILL:** Use the full testing methodology in `references/testing-skills-with-subagents.md` (pressure scenarios, pressure types, plugging holes, meta-testing) when you reach the RED and REFACTOR phases.

## The Iron Law

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to NEW skills AND EDITS to existing skills.

Wrote the skill before running a baseline test? Delete it. Start over.
Edited a skill without testing the edit? Same violation.

**Violating the letter of the rules is violating the spirit of the rules.**

No exceptions:
- Not for "simple additions"
- Not for "just adding a section"
- Not for "documentation updates"
- Don't keep untested changes as "reference"
- Don't "adapt" them while you write the test
- Delete means delete

## Rationalizations — STOP if you think any of these

| Excuse | Reality |
|--------|---------|
| "Skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "It's just a reference" | References have gaps and dead ends. Test retrieval. |
| "Testing is overkill" | Untested skills have issues. Always. 15 min testing saves hours. |
| "I'll test if problems emerge" | Problems = agents already can't use it. Test BEFORE deploying. |
| "Too tedious to test" | Less tedious than debugging a bad skill in production. |
| "I'm confident it's good" | Overconfidence guarantees issues. Test anyway. |
| "Academic review is enough" | Reading ≠ using. Test application scenarios. |
| "No time to test" | Deploying it untested costs more time fixing it later. |
| "Just a one-line edit" | One line changes behavior. That is exactly what tests catch. |
| "Batching skills is more efficient" | Each untested skill is untested code. Test each before the next. |

All of these mean: run a baseline test before you write or change the skill. No exceptions.

## Red Flags — STOP and start the RED phase

- About to write the skill body before running any baseline scenario
- About to edit a skill without a test for the edit
- "I'll just add this one section"
- "I already know what agents get wrong here"
- Description summarizes the workflow (the single highest-leverage mistake — see below)
- Inventing rationalizations for the table instead of harvesting them from a real baseline run
- Moving to the next skill before this one passed under pressure

## Description = WHEN, never WHAT

The frontmatter `description` carries triggering conditions ONLY. Never summarize the skill's process or workflow.

**Why this is the highest-leverage rule:** when the description summarizes the workflow, the agent follows the description and skips the body where the gates live. Documented failure: a description reading "code review between tasks" made the agent run ONE review, even though the skill body's flowchart showed TWO (spec-compliance first, then code-quality). Changing the description to "Use when executing implementation plans with independent tasks" — no workflow summary — made the agent read the flowchart and run both reviews.

```yaml
# BAD: summarizes workflow — agent follows this instead of the body
description: Use when executing plans - dispatches subagent per task with code review between tasks

# BAD: process detail leaks the steps
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# GOOD: triggering conditions only
description: Use when executing implementation plans with independent tasks in the current session

# GOOD: triggers + symptoms, no workflow
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

Write the description in third person (it is injected into the system prompt). Start with "Use when". Add symptoms of being ABOUT to violate the rule for discipline skills. Pack in keywords the agent would search for (error strings, symptoms, tool names). Keep under ~500 characters.

## When to create a skill

Create when: the technique was not obvious to you, you would reference it across projects, it applies broadly, others would benefit.

Do NOT create for: one-off solutions, standard practices documented elsewhere, project-specific conventions (put those in CLAUDE.md), or mechanical constraints enforceable with regex/validation (automate those instead — save docs for judgment calls).

## Skill types and how to test each

| Type | What it is | Test for | Success |
|------|-----------|----------|---------|
| Discipline | Rules/requirements (TDD, verification) | Compliance under combined pressure | Follows rule at maximum pressure |
| Technique | How-to method | Correct application to a NEW scenario | Applies technique, handles edge cases |
| Pattern | Mental model | Recognizing when it applies / does not | Identifies when/how to apply |
| Reference | API/syntax/tool docs | Retrieval + correct use; gap coverage | Finds and applies the right info |

Discipline skills get the full arsenal below. Reference skills with no rule to violate need only clarity testing.

## Classify rigid vs flexible

- **Rigid / discipline** (TDD, systematic-debugging, verification): "Follow exactly." Gets the Iron Law, spirit-vs-letter line, rationalization table, red flags, and Authority + Commitment + Social Proof framing. Its whole value is resisting rationalization under pressure.
- **Flexible / pattern** (design heuristics, root-cause-tracing): "Adapt to context." High freedom, lighter framing, trust the agent's judgment. Over-rigidifying a judgment task wastes reasoning; under-constraining a discipline task lets the agent rationalize an escape.

## RED-GREEN-REFACTOR for skills

| Phase | What you do |
|-------|-------------|
| RED | Run a pressure scenario on a subagent WITHOUT the skill. Document choices and rationalizations verbatim. |
| Verify RED | You can quote the exact excuses the agent used. |
| GREEN | Write the minimal skill that addresses those specific excuses — nothing for hypothetical cases. Re-run. Agent complies. |
| REFACTOR | Agent found a new rationalization? Add an explicit counter, a table row, a red flag. Re-test until no new excuses appear. |

Harvest the rationalization table and red flags from the REAL baseline run. Invented excuses miss the real loopholes.

## Bulletproofing against rationalization

Close every loophole explicitly — forbid the specific workaround, do not just state the rule:

```markdown
# BAD
Write code before test? Delete it.

# GOOD
Write code before test? Delete it. Start over.

No exceptions:
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

Persuasion calibration (see `references/persuasion-principles.md`): discipline skills use **Authority + Commitment + Social Proof**. Ban **Liking + Reciprocity** — no "thanks", no "you're absolutely right" — they induce sycophancy and degrade honest feedback.

## Frontmatter and structure

Frontmatter is EXACTLY two keys: `name` (letters, numbers, hyphens; equals the directory name) and `description`. Max 1024 characters total.

Recommended body shape: one-line Overview with the core principle; "When to use" / "When NOT to use" with concrete symptoms; the discipline arsenal (Iron Law, spirit-vs-letter, table, red flags) if rigid; a Quick-Reference table; ONE complete runnable example in ONE language; Common Mistakes with fixes. Cut anything the agent already knows. Keep the body under ~500 words for frequently-loaded skills.

Cross-reference other skills by name with markers, never with @-links (@ force-loads files and burns context before you need them):

```markdown
# GOOD
**REQUIRED SUB-SKILL:** Use constellation:test-driven-development

# BAD
@skills/test-driven-development/SKILL.md
```

## File organization

Keep principles, concepts, and code patterns under ~50 lines inline. Move to a sibling file only for heavy reference (100+ lines) or reusable tools/scripts. Keep references one level deep from SKILL.md so the agent reads complete files instead of `head`-previewing nested ones. Render flowcharts for your human partner with `scripts/render-graphs.js <skill-dir>`.

## Flowcharts and examples

Flowcharts ONLY at non-obvious decision points, loops where you might stop too early, or "A vs B" choices. Never for reference material (use tables), code (use markdown blocks), or linear steps (use numbered lists). Terminal states use `[shape=doublecircle]`. Style rules: `references/graphviz-conventions.dot`.

One excellent, complete, runnable example beats many mediocre ones. Do NOT implement in 5 languages or write fill-in-the-blank templates.

## STOP: before moving to the next skill

After writing ANY skill, you MUST STOP and complete its deployment process. Do NOT batch-create skills without testing each. Do NOT move on before the current one passes under pressure. Deploying untested skills = deploying untested code.

## Checklist (create a TodoWrite item for EACH line)

Checklists without TodoWrite tracking get steps skipped. Every time. Announce "Using writing-skills to [purpose]" before you start, then track:

**RED:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run scenarios WITHOUT the skill; document baseline behavior verbatim
- [ ] Identify the recurring rationalizations

**GREEN:**
- [ ] `name` is letters/numbers/hyphens and equals the directory name
- [ ] Frontmatter is exactly `name` + `description` (≤ 1024 chars)
- [ ] Description starts with "Use when", is third person, triggers/symptoms ONLY, no workflow summary
- [ ] Keywords throughout for search
- [ ] Overview states the core principle
- [ ] Body addresses the specific baseline failures from RED
- [ ] One excellent example; code inline or in a sibling file
- [ ] Run scenarios WITH the skill; agent now complies

**REFACTOR:**
- [ ] Capture NEW rationalizations from testing
- [ ] Add explicit counters, rationalization-table rows, red-flag entries (if discipline)
- [ ] Re-test until no new rationalizations; meta-test for clarity

**Deploy:**
- [ ] Run through the `constellation:eval` harness as the GREEN gate
- [ ] Commit only after it passes under maximum pressure

## The bottom line

Same Iron Law: no skill without a failing test first. Same cycle: RED (baseline) -> GREEN (write) -> REFACTOR (close loopholes). If you follow TDD for code, follow it for skills — it is the same discipline applied to documentation.
