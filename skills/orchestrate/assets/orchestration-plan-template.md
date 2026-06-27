# Orchestration Plan

Use this template to present the decomposed task plan to the user before execution begins. Fill in every section completely. Do not leave placeholder text in the final plan.

---

## Objective

[State the user's objective in concrete, outcome-focused terms. What will exist or be true when this orchestration completes successfully? 2-4 sentences.]

**Scope:**
- In scope: [explicit list of files, directories, systems, or concerns to be addressed]
- Out of scope: [explicit list of things being deliberately excluded and why]

---

## Subtask Breakdown

| ID | Title | Agent | Depends On | Complexity | Critical |
|----|-------|-------|-----------|------------|----------|
| T1 | [title] | [agent-name] | -- | small/medium/large | yes/no |
| T2 | [title] | [agent-name] | -- | small/medium/large | yes/no |
| T3 | [title] | [agent-name] | T1, T2 | small/medium/large | yes/no |

**Subtask Details:**

**T1 — [Title]**
- Agent: `[agent-name]`
- Description: [Full description of what this subtask entails]
- Acceptance criteria:
  - [Specific, verifiable condition]
  - [Specific, verifiable condition]

**T2 — [Title]**
- Agent: `[agent-name]`
- Description: [Full description of what this subtask entails]
- Acceptance criteria:
  - [Specific, verifiable condition]

**T3 — [Title]**
- Agent: `[agent-name]`
- Depends on: T1, T2 (needs their outputs before starting)
- Description: [Full description of what this subtask entails]
- Acceptance criteria:
  - [Specific, verifiable condition]

---

## Dependency Graph

```
[ASCII DAG showing which subtasks depend on which]

T1 ──┐
     ├──> T3
T2 ──┘

```

**Critical path:** [List the longest dependency chain — this is the minimum number of sequential steps, e.g., "T1 → T3 → T5 (3 sequential batches)"]

---

## Execution Batches

Subtasks within each batch run in parallel. Each batch waits for the previous batch to complete.

| Batch | Subtasks | Mode | Estimated Effort |
|-------|----------|------|-----------------|
| 1 | T1, T2 | parallel | [combined estimate, e.g., "~30 min (both running concurrently)"] |
| 2 | T3 | sequential | [estimate, e.g., "~15 min"] |

**Total estimated elapsed time:** [Sum of sequential batch durations, not total agent time]

---

## Failure Strategy

| Subtask | Critical | Failure Behavior |
|---------|----------|-----------------|
| T1 | yes | Retry 1x → fallback to `general-purpose` → **halt** if still failing |
| T2 | yes | Retry 1x → fallback to `general-purpose` → **halt** if still failing |
| T3 | no | Retry 1x → fallback to `general-purpose` → **skip** if still failing |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| [Risk description] | low/medium/high | low/medium/high | [Specific mitigation approach] |
| [e.g., security-review agent requires specific file context that may be incomplete] | medium | medium | [Include full file contents in handoff, not just diffs] |
| [e.g., T3 depends on T1 findings which may include breaking change recommendations] | low | high | [Pass T1 full output to T3; T3 should note pending changes] |

---

## Files in Scope

[Explicit list of every file that will be read or modified by any subagent. This helps the user verify scope before approving.]

**Read only:**
- [file path]
- [file path]

**May be modified:**
- [file path]
- [file path]

---

## Approval

Does this plan accurately represent what you want accomplished?

**Options:**
- **yes** — Proceed with execution as described
- **no** — Stop; the plan is fundamentally wrong
- **modify: [instructions]** — Adjust the plan before proceeding (specify what to change)

Execution begins only after explicit approval.
