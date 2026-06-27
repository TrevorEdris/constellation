# Debugging Log Template

A structured template for documenting the state of an investigation. Use this for any debugging session that spans more than 30 minutes or involves more than one hypothesis.

**Why keep a log:** Debugging sessions that require multiple hypotheses suffer from investigation drift — retrying approaches already ruled out, losing track of what evidence has been gathered, forgetting which hypothesis is currently being tested. The log is the single source of truth for the investigation state.

---

## When to Start a Log

Start a debugging log when:
- The issue has not been resolved within 30 minutes
- You are about to attempt a second hypothesis
- The bug involves multiple components or systems
- You need to hand the investigation to another person
- The same bug has been reported before and you do not know what was tried

---

## Template

Copy this template and fill in each section as the investigation progresses. Do not fill in sections you do not yet have information for — blank sections are meaningful signals that investigation is incomplete.

```markdown
# Debugging Log: [Short Description of Issue]

**Date:** YYYY-MM-DD
**Reporter:** [Who reported the bug]
**Investigator:** [Who is debugging]
**Status:** [ ] Active  [ ] Root Cause Identified  [ ] Fixed  [ ] Escalated

---

## Symptom Description

[Describe the observable failure in exact terms. Include error messages verbatim.]

**Error message:**
```
[Paste exact error message and stack trace here]
```

**Unexpected behavior:**
[What you got vs. what you expected]

**Severity:** [ ] Critical  [ ] High  [ ] Medium  [ ] Low

---

## Reproduction Steps

[Exact steps to reproduce the issue, every time]

1.
2.
3.

**Reproduction rate:** [ ] Always  [ ] Sometimes (___% of attempts)  [ ] Unable to reproduce

**Distinguishing conditions (if intermittent):**
[What conditions are present when it fails that are absent when it succeeds]

---

## Scope and Context

**When did this start?** [After deploy X, always been present, recent change, unknown]

**Recent changes that may be relevant:**
```
[Output of: git log --oneline -10 or git diff --stat HEAD~5]
```

**Affected environments:** [ ] Local  [ ] Dev  [ ] Staging  [ ] Production

**Affected users or inputs:** [All users, specific user type, specific input condition]

---

## Evidence Gathered

Document what you have read, run, or observed. One entry per piece of evidence.

| Component | Evidence | Observation |
|-----------|----------|-------------|
| [e.g., API layer] | [e.g., Read src/api/orders.js:42] | [e.g., No null check on order.total before passing to invoice service] |
| | | |
| | | |

**Log output examined:**
```
[Paste relevant log lines here]
```

**Database state observed:**
```
[Paste relevant query results here]
```

---

## Hypotheses Tested

Each hypothesis gets its own entry. Do not merge multiple hypotheses into one entry.

### Hypothesis 1

**Hypothesis:** [X causes Y because Z — specific and testable]

**Test:** [Smallest change that tests this hypothesis]

**Result:** [What actually happened when you ran the test]

**Conclusion:** [ ] Confirmed  [ ] Refuted  [ ] Inconclusive

**New information:** [What this test told you, even if the hypothesis was wrong]

---

### Hypothesis 2

**Hypothesis:** [X causes Y because Z]

**Test:** [Smallest change that tests this hypothesis]

**Result:**

**Conclusion:** [ ] Confirmed  [ ] Refuted  [ ] Inconclusive

**New information:**

---

### Hypothesis 3

**Hypothesis:** [X causes Y because Z]

**Test:** [Smallest change that tests this hypothesis]

**Result:**

**Conclusion:** [ ] Confirmed  [ ] Refuted  [ ] Inconclusive

**New information:**

> **Three-Attempt Checkpoint:** If all three hypotheses have been refuted or returned inconclusive, stop here. Escalate for architectural review. Do not add Hypothesis 4 without human input.

---

## Root Cause

[Only fill this in when root cause is confirmed by evidence, not by hypothesis alone]

**Root cause statement:** [One sentence: the bug occurs because X causes Y when Z]

**Evidence confirming root cause:**
[What specifically confirms this is the root cause and not another symptom layer]

**Why the bug was structurally possible:**
[What condition allowed this bug to exist — missing validation, incorrect assumption, etc.]

---

## Fix Applied

**File:** [path/to/file.ext]

**Change:** [Describe the minimal change made to address the root cause]

**Failing test created:** [ ] Yes (link/path)  [ ] No (reason)

---

## Verification

**Verification command:**
```bash
[Exact command to run that confirms the fix]
```

**Output:**
```
[Paste actual output here]
```

**Result:** [ ] Fix confirmed  [ ] Fix incomplete  [ ] Regression introduced

**No regressions:** [ ] Confirmed by running full test suite

---

## Escalation (if applicable)

**Reason for escalation:** [What made this require human input]

**Attempts made:** [Summary of what was tried]

**Architectural question to answer:** [What decision or redesign is needed]

**Handed to:** [Who is handling the escalation]
```

---

## Usage Guidelines

- Fill in sections as you go — do not wait until the end
- Keep evidence entries factual: what you observed, not what you inferred
- Write hypothesis statements in the format "X causes Y because Z" — vague hypotheses produce inconclusive tests
- The "new information" field after each hypothesis is mandatory — even a failed hypothesis should teach you something
- If you cannot fill in "new information", the test was not designed to produce information — reconsider the test

---

## Handing Off an Investigation

When handing a debugging session to another person, provide:
1. The debugging log in its current state
2. The most recent hypothesis and why it was formed
3. The evidence that feels most significant (even if its interpretation is unclear)
4. Explicitly what has NOT been investigated yet

The handoff recipient should read the full log before forming their own hypothesis. Do not summarize verbally — the log exists precisely to prevent information loss in handoffs.
