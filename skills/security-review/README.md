# security-review

Security-focused code review targeting high-confidence vulnerabilities with real exploitation potential.

## Usage

```
/security-review                    # Review current pending changes
```

## When to Use

- Before merging PRs that touch auth, input handling, or data access
- Auditing code that processes user input or external data
- Pre-release security checks on sensitive components
- When you want a second opinion focused purely on security

## What It Does

- Identifies vulnerabilities with >80% confidence of real exploitation potential
- Minimizes false positives — only flags issues with concrete attack vectors
- Covers OWASP Top 10 categories with practical exploitation context

## References

- `references/FALSE_POSITIVE_GUIDE.md` — Reducing noise in findings
- `references/OWASP_TOP_10.md` — Vulnerability categories and patterns
