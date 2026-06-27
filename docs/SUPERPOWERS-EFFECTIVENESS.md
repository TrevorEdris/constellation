# What Makes Superpowers Skills Effective — A Distillation for Skill-Improvement Agents

**Audience:** agents tasked with upgrading fotw-derived skills before they are propagated into `constellation`.
**Purpose:** apply these mechanisms to each merged skill so it triggers reliably and changes behavior under pressure.
**Source:** teardown of all 14 superpowers skills + its meta-quality layer (writing-skills, testing-skills-with-subagents, persuasion-principles, anthropic-best-practices, CREATION-LOG).

---

## The core thesis

Superpowers skills are effective for one reason: **they are engineered to defeat the specific ways an LLM rationalizes its way out of doing the disciplined thing.** Every other plugin documents *what* a good process is. Superpowers documents *what the agent will tell itself to skip the process*, then forecloses each escape. The content is not invented — it is harvested by running the task without the skill (RED), watching the agent fail, recording its exact excuses, and refuting them (GREEN). The library dogfoods TDD-for-skills.

Treat the rest of this document as a transform to apply to each skill, not as background reading.

---

## The 15 mechanisms (apply the ones that fit each skill's type)

1. **Always-injected bootstrap.** One meta-skill (`using-superpowers`) is injected verbatim at every `startup|clear|compact` via a SessionStart hook, wrapped in maximal authority ("You have superpowers"). The skill that tells the agent to use skills never depends on discovery — everything cascades from it. A `<SUBAGENT-STOP>` keeps it out of subagent context.

2. **The 1% rule removes discretion.** "If you think there is even a 1% chance a skill might apply… you ABSOLUTELY MUST invoke the skill. YOU DO NOT HAVE A CHOICE." Paired with a cheap escape ("if it turns out wrong, you don't need to use it"), this converts a judgment call the agent fails into a mechanical check it passes.

3. **Description = WHEN, never WHAT.** The frontmatter `description` carries *triggering conditions only*, never a workflow summary. Proven failure: a description saying "code review between tasks" made Claude do ONE review when the body's flowchart showed TWO. Stripping the summary forces the agent into the body where the gates live. **This is the single highest-leverage fix.**

4. **Rationalization tables harvested from real failures.** Every discipline skill has an `Excuse | Reality` table built from observed baseline excuses, verbatim. Seeing your own justification ("I'll just add this one quick fix") listed as a known failure creates cognitive friction at the decision moment. Invented excuses miss the real loopholes.

5. **Spirit-vs-letter pre-emption.** One line in every discipline skill — *"Violating the letter of the rules is violating the spirit of the rules."* — closes the entire "I'm honoring the intent while skipping the mechanics" class of rationalization at once.

6. **One Iron Law per discipline skill.** A single absolute bright-line rule in a fenced code block: `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`, `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`, `NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE`. Removes the "is this an exception?" question; the code block makes it unmissable and quotable.

7. **Verification gate tied to fresh in-message evidence.** "If you haven't run the verification command in THIS message, you cannot claim it passes." A `Claim | Requires | Not-Sufficient` table enumerates what counts as proof for each claim type. Red flags catch the *wording* ("Great!", "Perfect!", "should work") and extend to paraphrases, not just exact phrases.

8. **Subagents get constructed context, never session history.** The controller pastes the full task text into the prompt ("[FULL TEXT of task — paste it here, don't make subagent read file]"). Isolation prevents pollution, preserves the controller's budget, and lets reviewers judge the *work product* rather than the reasoning that produced it.

9. **Adversarial reviewers instructed to distrust the report.** "The implementer finished suspiciously quickly. Their report may be optimistic. You MUST verify everything independently. Read the actual code, compare to requirements line by line." This is what catches false-green completions — the dominant failure mode.

10. **Two-stage review with enforced order.** Spec-compliance FIRST (did you build the right thing?), code-quality SECOND (did you build it right?). Quality review is forbidden before spec passes, preventing polishing the wrong feature.

11. **Bounded loops with a hard cap + human escape.** Review/fix loops run "max 3 iterations, then surface to human." Debugging has a Three-Fix Limit that reframes persistent failure as *wrong architecture*, not a failed hypothesis. Convergence without thrashing.

12. **Research-backed persuasion, calibrated.** LLMs are "parahuman" — they respond to persuasion patterns in training data (Meincke et al. 2025, N=28,000: compliance 33%→72%). Discipline skills use **Authority + Commitment + Social Proof** and explicitly **ban Liking + Reciprocity** (no "thanks", no "you're absolutely right") because those induce sycophancy and degrade honest feedback.

13. **Announce + checklist-to-TodoWrite as commitment devices.** Mandatory "Using [skill] to [purpose]" announcement; every checklist item becomes a tracked todo. "Checklists without TodoWrite tracking = steps get skipped. Every time." Public commitment makes omissions visible.

14. **Flowcharts only at non-obvious branches/loops.** Graphviz digraphs are reserved for decision points where the agent's default diverges (stopping a loop early, wrong A-vs-B, skipping a gate). Terminal states use `[shape=doublecircle]` so the agent knows when it is genuinely done. Never flowchart linear instructions or code.

15. **Ruthless brevity + imperative voice.** "The context window is a public good. Default assumption: Claude is already very smart. Only add context Claude doesn't already have." Word-count targets: getting-started <150 words, frequently-loaded skills <200. Commanding voice ("Delete it. Start over.") reads as a rule; suggestions get skimmed.

---

## Structural patterns (the shape of a good SKILL.md)

