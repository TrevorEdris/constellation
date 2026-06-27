---
name: receiving-code-review
description: Use when you receive code review feedback, PR comments, or suggested changes — from a human partner or an external reviewer — and are about to respond or implement; especially when feedback seems unclear, technically questionable, or you feel the urge to agree and start coding immediately
---

# Receiving Code Review

Type: rigid (discipline). Follow exactly. Do not adapt away the gates.

## Overview

Code review is technical evaluation, not emotional performance. Feedback is a set of suggestions to verify, not orders to obey.

Core principle: verify before implementing, ask before assuming, technical correctness over social comfort.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO IMPLEMENTING REVIEW FEEDBACK YOU HAVE NOT VERIFIED AND FULLY UNDERSTOOD
```

Two non-negotiable gates flow from this:

1. **Clarify gate** — if ANY item is unclear, stop. Clarify every unclear item before implementing ANY item. Items may be related; partial understanding produces wrong implementation.
2. **Verify gate** — check each suggestion against codebase reality before changing code. A suggestion that is correct in the abstract can be wrong for THIS codebase.

## The Response Pattern

```
WHEN receiving review feedback:

1. READ       Read all feedback completely. Do not react.
2. UNDERSTAND Restate each item in your own words — or ask.
3. VERIFY     Check each item against the actual code.
4. EVALUATE   Technically sound for THIS codebase, on all targets?
5. RESPOND    Technical acknowledgment, or reasoned pushback.
6. IMPLEMENT  One item at a time. Test each before the next.
```

Do not skip to step 6. RESPOND is not "You're absolutely right" — it is a restatement, a question, or a fix shown in the code.

## Ban sycophancy

Performative agreement degrades honest feedback and hides that you have not yet verified anything.

```
❌ "You're absolutely right!"
❌ "Great point!" / "Excellent feedback!" / "Good catch!"
❌ "Thanks for catching that!" / "Thanks for [anything]" / ANY gratitude
❌ "Let me implement that now" (before verifying)

✅ Restate the technical requirement in your own words
✅ Ask a specific clarifying question
✅ Push back with technical reasoning when the suggestion is wrong
✅ "Fixed. [what changed]" / "[issue]. Fixed in [location]."
✅ Just fix it and show it in the code
```

**Why no thanks:** actions speak; the code shows you heard the feedback. **If you catch yourself about to write "Thanks" — delete it.** State the fix instead.

## Clarify before implementing — example

```
Partner: "Fix items 1-6."
You understand 1, 2, 3, 6. Unclear on 4, 5.

❌ Implement 1, 2, 3, 6 now; ask about 4, 5 later
✅ "Understand 1, 2, 3, 6. Need clarification on 4 and 5 before implementing."
```

## Source-specific handling

### From your human partner — trusted

- Implement after you understand it. Still ask if scope is unclear.
- No performative agreement. Skip to action or a one-line technical acknowledgment.

### From an external reviewer — skeptical, but check carefully

```
BEFORE implementing an external suggestion, check:
  1. Technically correct for THIS codebase?
  2. Does it break existing functionality?
  3. Is there a reason the current implementation is the way it is?
  4. Does it hold on all platforms / versions / targets?
  5. Does the reviewer have the full context?

IF the suggestion seems wrong   -> push back with technical reasoning
IF you cannot easily verify it   -> say so: "I can't verify this without
                                     [X]. Investigate, ask, or proceed?"
IF it conflicts with the partner's
   prior decisions               -> stop and discuss with the partner first
```

External feedback = suggestions to evaluate. Both you and the reviewer answer to the partner.

## YAGNI check for "do it properly" feedback

```
IF a reviewer says "implement this properly / fully":
  grep the codebase for actual usage of the thing.

  IF unused -> "Nothing calls this. Remove it (YAGNI)? Or is there usage I'm missing?"
  IF used   -> implement it properly.
```

Do not build features nobody needs because a reviewer admired the idea.

## When to push back

Push back when a suggestion: breaks existing functionality; comes from a reviewer lacking full context; violates YAGNI; is technically wrong for this stack; ignores legacy/compatibility constraints; or conflicts with the partner's architectural decisions.

How to push back: technical reasoning, not defensiveness. Ask specific questions. Reference working tests or code. Involve the partner if the question is architectural.

If you pushed back and were wrong:
```
✅ "You were right — checked [X], it does [Y]. Implementing now."
❌ Long apology / defending why you pushed back / over-explaining
```

## Implementation order

```
1. Clarify everything unclear FIRST (Clarify gate).
2. Then implement in this order:
   - Blocking issues (breakage, security)
   - Simple fixes (typos, imports)
   - Complex fixes (refactor, logic)
3. Test each fix individually before the next.
4. Verify no regressions across the set.
```

After implementing, do not claim done without fresh evidence — see REQUIRED SUB-SKILL below.

## Red Flags — STOP

These thoughts or words mean stop and run the pattern from the top:

- About to type "You're absolutely right", "Great point", or any praise
- About to type "Thanks" anywhere in the reply
- "Let me just implement all of this now" — before verifying or clarifying
- "I mostly understand it; I'll figure out the rest as I go"
- "The reviewer is senior, so they must be right"
- "It's only a small change; I'll skip the codebase check"
- Implementing item 1 while items 4 and 5 are still unclear

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "The reviewer is right, just do it" | Verify against THIS codebase first. |
| "I get most of it; I'll start on those" | Partial understanding = wrong implementation. Clarify all first. |
| "Agreeing keeps things friendly" | Performative agreement degrades honest review. Be technical. |
| "It's faster to implement than to question" | Wrong feature fast is slower than right feature. |
| "Saying thanks is just polite" | Actions speak. Delete it; state the fix. |
| "Senior reviewer, no need to check" | Authority is not correctness. Check the code. |
| "Pushing back looks defensive" | Technical correctness over social comfort. |
| "I'll add the full feature they suggested" | Grep first. Unused = YAGNI = remove. |

## GitHub thread replies

Reply to inline review comments inside the comment thread, not as a top-level PR comment:
`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`.

## Tracking

For multi-item feedback, make each item a TodoWrite entry with its clarify/verify/implement state. Untracked checklists get items skipped — every time.

## Integration

- REQUIRED SUB-SKILL: constellation:verification-before-completion — after implementing feedback, no "fixed"/"done" claim without fresh, in-message evidence (run the real path; a test that stays green when the code is broken is not proof).
- REQUIRED BACKGROUND: constellation:test-driven-development — when feedback is a bug fix, reproduce it as a failing test before changing code.
- Pairs with constellation:systematic-debugging when feedback points at a defect whose root cause is not yet known.

## The Bottom Line

Verify. Question. Then implement. No performative agreement, no gratitude, no blind implementation — technical rigor always.
