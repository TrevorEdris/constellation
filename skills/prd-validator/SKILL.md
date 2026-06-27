---
name: prd-validator
description: Use when a PRD.md exists and is about to be handed to engineering, fed into a roadmap, or declared "ready"; when the user asks "is this PRD ready", "validate my requirements", or "check this PRD"; when prd-author finishes a draft or iteration; or when a PRD arrived from a stakeholder and its quality is unknown
---

# PRD Validator

Type: rigid (discipline). Follow exactly. Do not adapt away the gate or substitute judgment for the script.

## Overview

A PRD that passes a real validation run is ready; one you eyeballed is a guess. Run the checker, read the score, fix the errors, re-run.

Core principle: a "ready" PRD is one that scored PASS on a fresh run THIS message — nothing less.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
NO "PRD IS READY" CLAIM WITHOUT A PASSING validate_prd.py RUN THIS MESSAGE
```

Reading the PRD and judging it "looks complete" is not validation. A score from a previous message, a different file, or before your last edit does not count. The script run produces the evidence; nothing else does.

## The Gate

```
1. LOCATE  Find the PRD. No path given -> check ./PRD.md; if absent, ask the user.
2. RUN     python scripts/validate_prd.py <path> --verbose
           Draft / work-in-progress: add --draft (threshold drops 70 -> 50).
3. READ    Full output: score, verdict, every ERROR, every WARNING.
4. VERIFY  PASS (>= threshold, zero errors)?
           - NO  -> fix each ERROR, then re-run from step 2. Do not hand off.
           - YES -> report the score with the evidence attached.
5. ONLY THEN call the PRD ready / proceed to roadmap.
```

Run from the skill directory (`skills/prd-validator/`) so the relative script path resolves. Exit code 0 = PASS, 1 = NEEDS WORK.

## Checks Performed (17)

| # | Check | What it validates |
|---|-------|-------------------|
| 1 | Problem statement | Section exists and is substantive, not just a heading |
| 2 | User personas | Section exists with at least one persona |
| 3 | Persona detail | Each persona names goals and pain points |
| 4 | Functional requirements | Section exists with requirement descriptions |
| 5 | Requirement IDs | Consistent IDs present (FR-001 format) |
| 6 | Acceptance criteria | Requirements describe what "done" looks like |
| 7 | Non-functional requirements | Performance, security, scalability documented |
| 8 | Scope boundary | Both in-scope AND out-of-scope stated explicitly |
| 9 | Dependencies | External systems, teams, data, APIs documented |
| 10 | Milestones | Phased delivery plan exists |
| 11 | Milestone deliverables | Each milestone states what users can do when it ships |
| 12 | Vague language | Flags "TBD" w/o owner, "should work", "probably", "as needed", "etc." |
| 13 | Oversized code blocks | Code blocks > 15 lines (PRDs describe, not implement) |
| 14 | Success metrics | Measurable outcomes defined |
| 15 | Open questions | Unresolved items documented (or explicitly empty) |
| 16 | ID consistency | Requirement IDs follow one consistent format, no gaps |
| 17 | Implementation leakage | "Files to change", source paths, line refs belong in PLAN.md, not PRD |

## Red Flags — STOP

These thoughts or words mean stop and run the gate:

- "This PRD looks complete / thorough / ready" — without a run
- "I read it, the sections are all there" — eyeballing is not validating
- "It passed last time" / "I validated an earlier draft" — stale run
- "Close enough to hand off" with open ERRORs unresolved
- "I'll just report a score" you did not get from the script
- About to invoke prd-to-roadmap on a PRD you never validated this message
- "Skip the script, I know PRDs" — the script is the evidence, not your taste

## Excuse → Reality

| Excuse | Reality |
|--------|---------|
| "It looks complete" | Run the script. Looks are not a score. |
| "I read every section" | Reading is not validation. The checker finds what you skim past. |
| "It passed earlier" | Stale. Re-run on the current file THIS message. |
| "Just warnings, ship it" | ERRORs block; warnings are quality debt you decided to keep on purpose, not by default. |
| "Close enough for handoff" | A PRD with open ERRORs is not ready. Fix, then re-run. |
| "I'll report the score I expect" | Report only the score the script printed. |
| "Draft, so quality doesn't matter" | Use --draft (threshold 50). It still has to pass. |
| "Different words, so the gate doesn't apply" | Spirit over letter. "Ready", "good to go", "solid" all trigger it. |

## Good / Bad pairs

Reporting readiness:
```
✅ [Run validate_prd.py --verbose] [score 84/100, PASS, 0 errors] "PRD passes: 84/100"
❌ "The PRD looks complete and ready for engineering"
```

Handling failures:
```
✅ PASS at 58 -> fix the 3 ERRORs -> re-run -> 78/100 PASS -> hand off
❌ "Scored 58 but it's basically fine, sending it over"
```

Draft mode:
```
✅ [Run with --draft] [score 62/100, PASS at threshold 50] "Draft passes; warnings tracked for finalization"
❌ Run without --draft on a WIP PRD, report NEEDS WORK, give no path forward
```

## Tracking

When the PRD scores NEEDS WORK, make each ERROR a TodoWrite entry, fix them, then re-run. Untracked fix lists get items skipped — every time.

## Integration

- Called by constellation:prd-author — invoked automatically after a PRD is created or iterated. (REQUIRED SUB-SKILL for prd-author's completion gate.)
- Gates constellation:prd-to-roadmap — that skill refuses to proceed unless the PRD passed this validator. Do not enter roadmap translation on an unvalidated PRD.
- Tool portability (Codex tool names): skills/_shared/platform/codex-tools.md.

## The Bottom Line

Run the script. Read the score. Fix the ERRORs. Re-run. Only a fresh PASS makes a PRD ready.
