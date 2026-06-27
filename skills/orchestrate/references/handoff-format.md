# Agent Handoff Format

Defines the structured context block passed from the orchestrator to each subagent via the `Task` tool, and the expected output contract from each subagent back to the orchestrator.

Consistent handoffs are the primary mechanism for passing context across isolated subagent executions. Subagents do not share state — everything they need must be in the handoff.

---

## Context Block (passed to each subagent via Task tool)

Construct this block for every `Task` invocation. Include all applicable sections.

### Task Context

```
TASK ID: T3
TASK TITLE: Update auth module documentation

DESCRIPTION:
Update docs/auth.md to reflect the current implementation of the authentication
module in src/auth/. The documentation currently describes the v1 API; the codebase
has been updated to v2 with breaking changes in session handling and token expiry.

FILES IN SCOPE:
- docs/auth.md                 (primary file to update)
- src/auth/session.go          (reference — do not modify)
- src/auth/tokens.go           (reference — do not modify)
- src/auth/middleware.go       (reference — do not modify)

ACCEPTANCE CRITERIA:
- docs/auth.md reflects the v2 API (session.New, token.Refresh signatures)
- All code examples are correct and runnable
- Deprecated v1 functions are clearly marked or removed
- Known issues surfaced in T1 (code review) and T2 (security audit) are noted where relevant
```

### Upstream Context

Include a summary of each completed dependency's output. This is the primary mechanism for chaining agent work.

```
UPSTREAM CONTEXT:

[T1 — Code Review: pragmatic-code-review — completed]
Summary: Auth module has solid structure but 3 issues require attention before docs are updated.
Key findings:
- session.New() silently ignores the MaxAge parameter when value is 0 (HIGH)
- token.Refresh() does not validate the incoming token before issuing a new one (CRITICAL)
- middleware.Require() has undocumented behavior when Authorization header is malformed (MEDIUM)
Files reviewed: src/auth/session.go, src/auth/tokens.go, src/auth/middleware.go

[T2 — Security Audit: security-review — completed]
Summary: One high-confidence vulnerability found; medium finding noted.
Key findings:
- token.Refresh() accepts expired tokens if the clock skew window exceeds 60s (high, confidence 0.9)
- Session IDs generated with math/rand instead of crypto/rand (medium, confidence 0.85)
Files reviewed: src/auth/session.go, src/auth/tokens.go
```

### Environment

```
REPOSITORY ROOT: /Users/user/project
CURRENT BRANCH: feature/auth-v2
RELEVANT CONFIG:
- Go 1.22
- No linter config enforced for docs
```

---

## Output Contract (expected from each subagent)

Every subagent invoked by the orchestrator should return output structured according to this contract. The orchestrator uses these fields to validate acceptance criteria, propagate context, and populate the final report.

### Required Fields

**Status**
One of: `completed` / `failed` / `partial`
- `completed`: Acceptance criteria fully met
- `partial`: Some criteria met; document what was and was not completed
- `failed`: Could not make meaningful progress; document why

**Summary**
1-3 sentences describing what was done. Written for a technical audience who will read many of these summaries in sequence.

**Files Modified**
Explicit list of file paths that were created or changed. If no files were modified, state that explicitly.

**Key Decisions**
Any architectural, design, or scope decisions made during execution that downstream tasks should know about.

**Issues Found**
Problems encountered during the subtask, even if resolved. Include both resolved and unresolved issues.

**Unresolved Items**
Anything the agent could not complete within this subtask, with enough context for the orchestrator to decide whether to retry, skip, or halt.

### Optional Fields

**Recommendations**
Suggestions for downstream subtasks or the overall orchestration. Examples:
- "T4 (diagram generation) should be scoped to the auth flow only; the full system diagram will be too large"
- "The security finding in T2 may require a code change before docs are updated"

**Warnings**
Potential risks the orchestrator should track across the full orchestration. Examples:
- "The token.Refresh() fix in T2 is a breaking change — downstream tasks should assume the API contract will change"

---

## Handoff Assembly Checklist

Before invoking a subagent via `Task`, verify:

- [ ] Task ID and title included
- [ ] Full description with acceptance criteria
- [ ] All in-scope file paths listed explicitly
- [ ] Constraints and preferences stated
- [ ] Upstream context included for each completed dependency
- [ ] Environment details included (branch, repo root, relevant config)
- [ ] Agent name and capability match the subtask domain

A sparse handoff is the most common cause of subagent failure. When in doubt, include more context.
