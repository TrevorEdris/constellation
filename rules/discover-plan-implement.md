---
description: Enforce Question → Research → Structure → Plan → Implement workflow with
  explicit gates.
paths:
- '**/*'
---

## Effort-Scaled Execution

Scale how these phases run to the configured effort level:

- **Low effort** — phases may be compressed with the user's consent (for example,
  Question and Structure folded together). Keep the gates; shorten the ceremony.
- **Medium / High effort** — run the full workflow inline in the conversation, one
  agent doing every phase. This is the default.
- **Ultracode effort** — if the `make-no-mistakes` skill is available (Claude Code
  only), execute this workflow through it. That skill runs each phase with a
  dedicated agent — a researcher for Research, a planner for Plan, an adversarial
  critic on the plan, an implementer for each phase, and code reviewers — with the
  same gates defined below. If the skill is not available, run the full workflow
  inline as in High effort.

The phase definitions, outputs, and gates below apply regardless of effort level.

## Workflow Phases

### 1) Question

**Goal:** Surface design decisions as explicit choices before any research begins.

- Do NOT read code yet — work only from the user's description
- Identify every decision point that will shape the solution
- Present numbered options for each design decision:
  - "What approaches exist for X? (1) [option] (2) [option] (3) [option]"
  - "Which trade-off matters for Y? (a) performance (b) simplicity (c) consistency"
- Ask clarifying questions about scope, constraints, and non-goals
- Record confirmed answers as the research frame

**Outputs:**
- Explicit design questions with numbered alternatives
- Confirmed scope boundaries (in-scope / out-of-scope)
- Research target list — the specific questions code reading must answer

**Gate:** Do not proceed to Research until design questions are answered or scoped out.

---

### 2) Research

**Goal:** Targeted investigation to answer each question from phase 1. No broad exploration.

- Map each research question to specific files and code paths to read
- Read only what is needed to answer the identified questions
- For each question, provide an answer with code evidence (file:line references)
- Capture findings in `DISCOVERY.md`:
  - Current state analysis
  - Gaps, constraints, or risks identified
  - Data model and API coverage analysis
- Work through the prompts in `references/discovery-prompts.md`
- Skip discovery questions already answered in phase 1

**Outputs:**
- `DISCOVERY.md` — technical analysis, each question answered with evidence
- Code path inventory with file references
- Constraint list (what cannot change)

**Gate:** Every question from phase 1 must be answered or explicitly deferred with rationale.

---

### 3) Structure

**Goal:** Phased breakdown of what gets built in what order. NOT implementation details.

- Decompose the work into phases (P1, P2, P3…)
- For each phase, identify:
  - What capability it delivers
  - What it depends on (dependency graph)
  - What it enables for later phases
- Identify the critical path — which phase must land first to unblock others
- Do NOT write implementation steps yet — structure is about sequence and dependencies
- Surface risks: what could cause a phase to fail or expand in scope

**Outputs:**
- Phase breakdown with dependency graph
- Critical path identified
- Risk register per phase (likelihood × impact)
- Draft structure section in `PLAN.md`

**Gate:** Structure must be reviewed before detailed planning begins.

---

### 4) Plan

**Goal:** Produce a concrete, granular implementation plan ready for approval.

- Each step must be executable in 2–5 minutes by a focused agent
- Create `PLAN.md` with:
  - **Target repos and file paths** — explicit list of every file to be touched
  - **Structure** — phase breakdown from phase 3
  - **Ordered implementation steps** — granular, atomic steps with exact file paths
  - **Risks and assumptions** — what could go wrong, what we're assuming
  - **Verification steps** — how to confirm each step is correct (test/lint/build/manual check)
  - **Traceability** — map each discovery finding to a plan step
  - **Git strategy** — branch name, commit checkpoints with messages, anticipated PR title and description. Check for `.github/PULL_REQUEST_TEMPLATE.md` and structure the PR description to match it.

