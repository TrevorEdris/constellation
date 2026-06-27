# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent. This runs
FIRST, before any code quality review.

**Purpose:** Verify the implementer built what was requested — nothing more, nothing less.

Dispatch with the `Task` tool. If launched via the `Workflow` tool, use
`agentType` Explore or omit it (never `general-purpose`), and do not force
`model: opus`. Pin the reviewer's scope to the diff:
`gh pr diff --name-only` (or `git diff --name-only BASE_SHA HEAD_SHA`).

```
Task:
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## What the Implementer Claims They Built

    [From implementer's report]

    ## Scope

    Review only the files in this change:
    [paste output of `gh pr diff --name-only` or `git diff --name-only BASE_SHA HEAD_SHA`]

    ## CRITICAL: Do Not Trust the Report

    The implementer finished suspiciously quickly. Their report may be incomplete,
    inaccurate, or optimistic. You MUST verify everything independently.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare the actual implementation to requirements line by line
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention
    - Confirm tests exercise the REAL code path, not fakes or injected state

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:** Did they implement everything requested? Skip anything?
    Claim something works but not actually implement it?

    **Extra/unneeded work:** Did they build things not requested? Over-engineer? Add
    "nice to haves" not in the spec?

    **Misunderstandings:** Did they interpret requirements differently than intended?
    Solve the wrong problem? Build the right feature the wrong way?

    **Verify by reading code, not by trusting the report.**

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
