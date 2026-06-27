---
name: writing-plans
description: Use when you have a spec, brainstorm output, or approved requirements for a multi-step task and are about to write an implementation plan or start touching code — symptoms include "let's build this", a PRD/roadmap/spec handed off, or a task too large for a single edit.
---

# Writing Plans

## Overview

A plan is read by an enthusiastic junior engineer with zero context for this codebase and questionable taste. They are a capable developer who knows almost nothing about your toolset, problem domain, or what good test design looks like. The plan must let them execute every step without a single judgment call. In constellation, the plan is also executed by a subagent and machine-parsed by `constellation:plan-validator`, so it must conform to the PLAN v2 format.

```
EVERY STEP MUST BE EXECUTABLE BY A ZERO-CONTEXT AGENT:
EXACT PATH, COMPLETE CODE, EXACT COMMAND, EXPECTED OUTPUT.
NO STEP MAY REQUIRE A DECISION.
```

Violating the letter of the rules is violating the spirit of the rules. A plan that "captures the intent" but leaves the executor to fill in code, guess a path, or decide how to test is a failed plan, no matter how readable it is to you.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan." Then create a TodoWrite list from the checklist at the bottom of this skill and track every item.

## When to use

- A brainstorm, PRD, roadmap slice, or spec exists and the next move is implementation.
- The task spans multiple files, multiple steps, or any RED-GREEN cycle.
- Use this ESPECIALLY when the change feels "obvious" or you are under time pressure — that is exactly when steps get left vague and the executor diverges.

## When NOT to use

- A single-file, single-edit fix with no behavioral change (just do it).
- You do not yet have a spec or agreed requirements — run `constellation:brainstorming` first (REQUIRED BACKGROUND).

## Iron Law in practice

Every step must satisfy all four:

1. **Exact path** — `src/auth/session.py:42-58`, never "the auth module".
2. **Complete code** — the actual code to write, not "add validation".
3. **Exact command** — `pytest tests/auth/test_session.py::test_expiry -v`, not "run the tests".
4. **Expected output** — `Expected: FAIL with "expire_at not defined"`, so the executor knows whether the step worked.

If you cannot supply all four for a step, you do not understand the step well enough to plan it. Read the code until you do.

## Rationalization table

| Excuse | Reality |
|---|---|
| "The executor can figure out the imports." | A zero-context agent guesses wrong and silently diverges. Write the complete code. |
| "I'll write 'add validation' — the details are obvious." | Vague steps produce different implementations every run. Specify the exact code. |
| "This step is trivial, it doesn't need a verify command." | Unverified steps cascade into silent failures. Every step gets an expected output. |
| "I'll skip the failing-test step to save space." | Untested steps ship bugs. RED before GREEN belongs IN the plan, not just in the executor's head. |
| "It's one feature, one big step is fine." | A step over ~5 minutes can't be reviewed or rolled back cleanly. Split to atomic. |
| "I'll point them at the file; they'll find the function." | Forces re-discovery and drift. Give exact `path:line`. |
| "plan-validator is bureaucracy; my plan is clearly good." | You cannot see your own gaps. The score is the gate, not your confidence. |
| "I'll fill in the real code during implementation." | Then you are planning during execution, where context is gone. Resolve it now. |

## Red Flags — STOP and fix the step

If you catch yourself thinking or typing any of these, the step is not done:

