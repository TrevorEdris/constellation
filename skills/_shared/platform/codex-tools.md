# Codex Tool Mapping

Constellation skills are authored with Claude Code tool names. On Codex, use the equivalent:

| Skill references | Codex equivalent |
|-----------------|------------------|
| `Task` tool (dispatch subagent) | `spawn_agent` |
| Multiple `Task` calls (parallel) | Multiple `spawn_agent` calls |
| Task returns result | `wait` |
| Task completes automatically | `close_agent` to free the slot |
| `TodoWrite` (task tracking) | `update_plan` |
| `Skill` tool (invoke a skill) | Skills load natively — follow the instructions |
| `Read`, `Write`, `Edit` (files) | your native file tools |
| `Bash` (run commands) | your native shell tools |
| `Workflow` tool (JS orchestration) | no direct equivalent — fall back to sequential `spawn_agent` |

## Subagent dispatch requires multi-agent support

Add to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

This enables `spawn_agent`, `wait`, and `close_agent` for skills like `dispatching-parallel-agents`, `subagent-driven-development`, and `orchestrate`. Without it, those skills degrade to single-session execution — still correct, just not parallel.
