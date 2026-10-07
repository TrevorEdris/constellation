# Codex Tool Mapping

Constellation skills are authored with Claude Code tool names. On Codex, use the equivalent:

| Skill references | Codex equivalent |
|-----------------|------------------|
| `Task` tool (dispatch subagent) | `spawn_agent` with `fork_turns: "none"` |
| Multiple `Task` calls (parallel) | Multiple `spawn_agent` calls |
| Task returns result | `wait_agent` |
| Send an implementer its fix-round feedback | `followup_task` on the same child |
| Task completes automatically | V1 only: `close_agent` to free the slot; V2 has none |
| `TodoWrite` (task tracking) | `update_plan` |
| `Skill` tool (invoke a skill) | Skills load natively — follow the instructions |
| `Read`, `Write`, `Edit` (files) | your native file tools |
| `Bash` (run commands) | your native shell tools |
| `Workflow` tool (JS orchestration) | no direct equivalent — fall back to sequential `spawn_agent` |

Codex has two multi-agent versions, V1 and V2, chosen by your model preset (newer presets run V2). Trust your actual tool list over this table when they disagree.

## Dispatching and waiting

- **Clean context:** `fork_turns: "none"` gives the child a fresh context. The default, `"all"`, copies your entire transcript into the child.
- **Model and effort:** every `spawn_agent` sets `model` and `reasoning_effort` explicitly, per the model-selection rules of the skill you are running. Setting `model` alone leaves the child's effort at that model's default, not yours.
- **Waiting:** `wait_agent` is an event subscription, not a poll. While you have local work, do not wait; a finished child's answer arrives with your next turn. When idle with children outstanding, wait in bounded stretches of 300000-600000 ms. A shorter timeout wakes no sooner and costs a tool call each time.
- **Fix rounds:** resume the same implementer with `followup_task`. It delivers your message, triggers a turn, and reloads a child the harness evicted. Do not spawn a fresh implementer for a fix.
- **Lifecycle:** on V1 only, call `close_agent` on each reviewer when its review returns and on each implementer after its task's review passes. V2 has no such call; finished children are evicted when slots are needed.

## Subagent dispatch requires multi-agent support

Add to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

This enables `spawn_agent`, `wait_agent` and `followup_task` (plus `close_agent` on V1 only) for `constellation:subagent-driven-development` and `constellation:orchestrate` (see the `references/dispatching-parallel-agents/SKILL.md` guide in `constellation:orchestrate` for parallel dispatch). Without it, those skills degrade to single-session execution — still correct, just not parallel.
