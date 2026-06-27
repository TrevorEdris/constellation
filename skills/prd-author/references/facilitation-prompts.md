# Facilitation Prompts

Use these prompts to guide non-technical users through each section of a PRD. The prompts are written in plain language — no jargon, no engineering assumptions.

---

## Problem Statement

> Describe the problem in one sentence as if explaining to someone outside the company.
>
> Now expand on it:
> - Who has this problem? (Be specific — "users" is too broad. Which users?)
> - What happens because of this problem? (Lost time, lost money, frustration, compliance risk?)
> - Why does this matter NOW? What changed that makes this urgent?

---

## User Personas

> Who are the 2-3 types of people who will use this?
>
> For each person type, answer:
> - What is their role? (job title, or describe what they do day-to-day)
> - What do they need to accomplish with this product?
> - What frustrates them today? What workarounds do they use?
>
> Give each persona a name (can be fictional) so we can refer to them later.

---

## Functional Requirements

> List each thing the product must do.
>
> For each one:
> - Describe what the product does (not how it's built — focus on behavior the user sees)
> - How important is it? (Must have for launch / Should have / Nice to have)
> - What does "done" look like? If you were demoing this to a customer, what would you show them? What would make them say "yes, that's what I need"?
>
> Don't worry about technical details. "Users can search by name and see results within 2 seconds" is better than "implement Elasticsearch with fuzzy matching."
>
> **Do NOT include:**
> - File paths or directory structures (`src/components/...`)
> - Line numbers or code references
> - Implementation patterns (hook names, event handlers, state management)
> - "Files to change" or "Files to modify" sections
>
> These belong in PLAN.md. The PRD describes behavior the user sees, not code the engineer writes.

---

## Non-Functional Requirements

> Think about the qualities the product needs beyond its features:
>
> - **Speed:** How fast should it feel? Are there specific pages or actions that must be fast?
> - **Scale:** How many users at the same time? How much data?
> - **Security:** Any sensitive data involved? Compliance requirements (HIPAA, SOC2, GDPR)?
> - **Accessibility:** Does this need to work with screen readers? Keyboard-only users?
> - **Reliability:** What happens if it goes down? Is 99.9% uptime required?
>
> If you're not sure about numbers, describe the expectation: "should feel instant" or "must handle our entire customer base at once."

---

## Scope Boundary

> What are we explicitly NOT building? This is one of the most important sections.
>
> Think about:
> - Features that are tempting but should wait for a later version
> - Adjacent work that belongs to another team or project
> - Things stakeholders might assume are included but aren't
>
> For each exclusion, briefly say why: "Not building mobile app — web-first strategy; mobile deferred to Q3."

---

## Milestones / Phases

> If we shipped this in phases, what would the first usable version include? What would come next?
>
> For each phase:
> - What features are included? (Reference the requirement IDs from above)
> - What can users do when this phase ships? (One sentence)
> - What needs to be done before this phase can start?
>
> Think of each phase as a version a real user could try and give feedback on. Avoid phases that are only "backend work" with nothing user-visible.

---

## Success Metrics

> How will we know this worked?
>
> Think about:
> - What numbers would change? (Revenue, time spent, error rate, support tickets, adoption)
> - What would users say in a survey or interview?
> - What would we see in analytics that tells us "this is working"?
>
> For each metric, name a target: "Task completion rate > 80%" or "Support tickets for X reduced by 50%."

---

## Dependencies

> What do we need from other teams, services, or vendors before this can ship?
>
> Think about:
> - APIs or data from other teams
> - Design work that needs to happen first
> - Vendor contracts or integrations
> - Data that needs to be collected or migrated
>
> For each dependency, note who owns it and when we need it.

---

## Open Questions

> What don't we know yet? What decisions haven't been made?
>
> For each question:
> - What is the question?
> - Who needs to answer it?
> - By when do we need the answer?
>
> If there are no open questions, state that explicitly: "All questions resolved as of [date]."
