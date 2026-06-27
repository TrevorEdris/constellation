# Design Prompts

Facilitation templates for the brainstorm skill. Reference during each step.

---

## Assumption Surfacing

Templates for identifying hidden assumptions:

- "We're assuming [X] is true. If it's not, the entire approach changes because..."
- "This design requires [Y] to be stable. Has [Y] changed before? Could it change?"
- "We're treating [Z] as a solved problem. What would happen if it wasn't?"
- "The performance requirement assumes [N] users/requests. Is that number validated?"

**Assumption risk levels:**
- **HIGH** — If wrong, the solution doesn't work or causes data loss / regression
- **MEDIUM** — If wrong, the solution works but requires rework
- **LOW** — If wrong, a minor adjustment is needed

---

## Alternative Generation Prompts

When stuck on generating alternatives:

- "What would the simplest possible version look like? (Even if it doesn't scale)"
- "What would a senior engineer with 10x more time build? (Even if it's complex)"
- "What has worked for similar problems in other codebases/ecosystems?"
- "What would we build if we could break backwards compatibility?"
- "What would we build if we had to ship in 1 day vs. 1 month?"
- "What is the off-the-shelf solution? Why aren't we using it?"

---

## Trade-off Matrix Template

| | Option A | Option B | Option C |
|---|---|---|---|
| **Complexity** | Low / Med / High | | |
| **Reversibility** | Easy / Hard | | |
| **Performance** | Meets req / Marginal / Miss | | |
| **Consistency** | Strong / Eventual / None | | |
| **Time to ship** | Days / Weeks / Months | | |
| **Test surface** | Easy / Moderate / Hard | | |
| **Key advantage** | | | |
| **Key weakness** | | | |

Fill in, then circle the option with the best fit for the primary constraint.

---

## Decision Forcing Questions

When the team is stuck between options:

- "If we had to make this decision right now with no more information, which would we pick?"
- "Which option are we least likely to regret in 12 months?"
- "Which option is easiest to walk back if we're wrong?"
- "Which option do we understand well enough to test in a spike?"
- "What new information would change our answer? Can we get that information cheaply?"

---

## Recommendation Format

State the recommendation directly:

> "I recommend **[Option B]** because [primary reason]. The main trade-off is [cost/risk], which is acceptable because [justification]. If [condition] changes, revisit [Option A/C]."

Do NOT hedge. If genuinely uncertain between two options, say so and state what would break the tie.
