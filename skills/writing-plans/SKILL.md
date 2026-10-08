---
name: writing-plans
description: Use when you have a spec, brainstorm output, or approved requirements for a multi-step task and are about to write an implementation plan or start touching code — symptoms include "let's build this", a PRD/roadmap/spec handed off, or a task too large for a single edit.
---

# Writing Plans

## Overview

A plan is read by an enthusiastic junior engineer with zero context for this codebase and questionable taste. They are a capable developer who knows almost nothing about your toolset, problem domain, or what good test design looks like. The plan must let them execute every step without a single judgment call. In constellation, the plan is also executed by a subagent and machine-parsed by `constellation:plan-validator`, so it must conform to plan/v3: a v3 head (frontmatter with `delivery`, and the Brief as an approval card) over the PLAN v2 body.

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
| "plan-validator is bureaucracy; my plan is clearly good." | You cannot see your own gaps. Its errors and the approval card are the gate, not your confidence. |
| "I'll fill in the real code during implementation." | Then you are planning during execution, where context is gone. Resolve it now. |

## Red Flags — STOP and fix the step

If you catch yourself thinking or typing any of these, the step is not done:

- "They'll know what I mean."
- "Close enough on the path."
- "I'll fill in the code later / during implementation."
- "No need to specify the expected output."
- "This is really one big task." (it isn't — split it)
- "Skip the validator, it's fine."
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

## Emit plan/v3

Write to the session dir: `$SESSION_ROOT/<date>_<TICKET>_<slug>/PLAN.md`, with `~/src/.ai/sessions` as the default root, or the dir named in the `Session journal:` reminder when one is present. Use the canonical structure in `references/PLAN-TEMPLATE.md` (bundled with this skill) exactly: do not rename headings, they are parsed programmatically. `<plugin root>` below is the constellation plugin directory, two levels above this skill's folder; the PLAN reminder hook prints it in full.

- **Frontmatter** — fill `schema: plan/v3`, `date`, `slug`, `status: draft`, `delivery`, `tags`. Block YAML, and no inline `# comments` on a value.
- **`delivery`** — one block-list item per repo: `repo` (absolute path), `mode` (`pr`, `stack` or `local-only`), `branch`, `base`, `remote` (a remote name, or `none`), `prs` (a whole number: pr 1, local-only 0, stack at least 2). Run `git remote -v` and `git log -5` in each repo before writing `delivery` and the Brief's Ships-as line, so the remote, the base and the commit style are read, not remembered. A folder that is not a git repo gets `mode: local-only`, `remote: none`, `branch: n/a`.
- **Global Constraints** — one D-line per decision: `- D1 [ask] <question>? Default: <d>. Why: <w>. If wrong: <c>.` or `- D2 [made] <decision>. Why: <w>. If wrong: <c>.`. Forcing rule: a one-way choice, or one that conflicts with CLAUDE.md, memory or an open decision, is `[ask]`, never `[made]`. Each `[ask]` becomes a numbered card question with the same default.
- **Hand-off line** — keep the template's `> **For agentic workers:**` line under the Brief's closing `---`.
- **Brief** — the first `##` section and the approval card, written for the human. Leave the template placeholders in place until the plan body is final; see "Write the Brief last".
- **Target repo & files** — explicit New/Modified list with exact paths (from your file-structure pass).
- **Architecture decision** — only if a genuine fork exists; recommend one, mark the default.
- **Structure (phased)** — the phase/dependency table; name the critical path.
- **Ordered steps** — the atomic 2-5 minute steps. Tag behavioral steps `[RED→GREEN]`; tag config/docs/codegen `[exempt: reason]` per the project's TDD rule. This is where the Iron Law lives.
- **Risks & assumptions**, **Verification (aggregate)**, **Traceability** (every Discovery finding → a step, or justified out of scope), **Out of scope**, **Git strategy** (branch, conventional commit checkpoints, PR title/description; check `.github/PULL_REQUEST_TEMPLATE.md`; never push to main without approval).

## Estimate the PR size

Every plan MUST include the `## Estimated PR size` section. After the file-structure pass and ordered steps, forecast the total line delta:

1. **Count** — each New file contributes its full line count; each Modified file contributes the added + removed lines implied by its step code. Sum to a total (added + removed). This is an estimate, not a measured diff.
2. **Record** — fill the per-area table and the bolded `Estimated PR size: <N> lines`.
3. **Threshold (1,000 lines)** — if the total exceeds 1,000 lines you MUST:
   - Add a `> ⚠️ Large PR warning` block naming the estimate and the 1,000-line threshold.
   - Find clean split points — independent subsystems, phase boundaries, or file groups that each ship working, testable software alone (reuse the Scope check in "Before you write steps").
   - Use `AskUserQuestion` to confirm the split BEFORE restructuring. Make splitting into the proposed smaller PRs the first/recommended option; always include "keep as one PR". Never split silently or force a split.
   - If confirmed: emit one PLAN per PR (each independently shippable) via the multi-plan path. If declined: keep one plan and record the decision in the size section.

## Validate, then self-review

**Validate (the GREEN gate):**

1. Run `python3 <plugin root>/skills/plan-validator/scripts/validate_plan.py "<abs PLAN>" --verbose` (REQUIRED SUB-SKILL: `constellation:plan-validator`, which owns the checks).
2. Fix every error outside `## Brief`, then run it again until none remain. The Brief's own errors wait for "Write the Brief last"; render validates the whole plan again before it prints a card.
3. A warning marked `(human)` prints on the card. Fix it now when you can.

**Self-review**, inline, against the plan on disk. Four items; fix what you find where you find it, and move on:

1. **Spec coverage** — every requirement in the spec or brainstorm output maps to a step. Add a step for each gap.
2. **Placeholders** — no `TBD`, `TODO`, `etc.`, `similar to the above` or `...` in a step, and no template slot left outside the Brief.
3. **Brief fidelity** — everything the Brief will report is settled in the body: each `[ask]` D-line has its default, each choice you took is a `[made]` D-line, and `delivery` and its PR count are final.
4. **Consistent names** — a file, function, type or flag has one spelling across the steps, the file list and the D-lines.

## Write the Brief last

The plan body is tuned for a zero-context executor. The human approving it needs the opposite: 30 seconds, plain words. Write `## Brief` only after validation errors outside it are fixed and the self-review is done. A Brief written first describes the plan you intended, not the plan you wrote.

The Brief is the approval card. It holds these six labels, in this order:

- **Needs your call:** — at most 3 questions, then Run. A question is `N. <question>? → **<default>** (<why>; if wrong: <cost>)`, one per `[ask]` D-line, with the same default. Run is always the last numbered item: `N. Run → **subagent-driven** (<why>; or inline)`, or `**inline**` and `or subagent-driven`. Its reason is specific to this plan (how many tasks, how independent, what they share), never boilerplate.
- **Ships as:** — from `delivery`: `1 PR, <branch> → <remote>/<base>`, `<prs>-PR stack, <branch> → <remote>/<base>`, or `local only, no PR, <branch>`.
- **Delivers:** — `A <user> can <action>.` in at most 25 words: what a user will notice, not the work performed. A foundation plan says `None user-visible: foundation for <X>`.
- **Size:** — counts, not adjectives: `~<N> lines · <N> files · <N> tasks · <N> PR`. The PR count equals the sum of `prs`.
- **Made for you:** — the costliest `[made]` D-lines, at most 3, each `- D<n> <choice> (if wrong: <cost>)`, or `None.`. This is the approver's veto surface; hiding a decision to keep the card short is a defect.
- **Flags:** — `none`, or any of auth, payments, migration, delete, external-contract, prod-infra.

Budgets: the ask line plus the Brief, plus the 4 words of check time render adds to Ships as, at most 120 words; the last numbered line ends by word 60; each question and each Made-for-you item at most 20 words. Plain language: no code, no file names, no step numbers.

Before you render, read the Brief against the body once: Delivers names what the steps produce, Made for you lists the costliest `[made]` lines, Size matches the file list and the PR split.

**Living section:** the Brief always describes the plan as it stands now. Any edit that changes the plan's outcome, a question or a resolved decision REQUIRES rewriting the Brief in the same edit. After approval, any Brief edit sets `status` back to `awaiting-approval` and re-renders the card, because render only prints a notice for an approved plan, and the user approves again.

| Excuse | Reality |
|---|---|
| "The steps are self-explanatory" | To an executor. The approver reads 120 words or skims 3,000. |
| "I'll update the Brief at the end" | A stale Brief is worse than none — the human trusts it. |
| "The decision was obvious" | Obvious to you. List it; the approver decides what is obvious. |

## Approval gate

The card is the gate message. It supersedes any "present the plan" rule, here or elsewhere, and its footer carries the score, so never run another validator on a v3 plan.

1. Run `python3 <plugin root>/skills/plan-validator/scripts/card.py render "<abs PLAN>"`.
   - Exit 0: post its stdout verbatim as the gate message, with at most one short line before it and at most one short line after. Do not summarize the plan, restate the Brief or add the score. A `draft` plan becomes `awaiting-approval`.
   - Exit 1: stdout is empty and stderr lists what to fix. Fix it and render again; post no card until one prints.
2. Wait for the user's reply. Silence or a timed-out AskUserQuestion is never approval.
3. Pass the reply, unchanged, on stdin through a quoted heredoc, so quotes, `$`, backticks and newlines arrive as typed. `<session>` is the session dir that holds the plan; approve logs every reply under `## Decisions` in its SESSION.md.

   ```
   python3 <plugin root>/skills/plan-validator/scripts/card.py approve "<abs PLAN>" --reply-file - --session-md "<session>/SESSION.md" <<'END_OF_REPLY'
   <the user's reply, unchanged>
   END_OF_REPLY
   ```

4. Act on the exit code:
   - 0, approved: the plan is `approved` and the user's answers are written into it. Hand off, below.
   - 2, change requested: the plan is untouched. Make the change, rewrite the Brief to match, render again (it reprints and writes nothing), and post the new card.
   - 3, not sure: stdout is the question for the user. Post it word for word, wait, and run approve again on the next reply.
   - 1, refused, or 64, usage: nothing was approved and stderr says why. Fix the cause and run it again; when it names the user's answer, ask them to reword it.

A filled card, as render prints it:

```
**Approve "Wishlist: share a list by link"?** Reply go to take every default, or answer by number.
**Needs your call:**
1. Share links expire? → **after 30 days** (limits leaked links; if wrong: one config value)
2. Link viewers see claimed items? → **no** (protects the surprise invariant; if wrong: one flag)
3. Run → **subagent-driven** (5 independent tasks; or inline)
**Ships as:** 1 PR, feat/share-link → origin/main (remote checked 10-07 09:12)
**Delivers:** A signed-in user can share a read-only wishlist link with anyone.
**Size:** ~430 lines · 9 files · 5 tasks · 1 endpoint · 1 PR
**Made for you:**
- D4 Token is 128-bit random, stored hashed (if wrong: rotate all tokens)
- D5 Viewer reuses the list component (if wrong: one file)
**Flags:** none
Plan: /home/dev/.ai/sessions/2026-10-07_Wishlist-Share-Link/PLAN.md · validator 94 PASS · card 3f9a1c2
```

Question 2 is on the card because it touches a stated invariant (the forcing rule). The check time is when render last probed the remote; it is printed, never stored.

## Execution hand-off

After exit 0, hand off by the Run answer on the approved plan's Run line (a `you: ` in front of the bold marks an answer the user gave). Do not ask the execution question again; the card already did.

- **subagent-driven** — REQUIRED SUB-SKILL: use `constellation:subagent-driven-development`.
- **inline** — follow the executing-plans reference bundled with `constellation:subagent-driven-development` (its `references/executing-plans`), in this session, with no subagents.

The ONLY skills you invoke after writing-plans are plan-validator (during writing), then subagent-driven-development for either run. Do not start editing production code from this skill.

## Checklist (mirror into TodoWrite)

- [ ] Announce: "I'm using the writing-plans skill…"
- [ ] Scope check — split multi-subsystem specs into separate plans
- [ ] File-structure pass — every file + its single responsibility
- [ ] Run `git remote -v` and `git log -5` in each repo; write the plan/v3 frontmatter and `delivery` (block YAML, no inline comments) and the D-lines (`[ask]` for a one-way or conflicting choice)
- [ ] Write PLAN.md in the template's structure, in the session dir, with the executor hand-off line
- [ ] Estimate PR size; if > 1,000 lines, warn and AskUserQuestion to confirm a clean split
- [ ] Every step satisfies the Iron Law (exact path, complete code, exact command, expected output)
- [ ] Behavioral steps tagged `[RED→GREEN]`; exempt steps tagged `[exempt: ...]`
- [ ] Traceability table maps every Discovery finding to a step
- [ ] Validate: run validate_plan.py until no error is left outside the Brief
- [ ] Self-review inline: spec coverage, placeholders, Brief fidelity, consistent names
- [ ] Write the `## Brief` LAST (the six card labels, Run last, at most 120 words with the ask line)
- [ ] Render the card with card.py render; post its stdout verbatim, at most one short line before and one after
- [ ] Run card.py approve with the user's reply on stdin; act on the exit code
- [ ] Hand off by the Run answer (subagent-driven, or inline via the executing-plans reference)

## Notes

- Tool names above (`TodoWrite`, `AskUserQuestion`, `Read`, `Write`, `Edit`, `Bash`) are Claude Code; on Codex see the plugin's `skills/_shared/platform/codex-tools.md`.
- Principles to keep visible in every plan: DRY, YAGNI, TDD, frequent commits.
