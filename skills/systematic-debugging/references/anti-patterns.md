# Debugging Anti-Patterns

Common rationalizations that lead to brute-force debugging, and how to recognize when an investigation has gone off track.

---

## Rationalization Table

These are the most common excuses for skipping systematic debugging, paired with the reality that makes them wrong.

| Rationalization | Reality |
|-----------------|---------|
| "This issue is simple, I can see the fix" | Seeing symptoms is not understanding root cause. Simple-looking bugs often have non-obvious causes. The process is fast for genuinely simple bugs. |
| "It's an emergency, there's no time" | Systematic debugging is faster than brute-force past the second failed attempt. Each wrong fix adds complexity and time. |
| "Let me just try this first" | The first fix sets the pattern for the investigation. Starting with a guess trains the next guess. Do it right from the start. |
| "I'll write the test after it's fixed" | Untested fixes do not stick. Without a failing test, the next refactor re-introduces the bug silently. |
| "Let me change both X and Y while I'm here" | Two changes in one attempt means you cannot know which one worked (or which one broke something else). |
| "The reference is too long to read completely" | Partial understanding of a reference implementation guarantees bugs at the edge cases you did not read. |
| "I can see where the problem is" | Seeing the symptom location is not the same as understanding why it occurs. "I see the NPE" is not "I know the root cause." |
| "One more fix attempt" | Three failed attempts is the signal that this is an architectural problem. The fourth attempt continues guessing without new information. |
| "I'll just add a null check here" | A null check without understanding why null is possible hides a data integrity problem behind a bandage. |
| "The same approach will work with minor tweaks" | If the approach did not work the first time, minor variations are not new hypotheses — they are the same guess with adjustments. |

---

## Phase Quick Reference

Use this table to confirm you are in the right phase before taking action.

| Phase | You Have | You Are Ready To |
|-------|----------|-----------------|
| Phase 1 | Error message, reproduction steps, recent changes reviewed | Form hypotheses |
| Phase 2 | Working reference implementation identified and compared | Identify differences, map cause chain |
| Phase 3 | Single specific hypothesis | Test with minimal targeted change |
| Phase 4 | Root cause confirmed by testing | Implement final fix, write test, verify |

If you cannot check the left column, you are not in that phase. Return to the previous one.

---

## Signals That Investigation Is Off Track

These signals indicate the investigation has drifted from structured to brute-force. Recognize them and return to Phase 1.

### Signal 1: Stacking Fixes

You have made multiple changes in sequence without verifying that each one resolves the issue independently.

**Signs:** "While I was there I also changed...", multiple git staged files for a single bug fix, a fix commit that touches 5+ files.

**Return to:** Phase 1. Revert to a clean state. Investigate what each change was intended to address and whether the root cause has actually been confirmed.

### Signal 2: Hedged Language

You are using language that signals uncertainty masquerading as a recommendation.

**Signs:** "This should fix it", "probably the issue is", "I think this might help", "worth trying".

**Return to:** Phase 3. You do not have a hypothesis, you have a guess. State what you know and what you do not know. If the hypothesis cannot be stated without hedging, it is not ready to test.

### Signal 3: Surprise at Results

Each test of a fix produces a surprise — unexpected output, new error, behavior that does not match what you predicted.

**Signs:** "Hmm, that's strange", "I would have expected...", "that's not what I thought would happen".

**Return to:** Phase 1. Surprise means your mental model of the system is wrong. The investigation cannot produce reliable results until the mental model is corrected.

### Signal 4: Growing Scope

Each fix attempt reveals new coupling that must also be addressed, and the required change scope expands with each attempt.

**Signs:** "Now that I fixed X, I also need to change Y and Z", the fix PR is growing larger, the original bug description no longer matches what you are working on.

**Return to:** Phase 2. The growing scope suggests an architectural issue. Escalate for human review rather than continuing to expand the change.

### Signal 5: Forgetting What Has Been Tried

You are not certain which approaches have been attempted and what each one produced.

**Signs:** "Did I already try...?", reverting and re-applying the same change, contradicting your own earlier analysis.

**Action:** Start a debugging log immediately. See `debugging-log-template.md`. This is not optional — the log is the working memory for investigations that exceed 30 minutes.

---

## What to Say Instead

When under pressure to skip the process, these reframings help:

| Pressure | Reframe |
|----------|---------|
| "We need this fixed now" | "I need 10 minutes to confirm the root cause so the fix sticks" |
| "Just try X and see if it works" | "X addresses the symptom. Let me confirm whether that's also the root cause." |
| "You've been on this too long" | "I've tried 3 approaches. I think this is architectural. Can we look at it together?" |
| "Why are you reading all that code?" | "I need to understand what 'working' looks like before I can compare." |

---

## The Three-Attempt Checkpoint

After each fix attempt that does not resolve the issue, ask:

1. Did this attempt give me new information about the root cause?
2. Is my next hypothesis more specific than the last one?
3. Is the scope of investigation narrower than when I started?

If the answer to any of these is no: the investigation has stalled. Escalate before attempting a third fix.

If you are past three attempts: escalate unconditionally. State what you know, what you tried, what each attempt revealed, and that the problem likely requires architectural discussion.
