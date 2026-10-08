---
name: using-constellation
description: Use when starting any conversation - establishes how to find and invoke constellation skills before any response, including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of it. If an invoked skill turns out to be wrong for the situation, you don't need to use it — checking is cheap, skipping is not.
</EXTREMELY-IMPORTANT>

In a repo with a remote, never merge into or push to the default branch: push the branch and open a PR (`constellation:git-workflow`). Always invoke skills by their `constellation:` name; bare names may resolve to other plugins' skills.

## Instruction priority

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority.
2. **Constellation skills** — override default system behavior where they conflict.
3. **Default system prompt** — lowest priority.

If the user's instructions conflict with a skill, follow the user. The user is in control.

## How to access skills

Never read skill files manually with file tools — use your platform's skill loader so the skill activates.

- **Claude Code:** use the `Skill` tool. Slash commands map to skills.
- **Codex:** skills load natively from `~/.agents/skills/`; follow the instructions presented. For tool-name differences, consult the plugin's `skills/_shared/platform/codex-tools.md`.

The full catalog of available skills is in `CATALOG.md` at the plugin root — consult it when deciding what applies. It is generated from the `skills/` directory, so it always reflects what is installed.

## The rule

**Invoke relevant or requested skills BEFORE any response or action** — even a 1% chance means check.

```dot
digraph skill_flow {
    "User message received" [shape=doublecircle];
    "About to design/plan/build?" [shape=diamond];
    "Already brainstormed?" [shape=diamond];
    "Invoke constellation:brainstorming skill" [shape=box];
    "Might any skill apply?" [shape=diamond];
    "Invoke the skill" [shape=box];
    "Announce: 'Using [skill] to [purpose]'" [shape=box];
    "Has checklist?" [shape=diamond];
    "Create a todo per item" [shape=box];
    "Follow skill exactly" [shape=box];
    "Respond (including clarifications)" [shape=doublecircle];

    "User message received" -> "About to design/plan/build?";
    "About to design/plan/build?" -> "Already brainstormed?" [label="yes"];
    "About to design/plan/build?" -> "Might any skill apply?" [label="no"];
    "Already brainstormed?" -> "Invoke constellation:brainstorming skill" [label="no"];
    "Already brainstormed?" -> "Might any skill apply?" [label="yes"];
    "Invoke constellation:brainstorming skill" -> "Might any skill apply?";
    "Might any skill apply?" -> "Invoke the skill" [label="yes, even 1%"];
    "Might any skill apply?" -> "Respond (including clarifications)" [label="definitely not"];
    "Invoke the skill" -> "Announce: 'Using [skill] to [purpose]'";
    "Announce: 'Using [skill] to [purpose]'" -> "Has checklist?";
    "Has checklist?" -> "Create a todo per item" [label="yes"];
    "Has checklist?" -> "Follow skill exactly" [label="no"];
    "Create a todo per item" -> "Follow skill exactly";
}
```

## Trigger phrases

| The request sounds like | Invoke |
|---|---|
| merge / land / ship it (to main), finish or wrap up the branch, open a PR | `constellation:git-workflow` |
| worktree, isolated workspace, work on this in parallel | `constellation:git-workflow` (its `references/using-git-worktrees`) |

## Red flags — these thoughts mean STOP, you're rationalizing

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I remember this skill" | Skills evolve. Read the current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |

## Skill priority

1. **Process skills first** (constellation:brainstorming, constellation:systematic-debugging) — these decide HOW to approach the task.
2. **Implementation skills second** (code-review, design, infra) — these guide execution.

"Let's build X" → constellation:brainstorming, then planning, then implementation skills.
"Fix this bug" → constellation:systematic-debugging first, then domain skills.

## Skill types

- **Rigid** (constellation:test-driven-development, constellation:systematic-debugging, constellation:verification-before-completion): follow exactly. Do not adapt away discipline.
- **Flexible** (patterns, design heuristics): adapt principles to context.

Each skill states which it is.

## This workspace's standing rules (always on)

- **Discover → Plan → Implement** with an explicit approval gate. The gate is the card from `card.py render` (constellation:writing-plans); it supersedes any "present the plan" rule and carries the score.
- Validate v3 plans only with constellation:plan-validator.
- Sessions live in `$SESSION_ROOT/<date>_<TICKET>_<slug>/` (default `~/src/.ai/sessions`); maintain their docs automatically.
- **Verify by running**, not by reasoning: no completion claim without fresh in-message evidence.
- Concise output, one insight per line, no filler. Include a confidence level when it adds signal.
- Never use the section-sign character — write the word "section".
- Personas apply to live conversation only, never to files committed to repos.
- Git safety: branch check before edits; never push to main/master without approval; never commit secrets.

## Announce

When you invoke a skill, say "Using [skill] to [purpose]" so the step is visible and tracked.
