# PRD Template

Use this template when creating a new PRD. Fill in each section. Sections marked **(optional)** can be omitted for smaller projects but should be included for anything with multiple milestones.

---

## Problem Statement

What problem exists? Who has it? Why does it matter now — what changed?

Write 1-3 paragraphs. Be specific about the impact: lost revenue, user churn, manual toil, compliance risk, missed opportunity.

---

## User Personas

Define 2-3 personas. For each:

### [Persona Name] — [Role]

- **Goals:**
  - [What they need to accomplish]
  - [What success looks like for them]
- **Pain Points:**
  - [What frustrates them today]
  - [What workarounds they use]

---

## Functional Requirements

List each thing the product must do. Use FR-001 format for traceability.

### FR-001: [Requirement Name]

**Description:** [What the product must do]

**Priority:** Must | Should | Could

**Acceptance Criteria:**
- [ ] [Observable, testable condition — how would you demo this?]
- [ ] [Another condition]

### FR-002: [Requirement Name]

**Description:** ...

**Priority:** ...

**Acceptance Criteria:**
- [ ] ...

> **Abstraction boundary:** PRDs describe *what* the product must do, not *how* to build it.
>
> Do NOT include in requirements:
> - **File paths** — `src/components/foo.tsx` belongs in PLAN.md
> - **Line numbers** — `(lines 8, 22)` belongs in PLAN.md
> - **"Files to change" sections** — that's implementation planning
> - **Code patterns** — hook names, event handlers, state management, type definitions
> - **Implementation instructions** — "call X before Y", "use stopPropagation()"
>
> Instead, describe observable behavior: "Tapping the heart icon on a target card toggles its favorite state without navigating away."
>
> Codebase context from discovery *informs* requirements but stays in DISCOVERY.md.

---

## Non-Functional Requirements

### NFR-001: [Category — Performance / Security / Scalability / Accessibility / Reliability]

**Description:** [What quality attribute is required]

**Measurable Target:** [e.g., "page load < 2s at P95", "99.9% uptime", "WCAG AA compliance"]

---

## Scope Boundary

### In Scope
- [What we ARE building]
- [Specific features included]

### Out of Scope
- [What we are NOT building and why]
- [Tempting features that should wait]
- [Adjacent work that belongs to another team/project]

---

## Milestones / Phases

### Milestone 1: [Name]

**Includes:** FR-001, FR-002

**Deliverable:** [What users can do when this ships — one sentence]

**Depends on:** [External dependencies or prior milestones]

### Milestone 2: [Name]

**Includes:** FR-003, FR-004

**Deliverable:** ...

**Depends on:** Milestone 1

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| [What to measure] | [Target value] | [Measurement method] |
| [e.g., task completion rate] | [e.g., > 80%] | [e.g., analytics event tracking] |

---

## Dependencies

- **[System/Team/API]:** [What we need from them, when]
- **[Data source]:** [What data is required, current availability]

---

## Open Questions

| Question | Owner | Target Date |
|----------|-------|-------------|
| [Unresolved item] | [Who will answer] | [By when] |

*If no open questions remain, state: "All questions resolved as of [date]."*
