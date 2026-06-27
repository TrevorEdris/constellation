# PRD Iteration Guide

PRDs are living documents. Use this guide when updating an existing PRD based on stakeholder feedback, engineering input, or scope changes.

---

## Iteration Modes

### Add Requirements

1. Append new requirements with the next sequential ID (e.g., if last is FR-007, add FR-008)
2. Mark new requirements with `[ADDED]` until the next validation pass
3. Assign to an existing milestone or create a new one
4. Re-assess milestone dependencies if the new requirement introduces new constraints

### Revise Scope

1. Move items between In Scope and Out of Scope
2. Add rationale for each change: "Moved to out-of-scope because [reason]"
3. If a previously in-scope requirement is removed, keep the ID gap (do not renumber)
4. Update milestones to reflect removed or added scope

### Reprioritize

1. Change Must/Should/Could on existing requirements
2. If a Must becomes Could, check whether any milestone's deliverable statement changes
3. If a Could becomes Must, verify it's assigned to a milestone with the right dependencies

### Respond to Engineering Feedback

Common feedback types and how to handle them:

| Feedback | Action |
|----------|--------|
| "This requirement is too vague" | Add or sharpen acceptance criteria |
| "This has a technical constraint you didn't consider" | Add an NFR or update an existing one |
| "This depends on X which doesn't exist yet" | Add to Dependencies section |
| "This is actually two separate features" | Split into two requirements with new IDs |
| "This conflicts with requirement Y" | Resolve the conflict; update one or both |
| "This can't be done in the timeline" | Reprioritize or move to a later milestone |

### Split / Merge Requirements

**Splitting:** When a requirement is too large for a single milestone:
1. Create two new IDs (FR-008, FR-009) with specific scope
2. Mark the original as `[SPLIT into FR-008, FR-009]`
3. Redistribute acceptance criteria between the new requirements

**Merging:** When two requirements are redundant:
1. Keep the lower-numbered ID, update its description to cover both
2. Mark the higher-numbered ID as `[MERGED into FR-00X]`
3. Combine acceptance criteria

---

## Change Tracking

Mark changes until the next validation pass clears them:

- `[ADDED]` — new requirement, persona, dependency, or milestone
- `[MODIFIED]` — changed description, acceptance criteria, priority, or scope
- `[REMOVED]` — deleted item (keep the ID, add a note why)
- `[SPLIT into FR-XXX, FR-YYY]` — requirement split into multiple
- `[MERGED into FR-XXX]` — requirement absorbed into another

After running `constellation:prd-validator` and confirming PASS, remove the markers.

---

## Re-validation

Always re-run `constellation:prd-validator` after any iteration. If the PRD previously passed and now fails, the iteration introduced a gap — address it before handing off.
