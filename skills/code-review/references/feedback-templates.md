# Code Review Feedback Templates

## Blocking Issues

### Missing Error Handling
```
🚫 **Blocking:** This code path doesn't handle the case where [X fails]. 
Consider adding error handling to prevent [consequence].
```

### Security Concern
```
🚫 **Blocking - Security:** [Description of vulnerability]. 
This could allow [attack vector]. Please [remediation].
```

### Logic Error
```
🚫 **Blocking:** There's a logic issue here. When [condition], 
this will [incorrect behavior] instead of [expected behavior].
```

### Missing Test Coverage
```
🚫 **Blocking:** This new functionality needs test coverage for [scenario]. 
Without tests, we can't verify [critical behavior].
```

---

## Suggestions (Non-Blocking)

### Performance Improvement
```
💡 **Suggestion:** Consider [optimization] here. Currently this is O(n²), 
but could be O(n) by [approach]. Not blocking, but worth considering 
if this is called frequently.
```

### Readability
```
💡 **Suggestion:** This could be more readable if we [extract method / rename / simplify]. 
For example: [code snippet]
```

### Alternative Approach
```
💡 **Suggestion:** Have you considered [alternative]? It might be cleaner because [reason]. 
Happy to discuss if you prefer the current approach.
```

### Documentation
```
💡 **Suggestion:** A brief comment here explaining [why this approach] 
would help future readers understand the reasoning.
```

---

## Questions / Clarifications

### Understanding Intent
```
❓ **Question:** I'm not sure I understand the intent here. 
Is this meant to [interpretation A] or [interpretation B]?
```

### Edge Case
```
❓ **Question:** What happens if [edge case]? 
I don't see handling for this scenario.
```

### Design Decision
```
❓ **Question:** What drove the decision to [approach]? 
I'm curious about the tradeoffs vs [alternative].
```

---

## Positive Feedback

### Good Pattern
```
✅ Nice use of [pattern/approach] here. This makes the code [benefit].
```

### Clean Implementation
```
✅ This is really clean. I like how [specific aspect].
```

### Good Test
```
✅ Great test coverage for [scenario]. This will catch regressions.
```

---

## Ticket Alignment

### Missing Requirement
```
⚠️ **Ticket Alignment:** The ticket mentions [requirement], 
but I don't see this implemented. Was this intentionally deferred?
```

### Scope Creep
```
⚠️ **Ticket Alignment:** This change [description] doesn't seem to be 
in the ticket scope. Should this be a separate PR?
```

### Deviation from Acceptance Criteria
```
⚠️ **Ticket Alignment:** The acceptance criteria states [X], 
but the implementation does [Y]. Is this intentional?
```
