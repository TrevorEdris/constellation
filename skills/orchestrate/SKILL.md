---
name: orchestrate
description: Use when one request spans multiple domains (e.g. code + tests + docs + security + diagrams), has independent workstreams that could run concurrently, or is too large for a single agent in one pass — symptoms include "do all of X, Y, and Z", a multi-part review, or a task that would obviously thrash one agent's context
---

# Orchestrate

Decompose a large, multi-domain task into dependency-aware subtasks, delegate each
to the best-fit specialist, run independent subtasks concurrently, and synthesize
the results. You coordinate and aggregate — you do not perform the specialist work
yourself.

This is a flexible skill: adapt the decomposition and routing to the task. The
gates below (independence check, plan approval, post-return verification) are not
optional.

## When to Use

- The task spans 2+ distinct domains (code quality, security, docs, design, infra).
- Independent workstreams could run in parallel and cut wall-clock time.
- The task is too large or context-heavy for one agent in a single pass.

## When NOT to Use

- Single-domain task → invoke that specialist skill/agent directly; orchestration is overhead.
- Tightly-coupled steps with no parallelism → execute inline or use
  constellation:subagent-driven-development.
- You don't yet know what's broken (exploratory) → investigate first with
  constellation:systematic-debugging.

## Process

Announce: "Using orchestrate to coordinate N subtasks across M domains."
Create a TodoWrite with one item per subtask plus the final aggregation. Checklists
without TodoWrite tracking get skipped.

### 1. Intake