- "They'll know what I mean."
- "Close enough on the path."
- "I'll fill in the code later / during implementation."
- "No need to specify the expected output."
- "This is really one big task." (it isn't — split it)
- "Skip the reviewer / skip the validator, it's fine."
- Writing `etc.`, `and so on`, `similar to the above`, `...`, or a `TODO` inside a step.

## Good vs bad steps

Vague step (bad):

```
- [ ] Add input validation to the login handler and test it.
```

Atomic, executable steps (good):

```
- [ ] **(2.1)** [RED] Write the failing test in `tests/auth/test_login.py`:

  def test_login_rejects_empty_password():
      resp = login(username="ada", password="")
      assert resp.status_code == 400
      assert resp.json()["error"] == "password required"

  Verify: `pytest tests/auth/test_login.py::test_login_rejects_empty_password -v`
  Expected: FAIL — "password required" not in response (handler returns 200)

- [ ] **(2.2)** [RED→GREEN] In `src/auth/login.py:31`, before the credential check, add:

      if not password:
          return JSONResponse({"error": "password required"}, status_code=400)

  Verify: `pytest tests/auth/test_login.py::test_login_rejects_empty_password -v`
  Expected: PASS
```

Note: the bad example bundles test + implementation + verification into one untestable instruction; the good one separates RED from GREEN, gives the full code, exact path:line, exact command, and a distinct expected output for each.

## Before you write steps

1. **Scope check.** If the spec covers multiple independent subsystems, split into one plan per subsystem — each must produce working, testable software on its own. Suggest the split rather than writing one mega-plan.
2. **File structure.** List every file you will create or modify and the single responsibility of each. Prefer small, focused files; files that change together live together; follow existing codebase patterns rather than restructuring unilaterally. This locks in decomposition before tasks.

## Emit the plan in PLAN v2 format

Write to `.ai/sessions/YYYY-MM-DD_<TICKET>_<SLUG>/PLAN.md` (user preferences override). Use the canonical structure in `docs/PLAN-TEMPLATE.md` exactly — do not rename headings, they are parsed programmatically.

- **Frontmatter** — fill `schema: plan/v2`, `date`, `slug`, `status`, `targets`. Leave `plan_validator_score: null`; the validator fills it.
- **Plan header / executor hand-off** — directly under the title, include the executor pointer so whoever runs it knows the chain:

  ```markdown
  > **For the executor:** REQUIRED SUB-SKILL — use constellation:subagent-driven-development (recommended) or constellation:executing-plans to run this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.
  ```

- **Target repo & files** — explicit New/Modified list with exact paths (from your file-structure pass).
- **Architecture decision** — only if a genuine fork exists; recommend one, mark the default.
- **Structure (phased)** — the phase/dependency table; name the critical path.
- **Ordered steps** — the atomic 2-5 minute steps. Tag behavioral steps `[RED→GREEN]`; tag config/docs/codegen `[exempt: reason]` per the project's TDD rule. This is where the Iron Law lives.
- **Risks & assumptions**, **Verification (aggregate)**, **Traceability** (every Discovery finding → a step, or justified out of scope), **Out of scope**, **Git strategy** (branch, conventional commit checkpoints, PR title/description; check `.github/PULL_REQUEST_TEMPLATE.md`; never push to main without approval).

## Validate (the GREEN gate)

1. Run `constellation:plan-validator` (REQUIRED SUB-SKILL) against the PLAN.md.
2. If score < 70: fix every error and warning, then re-run. Repeat until PASS.
3. Do not present the plan to the user until it scores >= 70. Include the score when you present it.

## Plan review loop (spec alignment)

Independent of the validator, dispatch ONE plan-document reviewer subagent to catch spec gaps the validator's structural score won't:

1. Dispatch using `references/plan-document-reviewer-prompt.md` — paste a constructed prompt with the plan path and spec path. Never pass your session history (it pollutes the review and lets the reviewer trust your reasoning instead of the work product).
2. If **Issues Found**: the same agent that wrote the plan fixes it (preserves context), then re-dispatch the reviewer for the whole plan.
3. If **Approved**: proceed to hand-off.
4. Cap the loop at 3 iterations; if it exceeds that, surface to the human. Reviewers are advisory — explain disagreements if you believe the feedback is wrong.

## Execution hand-off

After the plan scores PASS and the reviewer approves, offer the execution choice:

> Plan complete and saved to `<path>` (plan-validator score: NN). Two execution options:
> 1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks; fast iteration.
> 2. **Inline Execution** — execute tasks in this session with checkpoints for review.
> Which approach?

- If Subagent-Driven: **REQUIRED SUB-SKILL** — use `constellation:subagent-driven-development`.
- If Inline: **REQUIRED SUB-SKILL** — use `constellation:executing-plans`.

The ONLY skills you invoke after writing-plans are plan-validator (during writing), then subagent-driven-development or executing-plans (for execution). Do not start editing production code from this skill.

## Checklist (mirror into TodoWrite)

- [ ] Announce: "I'm using the writing-plans skill…"
- [ ] Scope check — split multi-subsystem specs into separate plans
- [ ] File-structure pass — every file + its single responsibility
- [ ] Write PLAN.md in PLAN v2 format with the executor hand-off header
- [ ] Every step satisfies the Iron Law (exact path, complete code, exact command, expected output)
- [ ] Behavioral steps tagged `[RED→GREEN]`; exempt steps tagged `[exempt: ...]`
- [ ] Traceability table maps every Discovery finding to a step
- [ ] Run `constellation:plan-validator` until score >= 70
- [ ] Dispatch plan-document reviewer; resolve issues (cap 3 loops)
- [ ] Present plan with score; wait for explicit approval
- [ ] Offer execution hand-off (subagent-driven recommended)

## Notes

- Tool names above (`Task`, `TodoWrite`, `Read`, `Write`, `Edit`, `Bash`) are Claude Code; on Codex see `skills/_shared/platform/codex-tools.md`.
- Principles to keep visible in every plan: DRY, YAGNI, TDD, frequent commits.
