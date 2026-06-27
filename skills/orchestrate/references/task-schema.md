# Task Schema

Defines the structured format for subtask decomposition and dependency graph representation used by the `orchestrate` skill.

---

## Subtask Definition

Every subtask must define all required fields before execution begins. Optional fields should be populated when known.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier within this orchestration (e.g., `T1`, `T2`, `T3`) |
| `title` | string | yes | Short description, ≤10 words |
| `description` | string | yes | Full scope of the subtask, including what done looks like |
| `acceptance_criteria` | list[string] | yes | Specific, verifiable conditions that must be true when the subtask completes |
| `agent` | string | yes | Best-fit specialist skill or subagent, chosen from the live agent/skill list discovered at intake |
| `dependencies` | list[string] | no | IDs of subtasks that must complete before this one starts. Empty list or omitted = no dependencies |
| `complexity` | enum | yes | `small` (< 1 hour), `medium` (1–4 hours), `large` (4+ hours) |
| `critical` | boolean | yes | `true` = failure blocks the entire orchestration; `false` = can be skipped if it fails |
| `status` | enum | runtime | Set during execution: `pending` / `running` / `completed` / `failed` / `partial` / `skipped` |
| `fallback_agent` | string | no | Agent to try if the primary agent fails. Default fallback = retry on a more capable model, or the general subagent via the `Task` tool. Do NOT pass a Workflow `agentType` of `general-purpose` — it raises a model error. |

---

## Example Subtask Definitions

```
T1:
  title: "Review code quality of auth module"
  description: "Perform a pragmatic code review of src/auth/ focusing on architecture, correctness, and maintainability. Flag issues using the FotW triage matrix."
  acceptance_criteria:
    - Review report produced with findings categorized by severity
    - At least architecture and security sections covered
  agent: pragmatic-code-review
  dependencies: []
  complexity: medium
  critical: true

T2:
  title: "Security audit of auth module"
  description: "Scan src/auth/ for high-confidence security vulnerabilities. Focus on authentication logic, session handling, and input validation."
  acceptance_criteria:
    - Security findings reported with confidence scores
    - No high-confidence findings left unaddressed
  agent: security-review
  dependencies: []
  complexity: medium
  critical: true

T3:
  title: "Update auth module documentation"
  description: "Update docs/auth.md to reflect the current implementation, incorporating findings from T1 and T2. Fix any outdated examples."
  acceptance_criteria:
    - docs/auth.md reflects current API
    - Known issues from T1/T2 noted where relevant
  agent: general-purpose
  dependencies: [T1, T2]
  complexity: small
  critical: false
```

---

## Dependency Graph Format

Present the dependency graph in two complementary formats — a table for structure and an ASCII DAG for visual clarity.

### Table Format

| Subtask | Title | Depends On | Agent | Complexity | Critical |
|---------|-------|-----------|-------|------------|----------|
| T1 | Review code quality | -- | pragmatic-code-review | medium | yes |
| T2 | Security audit | -- | security-review | medium | yes |
| T3 | Update documentation | T1, T2 | general-purpose | small | no |

### ASCII DAG Format

```
T1 ──┐
     ├──> T3
T2 ──┘
```

More complex example:

```
T1 ──┐
T2 ──┼──> T4 ──> T6
T3 ──┘
          T5 ──> T7
```

Rules for valid DAGs:
- No cycles (a task cannot depend on itself, directly or transitively)
- Dependencies must reference IDs that exist in the task list
- A task with no arrows pointing to it is a root (starts immediately)
- A task with no arrows leaving it is a leaf (part of the final batch)

---

## Execution Batches

Group subtasks into batches where all tasks within a batch are independent of each other (no dependencies between tasks in the same batch).

| Batch | Subtasks | Mode | Notes |
|-------|----------|------|-------|
| 1 | T1, T2 | parallel | Both are roots with no dependencies |
| 2 | T3 | sequential | Depends on completion of Batch 1 |

**Parallelism:** All subtasks within a batch should be invoked in the same `Task` tool turn. The orchestrator should not wait for one to finish before starting another within the same batch.

**Sequencing:** Batch N begins only when all subtasks in Batch N-1 are resolved (completed, failed, or skipped).

---

## Status Tracking

During execution, maintain a live status board:

| ID | Title | Agent | Status | Notes |
|----|-------|-------|--------|-------|
| T1 | Review code quality | pragmatic-code-review | completed | 3 High, 2 Medium |
| T2 | Security audit | security-review | completed | No critical findings |
| T3 | Update documentation | general-purpose | pending | Waiting on T1, T2 |

Update this table after each batch completes. Include it in the final aggregation report.