Parse the request. Identify the primary objective and definition of done, the
domains touched, files/systems in scope, hard constraints, and preferences. Discover
the available specialists for this session (list the project's agents/skills) — the
live list is authoritative, not memory. If scope is ambiguous, ask targeted
questions BEFORE decomposing. Decomposing an unclear task wastes every subagent's run.

### 2. Decompose

Break the work into atomic subtasks using `references/task-schema.md`. Route each to
a best-fit specialist. Build the dependency graph: mark independent subtasks (parallel
batch candidates), sequential chains, and the critical path. Split any subtask that
straddles two domains into one subtask per domain rather than handing the blend to a
generalist.

### 3. The Independence Gate (before any parallel batch)

For each batch you intend to run concurrently, confirm BOTH:

1. **No shared state** — subtasks will not edit the same files, resources, or global state.
2. **No sequential dependency** — none needs another's output to start.

If either fails, do not parallelize that batch — sequence it. REQUIRED BACKGROUND:
`references/dispatching-parallel-agents/` is the per-agent dispatch playbook this gate comes from.

### 4. Plan and Approval

Present the plan with `assets/orchestration-plan-template.md`: objective, subtask
table, ASCII DAG, execution batches (parallel vs sequential), failure strategy, risks,
files in scope. Wait for explicit user approval. If the user modifies the plan, update
it and re-confirm before executing.

### 5. Execute

Run batches in topological order. For each subtask, construct the full handoff context
per `references/handoff-format.md` — paste everything the subagent needs (task text,
acceptance criteria, file scope, summarized upstream outputs, branch/repo). Never tell
a subagent to "read the plan"; subagents do not inherit your session, so constructed
context is all they get.

After each batch, validate output against acceptance criteria and update the live
status board (`completed` / `failed` / `partial` / `skipped`).

### 6. Failure Handling

Escalation ladder, in order:

1. **Retry (1x)** — re-dispatch the same role with the failure reason and enriched context.
2. **Fallback** — retry on a more capable model, or the general subagent.
3. **Skip** — only if the subtask is non-critical with no downstream dependents; document it.
4. **Halt** — a critical subtask still failing after retry + fallback stops execution; report
   which subtask failed, what was attempted, and what is now blocked.

Never absorb a failure silently. Cap any retry/fix loop at 3 iterations, then surface
to the human — do not thrash.

### 7. Aggregate

Produce the final report: executive summary, per-subtask results table (status, agent,
key output), deduplicated list of modified files, unresolved items, and a ship
recommendation (SHIP / NEEDS WORK / BLOCKED) with rationale.

## Dispatch Mechanics (workspace constraints)

- **Prefer the Workflow tool for scripted fan-out** when dispatching many subtasks; use
  the `Task` tool for ad-hoc dispatch. Issue all `Task` calls for one parallel batch in a
  single message so they run concurrently.
- **agentType: use `Explore` or omit it. NEVER `general-purpose`** — it raises a model error.
- **Do NOT force `model: opus`** — a forced model cascades restarts when that model is
  unavailable; let the model default and pick the cheapest tier per role.
- **Pin every review/inspection subagent to the diff.** Give them the exact file list:

  ```
  Review ONLY the files in this PR. Get the exact list with:
    gh pr diff --name-only
  Do not review code outside that list, even if it looks related.
  ```

  Without a pinned scope, reviewers drift into merged worktree code outside the diff.
- On Codex, `Task` maps to `spawn_agent`; see the plugin's `skills/_shared/platform/codex-tools.md`.

## Writing the Subtask Prompt

Every prompt is focused (one domain), self-contained (all context pasted in), constrained
(what not to touch), and explicit about the return format. Paste real error text, file
paths, and upstream findings — never make the subagent rediscover them.

❌ Too broad — agent gets lost:
```
Improve the auth module.
```
✅ Scoped to one domain:
```
Security-audit src/auth/ for high-confidence vulns in session handling and token expiry.
```

❌ No context — agent must rediscover the problem:
```
Update the docs to match the code.
```
✅ Context pasted in:
```
Update docs/auth.md to the v2 API. Reference (do not modify): src/auth/session.go,
src/auth/tokens.go. Upstream finding from the review subtask: token.Refresh() now
validates before issuing — reflect this. Return: files changed + one-line reason each.
```

❌ Vague output — you can't verify what changed:
```
Fix it and report back.
```
✅ Fixed return contract:
```
Return: status (completed/partial/failed), summary, files modified, key decisions,
unresolved items.
```

## After Subagents Return — Mandatory Verification

Independent-by-design is an assumption until verified. Do not aggregate on the
subagents' word.

1. **Read each summary** — note every file each agent changed.
2. **Conflict check** — if two agents touched the same file, diff and reconcile by hand.
3. **Distrust optimistic reports** — agents that finished fast may be wrong; spot-check
   the actual diffs against acceptance criteria, and confirm tests drive the REAL code
   path, not fakes or injected state (a false-green ships broken work).
4. **Run the FULL suite** — not just per-domain tests. Parallel changes can each pass in
   isolation and break together. You cannot report SHIP without running it in this message
   and seeing it pass.

```
✅ Ran the full suite after integrating all batches; output shows 0 failures — SHIP.
❌ Every subtask reported its own tests pass, so the suite is green. (No combined run = not verified.)
```

## Persuasion Hygiene

Keep reviewer and implementer prompts adversarial and neutral. Do not thank subagents
or tell them "you're absolutely right" — flattery induces sycophancy and degrades honest
feedback.

## Integration

- REQUIRED BACKGROUND: `references/dispatching-parallel-agents/` — the per-agent dispatch
  and independence-gate playbook this skill coordinates at scale.
- REQUIRED BACKGROUND: constellation:verification-before-completion — the full-suite run is
  the completion gate; do not skip it.
- Pairs with constellation:subagent-driven-development — for executing a sequential plan of
  mostly-independent tasks in one session with per-task review.
- Pairs with constellation:systematic-debugging — confirm each domain is genuinely
  independent before splitting.
- Routes work to whichever specialist skills the session exposes (code-review,
  security-review, accessibility-audit, etc.).

## References

- `references/task-schema.md` — subtask fields, dependency graph, execution batches, status board.
- `references/handoff-format.md` — the context block to construct per subagent and the output contract back.
- `assets/orchestration-plan-template.md` — the plan to present for approval.