- Frontmatter: `name` + `description` only, third person, `description` starts with "Use when…" and carries triggering conditions/symptoms (≤~500 chars, max 1024).
- One-line Overview stating the core principle in a single sentence.
- Discipline skills: Iron Law in a fenced block near top, then immediately forbid named workarounds ("Don't keep it as reference. Delete means delete.").
- "When to Use" / "When NOT to use" listing concrete symptoms, calling out high-temptation cases ("Use this ESPECIALLY when under time pressure / manager wants it NOW").
- `Excuse | Reality` table + a Red Flags "STOP and start over" list — both harvested from baseline testing.
- Quick-Reference tables (`Claim|Requires|Not-Sufficient`; `Phase|Activities|Success-Criteria`); Common Mistakes paired with their fix.
- Concrete ✅/❌ (Good/Bad) pairs showing the exact shape of compliance vs violation — never prose description of it.
- Checklists explicitly tied to TodoWrite.
- Small flowcharts only at genuine branch/loop points; semantic node sentences, doublecircle terminals.
- Integration section naming upstream ("Called by"), downstream ("Pairs with"), and "REQUIRED SUB-SKILL" dependencies — turning isolated skills into a pipeline.
- Heavy reference / reusable tools / subagent prompt templates in sibling files one level deep, loaded on demand (progressive disclosure).
- Subagent prompts externalized as fill-in-the-blank templates with a fixed report/status format.
- ONE complete runnable example in a single language — never multi-language dilution or skeletons.
- Standardized status/severity protocols: `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`; `Critical / Important / Minor`.

---

## Rigid vs Flexible — calibrate degrees of freedom

The system labels every skill and tells the agent how to treat it:

- **Rigid / discipline** (TDD, systematic-debugging, verification): "Follow exactly. Don't adapt away discipline." Gets the full arsenal — Iron Law, spirit-vs-letter, rationalization tables, red flags, Authority+Commitment+Social-Proof. Their entire value is resisting rationalization under pressure.
- **Flexible / pattern** (design heuristics, root-cause-tracing): "Adapt principles to context." High degrees of freedom, moderate Authority + Unity, trust the agent's judgment.

Match specificity to fragility: a *narrow bridge with cliffs* (DB migration → low freedom, exact script, "do not modify the command") vs an *open field* (code review → high freedom, general direction). Over-rigidifying a judgment task wastes the model's reasoning; under-constraining a discipline task lets it rationalize an escape.

---

## Meta-infrastructure that makes the library cohere

- SessionStart hook injects the router; `run-hook.cmd` is a cross-platform polyglot; emits platform-specific JSON to avoid double-injection.
- Explicit instruction priority: **User (CLAUDE.md/AGENTS.md) > Skills > Default system prompt.** Skills never override the human.
- Cross-link by skill NAME with `REQUIRED SUB-SKILL` / `REQUIRED BACKGROUND` markers — deliberately NOT @-links ("@ force-loads files immediately, consuming 200k+ context before you need them").
- References kept one level deep (avoids partial `head -100` reads of nested files).
- Explicit workflow chain with named hand-offs and *forbidden transitions* ("The ONLY skill you invoke after brainstorming is writing-plans").
- A meta-quality layer governs all skills: writing-skills (authoring-as-TDD), testing-skills-with-subagents (pressure scenarios), persuasion-principles, anthropic-best-practices, CREATION-LOG (worked bulletproofing example).

---

## The transform to apply to each fotw-derived skill (actionable checklist)

For every skill being merged into constellation, an improvement agent MUST:

1. [ ] Rewrite `description` to triggering-conditions only — strip any workflow summary. (highest leverage)
2. [ ] Classify the skill **rigid** or **flexible**; apply the matching treatment below.
3. [ ] (rigid) Add ONE Iron Law in a fenced code block; forbid the named workarounds.
4. [ ] (rigid) Add the line "Violating the letter of the rules is violating the spirit of the rules."
5. [ ] (rigid) Add an `Excuse | Reality` table — harvest excuses by running the task without the skill (RED baseline), not by inventing them.
6. [ ] (rigid) Add a Red Flags "STOP" list of the agent's own pre-violation thoughts.
7. [ ] Add/confirm a verification gate where completion is claimed: no success claim without a command run in THIS message; ban the wording.
8. [ ] Tie every checklist to TodoWrite; add the "Using [skill] to [purpose]" announce step.
9. [ ] (rigid) Use Authority + Commitment + Social Proof; remove Liking/Reciprocity (delete any "thanks"/"you're absolutely right").
10. [ ] Replace prose descriptions of right/wrong with concrete ✅/❌ pairs.
11. [ ] Add flowcharts ONLY at real branches/loops; doublecircle the terminal; delete decorative ones.
12. [ ] For any subagent dispatch: full task text in prompt (never "read the plan"), never pass session history, fixed status protocol, adversarial reviewer instruction, spec-then-quality order, ~3-iteration cap.
13. [ ] Cut everything Claude already knows; hit the word-count target; convert to imperative voice.
14. [ ] Cross-link by name with REQUIRED markers; name upstream/downstream hand-offs and forbidden transitions.
15. [ ] Before shipping: test under combined pressure (time + sunk cost + exhaustion + authority); iterate until the agent complies and cites the skill. (Use the fotw evals harness as the GREEN gate.)

**Constellation-specific grafts to preserve while transforming:**
- Keep fotw's empirical `verify` (run-the-app) as the executable step the verification gate runs.
- Bake in the false-green countermeasure: tests must drive the REAL path, not fakes/injected state (mutation-test check) — this is a documented, load-bearing Trevor concern.
- Pin all review/dispatch subagents to `gh pr diff --name-only` scope.
- Honor standing rules in the prose: no section-sign, confidence indicators in live output only, concise bullets, personas only in live chat (never in committed files).
