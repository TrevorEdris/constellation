# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify the implementation is well-built (clean, tested, maintainable).

**Only dispatch after spec compliance review passes (✅).**

Dispatch with the `Task` tool. If launched via the `Workflow` tool, use
`agentType` Explore or omit it (never `general-purpose`), and do not force
`model: opus`. Pin the reviewer's scope to the diff via `BASE_SHA`/`HEAD_SHA`
below or `gh pr diff --name-only`.

```
Task:
  Use the constellation:requesting-code-review template (REQUIRED SUB-SKILL).

  WHAT_WAS_IMPLEMENTED: [from implementer's report]
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  BASE_SHA: [commit before task]
  HEAD_SHA: [current commit]
  DESCRIPTION: [task summary]
```

**In addition to standard code quality concerns, the reviewer should check:**
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Does the implementation follow the file structure from the plan?
- Did this change create files that are already large, or significantly grow
  existing files? (Don't flag pre-existing file sizes — focus on what this change added.)
- Do tests drive the REAL code path? (No fakes/injected state standing in for the
  behavior under test — false-green countermeasure.)

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment.
