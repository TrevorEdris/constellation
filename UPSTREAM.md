# Upstream Provenance

Where each carried piece of constellation came from, and the upstream commit it was last synced to. A port slice updates the Synced cell of each row it touches. `python3 scripts/gen-catalog.py --check` enforces the rows: every top-level skill needs one, and every row path must exist.

- `7e51643` = superpowers v5.0.5, 2026-03-17, the 0.1.0 base.
- `8ca22db` = superpowers v6.4.2, 2026-09-25.
- superpowers = https://github.com/obra/superpowers
- fotw = fellowship-of-the-workflows, carried 2026-06-26; no sync commit is recorded, so its Synced cell is `-`.
- Origin: `superpowers` (ported), `superpowers+fotw` (merged), `fotw` (carried), `constellation` (native). Upstream path is relative to the repo of the first named origin.

## Departures

1. The chat approval card replaces superpowers' saved-plan review (#2258, in v6.4.2), and the plan-document reviewer is removed, so a port skips both.
2. Constellation never enters plan mode (superpowers `e16d611`).
3. The two git-workflow references are synced to v6.4.2 `8ca22db` and every other carried skill to v5.0.5 `7e51643`; file rows at `8ca22db` are finer than their skill rows.
4. fotw-origin skills are marked `fotw`.

## Rows

| Constellation path | Origin | Upstream path | Synced | Notes |
| --- | --- | --- | --- | --- |
| `skills/receiving-code-review/` | superpowers | `skills/receiving-code-review/` | 7e51643 | |
| `skills/subagent-driven-development/` | superpowers | `skills/subagent-driven-development/` | 7e51643 | |
| `skills/using-constellation/` | superpowers | `skills/using-superpowers/` | 7e51643 | Renamed. |
| `skills/code-review/references/requesting-code-review/` | superpowers | `skills/requesting-code-review/` | 7e51643 | Nested under the fotw `code-review` row; reviewer prompt from upstream `code-reviewer.md`. |
| `skills/orchestrate/references/dispatching-parallel-agents/` | superpowers | `skills/dispatching-parallel-agents/` | 7e51643 | Nested under the fotw `orchestrate` row. |
| `skills/subagent-driven-development/references/executing-plans/` | superpowers | `skills/executing-plans/` | 7e51643 | Nested under the `subagent-driven-development` row. |
| `docs/SUPERPOWERS-EFFECTIVENESS.md` | superpowers | `skills/writing-skills/` | 7e51643 | Distilled from upstream, not ported. |
| `skills/systematic-debugging/scripts/find-polluter.sh` | superpowers | `skills/systematic-debugging/find-polluter.sh` | 8ca22db | Byte-identical to upstream. |
| `skills/_shared/platform/codex-tools.md` | superpowers | `skills/using-superpowers/references/codex-tools.md` | 8ca22db | Correctness subset only: dispatch, wait, fix-round, lifecycle and model rules. |
| `skills/git-workflow/references/using-git-worktrees/` | superpowers | `skills/using-git-worktrees/` | 8ca22db | Nested under the fotw `git-workflow` row. |
| `skills/git-workflow/references/finishing-a-development-branch/` | superpowers | `skills/finishing-a-development-branch/` | 8ca22db | Nested under the fotw `git-workflow` row. |
| `skills/brainstorming/` | superpowers+fotw | `skills/brainstorming/` | 7e51643 | `helper.js` and `server.cjs` are byte-identical to v5.0.5; `start-server.sh`, `stop-server.sh` and `frame-template.html` are rebranded (`.superpowers` to `.constellation`, page title). |
| `skills/systematic-debugging/` | superpowers+fotw | `skills/systematic-debugging/` | 7e51643 | `find-polluter.sh` has its own row at 8ca22db. |
| `skills/test-driven-development/` | superpowers+fotw | `skills/test-driven-development/` | 7e51643 | |
| `skills/verification-before-completion/` | superpowers+fotw | `skills/verification-before-completion/` | 7e51643 | |
| `skills/writing-plans/` | superpowers+fotw | `skills/writing-plans/` | 7e51643 | PLAN v2 template from fotw; departures 1 and 2. |
| `skills/chaos-review/` | fotw | `skills/chaos-review/` | - | |
| `skills/code-review/` | fotw | `skills/code-review/` | - | Contains the superpowers row `skills/code-review/references/requesting-code-review/`. |
| `skills/git-workflow/` | fotw | `skills/git-workflow/` | - | Contains the superpowers rows `using-git-worktrees` and `finishing-a-development-branch`. |
| `skills/orchestrate/` | fotw | `skills/orchestrate/` | - | Contains the superpowers row `skills/orchestrate/references/dispatching-parallel-agents/`. |
| `skills/plan-validator/` | fotw | `skills/plan-validator/` | - | |
| `skills/prd-author/` | fotw | `skills/prd-author/` | - | Includes the fotw `prd-validator` and `prd-to-roadmap` skills as nested references. |
| `skills/security-review/` | fotw | `skills/security-review/` | - | |
| `skills/session-handoff/` | fotw | `skills/session-handoff/` | - | |
| `agents/` | fotw | `agents/` | - | |
| `skills/architecture-diagrams/` | constellation | - | - | Constellation-native (#1, 2026-07-02). |
