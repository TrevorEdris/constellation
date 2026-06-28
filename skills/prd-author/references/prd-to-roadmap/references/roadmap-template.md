# ROADMAP.md Template

Unified roadmap document merging feature descriptions (product-readable) with implementation checklists (engineering-readable). Produced from an approved PRD.

---

## Structure

```markdown
# [Project Name] — Roadmap

## Current Status

**Phase:** [current phase]
**Last Updated:** [date]

### Completed
- [x] Phase 0: [name]

### In Progress
- [ ] Phase 1: [name]

---

## Philosophy

[1-2 sentences on the build approach — vertical slices, incremental delivery, etc.]

---

## Phase 0: [Name]

**Entry Criteria:** [What must be true before this phase starts]
**Exit Criteria:** [What must be true for this phase to be complete]

### P0-A: [Feature Name]

- **What:** [Plain-language description from PRD — product-readable]
- **Depends on:** [Feature IDs or "Nothing"]
- **Risk:** [Known risks, optional]
- **Note:** [Context or constraints, optional]
- **Checklist:**
  - [ ] [Implementation sub-task — engineering-readable]
  - [ ] [Another sub-task]
  - [ ] [Verification action]

### P0-B: [Feature Name]

- **What:** ...
- **Depends on:** P0-A
- **Checklist:**
  - [ ] ...

**Deliverable:** [What users can do when this phase ships — one sentence in italics]

---

## Phase 1: [Name]

**Entry Criteria:** Phase 0 complete. [Additional conditions.]
**Exit Criteria:** [Measurable outcome.]

### P1-A: [Feature Name]
...

**Deliverable:** *[Prose milestone statement]*

---

## Cross-Cutting Concerns

[Constraints that apply across all phases — technology choices, platform targets,
performance budgets, compliance requirements. Reference NFRs from the PRD.]

---

## Dependency Summary

| Dependency | Source | Status |
|-----------|--------|--------|
| [Library/API/Team] | [Where it comes from] | [Available / Pending / Blocked] |

---

## Spec Index

| ID | Name | Status | Phase | Roadmap Ref |
|----|------|--------|-------|-------------|
| [Category-001] | [Spec name] | PENDING | 1 | P1-A |
| [Category-002] | [Spec name] | DRAFT | 2 | P2-B |

Status values: **PENDING** | **DRAFT** | **REVIEW** | **FINAL**
```

---

## Feature ID Convention

Features use the format `P{phase}-{letter}`:
- `P0-A` — first feature of Phase 0
- `P1-C` — third feature of Phase 1
- `P3-A` — first feature of Phase 3

This maps cleanly to PRD requirement IDs: the roadmap translates FR-001 through FR-NNN into phased features.

---

## Audience Guide

| Section | Product reads? | Engineering reads? |
|---------|---------------|-------------------|
| Current Status | Yes | Yes |
| Philosophy | Yes | Yes |
| Phase overview (entry/exit criteria) | Yes | Yes |
| Feature — What / Depends on / Risk | Yes | Yes |
| Feature — Checklist | No (implementation detail) | Yes |
| Deliverable statement | Yes | Yes |
| Cross-Cutting Concerns | Sometimes | Yes |
| Dependency Summary | Yes | Yes |
| Spec Index | Sometimes | Yes |
