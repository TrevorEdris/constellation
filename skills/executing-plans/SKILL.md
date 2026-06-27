---
name: executing-plans
description: Use when you have a written implementation plan to execute inline (no subagents available) — single-session execution of a plan's tasks in a repo without the fellowship/subagent harness.
---

# Executing Plans

## Overview

The inline, no-subagent fallback for working a written plan. Load the plan, review it critically, execute every task exactly as written, stop and ask at any blocker.

```
NO TASK EXECUTED BEFORE THE PLAN IS CRITICALLY REVIEWED. NO BLOCKER WORKED AROUND BY GUESSING.
```

Violating the letter of the rules is violating the spirit of the rules. "I followed the gist of the plan" is not following the plan.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## This is the inferior path — say so

One agent, one context, no isolation. Subagent-driven execution produces significantly higher-quality work. If subagents are available, name the tradeoff to your human partner before proceeding — do not silently go inline because it is easier.
- **REQUIRED SUB-SKILL (when subagents exist):** Use `constellation:subagent-driven-development` instead of this skill.

## When to Use

- A written plan exists, and the repo has no fellowship/subagent harness (or the platform lacks subagents).
- Use this ESPECIALLY when tempted to skip the critical review because the plan "looks fine" or the partner is waiting.

## When NOT to Use

- Subagents are available → `constellation:subagent-driven-development`.
- No written plan yet → `constellation:writing-plans` first.

## The Process

### Step 1: Load and review the plan critically
1. Read the plan file in full.
2. Review critically — hunt for gaps, ambiguous steps, missing verifications, wrong assumptions, ordering problems. Do not assume the plan is correct because someone wrote it.
3. If you have ANY concern: raise it with your human partner before starting. Do not fix it silently.
4. If no concerns: create a TodoWrite list with one item per plan task and proceed.

### Step 2: Set up the workspace
- **REQUIRED SUB-SKILL:** Use `constellation:using-git-worktrees` to set up an isolated workspace before editing.
- Branch check: never start implementation on `main`/`master` without explicit user consent.

### Step 3: Execute tasks
For each task, in order:
1. Mark the todo `in_progress`.
2. Follow each step exactly — the plan has bite-sized steps; do not batch, reorder, or "improve" them.
3. For behavioral code, follow RED-GREEN-REFACTOR (**REQUIRED BACKGROUND:** `constellation:test-driven-development`).
4. Run the verifications the plan specifies. Do not skip them.
5. Mark the todo `completed` only after its verification passes in THIS message.

### Step 4: Complete development
After all tasks are complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use `constellation:finishing-a-development-branch` to verify tests, present options, and execute the choice.

## STOP and ask — do not guess

Stop executing immediately and ask your human partner when:
- You hit a blocker (missing dependency, failing test you cannot explain, unclear instruction).
- The plan has a critical gap that prevents starting or continuing.
- You do not understand an instruction.
- A verification fails repeatedly — after the 3rd fix attempt, STOP (**REQUIRED BACKGROUND:** `constellation:systematic-debugging`).

Return to Step 1 (re-review) when the partner updates the plan or the fundamental approach changes.

## Red Flags — STOP if you think any of these

- "The plan looks fine, I'll skip the critical review."
- "This step is obvious, I'll combine it with the next one."
- "I'll skip this verification, it always passes."
- "The plan didn't say to, but I'll add this one improvement while I'm here."
- "This instruction is ambiguous, I'll just pick what seems right and keep going."
- "Subagents would be better but inline is faster, no need to mention it."
- "Tests fail but the change is correct, I'll mark it done anyway."

Each of these is the moment a plan execution goes off the rails. Stop and reset to the rule.

## Rationalizations

| Excuse | Reality |
|---|---|
| "The plan was written by someone competent, no need to review it." | Critical review catches gaps the author missed; that is the cheapest place to catch them. |
| "Raising a concern will slow us down." | Executing a flawed plan silently is far slower — you rebuild later. Raise it now. |
| "I'll batch these small steps to save time." | Bite-sized steps exist so verification stays meaningful. Batching hides which step broke. |
| "This verification is noise, I'll skip it." | The verification is the only evidence the step worked. Skipping it makes 'done' a guess. |
| "I'll add a quick improvement the plan didn't mention." | Scope creep off-plan is unreviewed work. If it matters, raise it; do not smuggle it in. |
| "Inline is fine, no need to mention subagents." | Hiding the inferior path denies your partner the choice. Name it explicitly. |
| "I'll guess what this ambiguous step means and continue." | A wrong guess compounds across later steps. Stop and ask. |

## Good vs Bad

✅ "Reviewing the plan before executing: Step 4 has no verification command and Step 6 assumes a migration that Step 2 doesn't create. Flagging both before I start."

❌ "Plan looks good, starting Step 1." (no critical review)

✅ "Step 3's test fails with `connection refused` — that's a real blocker, not a code bug. Stopping to ask rather than guessing at the DB config."

❌ "Step 3's test fails, let me also tweak the config and the retry logic and the timeout and see if any of it helps." (multiple simultaneous guesses)

✅ "Subagents aren't available in this repo, so I'm executing inline. Quality would be higher with subagent-driven-development — flagging that. Proceeding inline with your go-ahead."

❌ Silently executing inline when subagents were available.

## Integration

- **Upstream:** `constellation:writing-plans` produces the plan this skill executes.
- **Required before editing:** `constellation:using-git-worktrees`.
- **Downstream hand-off:** `constellation:finishing-a-development-branch`.
- **Preferred alternative:** `constellation:subagent-driven-development` whenever subagents exist.
- **Background disciplines:** `constellation:test-driven-development`, `constellation:systematic-debugging`, `constellation:verification-before-completion`.
