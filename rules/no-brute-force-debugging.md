---
description: Prevent guess-and-check debugging. Enforce root cause investigation before
  any fix attempt.
paths:
- '**/*'
---

## No Brute-Force Debugging

Before proposing ANY fix for a bug, test failure, or unexpected behavior: identify the root cause first. No exceptions.

### Before You Fix Anything

Ask yourself:
- Did you read the full error message and stack trace?
- Can you reproduce the issue consistently?
- Can you state the root cause in one sentence?

If NO to any of the above: you are not ready to fix. Investigate more.

### Never Do

- Propose a fix without stating the root cause
- Try multiple fixes at once ("let me also change X while I'm here")
- Retry the same approach with minor variations
- Say "this should fix it" — either you know it will or you're guessing
- Attempt a 4th fix without discussing with the user

### Three-Fix Limit

If you have tried 3 fixes and the issue persists: **STOP**. Tell the user. This is likely an architectural problem, not a code bug. Continuing without understanding only adds complexity and masks the real issue.

### Verification

After every fix: run the relevant test/build/check. Report the actual output. Do not say "this should work now" without evidence.

### Quick Root Cause Test

You know the root cause when you can complete this sentence with specifics:

> "The bug occurs because [specific condition] causes [specific component] to [specific behavior] when [specific trigger]."

Vague answers like "something is wrong with the config" mean you are not done investigating.
