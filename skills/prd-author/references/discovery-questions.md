# Discovery Questions

Ask these questions BEFORE writing any PRD sections. The goal is to surface assumptions, constraints, and scope boundaries upfront — preventing PRDs that answer the wrong question.

These questions are inspired by the Question phase of the QRSPI workflow (Question → Research → Structure → Plan → Implement). For Product, the equivalent is: Question → Author → Validate → Handoff.

---

## Core Questions

Present these to the user before writing any requirements. Don't skip them — the answers shape every section of the PRD.

### 1. The Problem

> "What problem are we solving? Describe it without mentioning any solution."
>
> Follow-up if the answer includes a solution: "That sounds like a solution. What's the problem it solves? What pain exists if we build nothing?"

### 2. The Stakes

> "What happens if we don't solve this? Who is affected, and how much does it cost them (time, money, frustration, risk)?"

### 3. Prior Art

> "What has been tried before? Why didn't it work? What can we learn from the attempt?"
>
> This prevents repeating failed approaches and surfaces constraints the user may have forgotten.

### 4. Stakeholders

> "Who are the stakeholders? Who has input? Who has veto power? Who will be surprised if they aren't consulted?"

### 5. Constraints

> "What constraints exist that will shape the solution?"
>
> Prompt for each:
> - **Timeline:** Is there a hard deadline? What drives it?
> - **Budget:** Is there a spending limit (infrastructure, vendor, headcount)?
> - **Team:** Who will build this? What skills do they have? What are they already working on?
> - **Technology:** Are there tech stack requirements or restrictions?
> - **Compliance:** Any regulatory requirements (HIPAA, SOC2, GDPR, accessibility)?

### 6. Success Definition

> "If this ships and works perfectly, what changes? What do you see in 6 months that you don't see today?"
>
> Push for specifics: "Users are happier" → "What would they say in a survey? What number would change?"

### 7. Non-Goals

> "What are we explicitly NOT trying to achieve? What should we resist even if it seems tempting?"
>
> This directly feeds the Scope Boundary section and prevents scope creep during authoring.

### 8. Existing Context

> "Is there existing code, an existing product, or an existing process that this relates to? Should we reverse-engineer requirements from what exists before writing new ones?"
>
> If yes, suggest running `constellation:reverse-engineer (discover mode)` before authoring the PRD.

---

## How to Use the Answers

| Question | Feeds PRD Section |
|----------|-------------------|
| 1. The Problem | Problem Statement |
| 2. The Stakes | Problem Statement (impact), Success Metrics |
| 3. Prior Art | Problem Statement (context), Open Questions |
| 4. Stakeholders | User Personas, Dependencies |
| 5. Constraints | Non-Functional Requirements, Dependencies, Scope Boundary |
| 6. Success Definition | Success Metrics, Milestone deliverables |
| 7. Non-Goals | Scope Boundary (out-of-scope) |
| 8. Existing Context | Triggers constellation:reverse-engineer if applicable |

---

## When to Skip

- If the user has already documented answers to these questions (e.g., in a brief, a Slack thread, or a prior PRD), reference the existing answers rather than re-asking.
- If iterating on an existing PRD (iterate mode), skip discovery — the questions were already answered in the original authoring session.