Each step that introduces new behavior must be structured as RED-GREEN:
1. Write failing test for the desired behavior
2. Confirm it fails for the right reason (missing behavior, not a syntax error)
3. Write minimal production code to pass
4. Confirm GREEN — full suite passes

Steps that are config, docs, generated code, or infrastructure are exempt (per `tdd-enforcement.md`).

Include a traceability table:

| Discovery Finding | Plan Step | Notes |
|-------------------|-----------|-------|
| [finding from DISCOVERY.md] | Step N | |

If a finding has no plan step, state why it is out of scope.

#### Plan Quality Principles

- **Be extremely accurate** — verify every claim by reading actual code. No guessing.
- **Proactively recommend improvements** — suggest optimizations the user didn't request.
- **Call out misconceptions** — correct incorrect assumptions explicitly.
- **Tell the user when they're wrong** — flawed approaches must be challenged, not accommodated.

#### Plan Validation (Gate)

After writing PLAN.md, automatically run `/plan-validator`:
1. Run `/plan-validator <session-dir>/PLAN.md`
2. If score < 70 (NEEDS WORK): fix all errors and warnings, then re-run. Repeat until PASS.
3. If score >= 70 (PASS): include the score when presenting the plan.
4. Do NOT present the plan to the user until it scores PASS (>= 70).

#### Approval Gate

- Present the plan clearly
- **Wait for explicit user approval** before implementing
- Iterate on the plan based on feedback; re-confirm after significant changes

---

### 5) Implement

**Goal:** Execute the plan with minimal, traceable diffs.

- Do NOT modify code until the user explicitly approves the plan
- Execute one step at a time; confirm GREEN before moving to the next
- Keep diffs minimal and traceable to plan steps
- Update `SESSION.md` as work progresses

For each step that adds or changes behavior, follow RED-GREEN-REFACTOR:
1. **RED** — Write the failing test. Run it. Confirm the failure message matches the missing behavior.
2. **GREEN** — Write the minimal production code to make it pass. Run the full suite.
3. **REFACTOR** — Clean up without adding behavior. Confirm the suite stays green.

Steps that are config, docs, generated code, or infrastructure skip RED-GREEN and go straight to verification (lint/build/manual check).

#### Phase-Boundary After-Action

At the end of each phase in a multi-phase plan, pause for a brief after-action:
1. What succeeded as planned?
2. What deviated and why?
3. What carries forward into the next phase?

Record answers in `SESSION.md` before continuing.

#### Post-Implementation

After all steps are complete, before committing:
- Run the full test suite as a final confirmation — this is distinct from the per-step GREEN checks
- Verify each repository independently (tests/build/lint)
- Suggest: "Consider running `/code-review` to validate changes against requirements before committing."

---

## Common Pitfalls

**NEVER:**
- Skip phase 1 — jumping straight to code reading misses design decisions
- Research broadly without a question list — unfocused reading wastes tokens
- Write implementation steps before structure is agreed — steps without sequence produce unmergeable work
- Start implementing without an approved plan
- Present a vague plan with "update the config" steps
- Stay silent on flawed approaches — speak up
- Make code changes on `main`/`master` without explicit user consent
- Write production code before a failing test exists for any behavioral step
- Present a plan that has not passed `/plan-validator` (score >= 70)

**ALWAYS:**
- Surface design decisions before reading code
- Answer each phase-1 question with code evidence
- Define structure (phases + dependencies) before detailing steps
- Verify every claim by reading actual code — no guessing
- Give every step an exact file path and a verification action
- Call out misconceptions directly
- Wait for explicit approval before implementing
- Apply RED-GREEN-REFACTOR to each behavioral implementation step — RED confirmation is the gate before writing production code
- Run after-action reviews at phase boundaries
- Suggest self-review before committing
- Include a Git Strategy section in every PLAN.md (branch, commit checkpoints, PR description)
- Run `/plan-validator` and achieve PASS (>= 70) before presenting any plan

---
*Do not push to main without approval.*
