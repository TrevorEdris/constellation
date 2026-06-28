# False Positive Filtering Guide

This guide helps distinguish real security vulnerabilities from noise.

## Hard Exclusions

These should NEVER be reported:

| Category | Reason |
|----------|--------|
| DOS/Resource exhaustion | Out of scope for code review |
| Secrets on disk (secured) | Handled by secret scanning tools |
| Rate limiting | Operational concern, not code vulnerability |
| Memory/CPU exhaustion | Performance issue, not security |
| Missing hardening | Only flag concrete vulnerabilities |
| Theoretical race conditions | Must be concretely exploitable |
| Outdated dependencies | Handled by dependency scanning |
| Memory safety in Rust | Language prevents these issues |
| Test-only code | Not production attack surface |
| Log spoofing | Not a security vulnerability |
| Path-only SSRF | Must control host/protocol |
| AI prompt injection | User content in prompts is expected |
| Regex injection | Not a vulnerability class |
| Documentation issues | Not executable code |
| Missing audit logs | Compliance, not vulnerability |

## Framework-Specific Rules

### React / Angular
- XSS is mitigated by default
- Only flag if using:
  - `dangerouslySetInnerHTML`
  - `bypassSecurityTrustHtml`
  - `innerHTML` assignments
  - `eval()` with user input

### Node.js / Express
- Environment variables are trusted
- CLI arguments are trusted
- `child_process` needs user-controlled input to be dangerous

### Python
- `pickle` with untrusted input IS dangerous
- `yaml.load()` without `Loader=SafeLoader` IS dangerous
- `eval()`/`exec()` with user input IS dangerous
- `subprocess` with shell=True and user input IS dangerous

### GitHub Actions
- Most workflow vulnerabilities are theoretical
- Must have concrete attack path with untrusted input
- `github.event.issue.body` in `run:` IS dangerous
- `github.event.pull_request.title` in `run:` IS dangerous

## Confidence Calibration

### High Confidence (0.9+)
- Direct SQL injection with string concatenation
- Command injection with user input in subprocess
- Hardcoded production credentials
- Authentication bypass in login flow

### Medium-High Confidence (0.8-0.9)
- XSS in React with dangerouslySetInnerHTML
- Path traversal with user-controlled file paths
- JWT signature not verified

### Medium Confidence (0.7-0.8)
- IDOR without explicit authorization check
- Session fixation potential
- Weak cryptographic random

### Low Confidence (<0.7) — DON'T REPORT
- Missing CSRF token (framework might handle)
- No rate limiting (operational)
- Verbose error messages (low impact)
- Missing security headers (defense-in-depth)

## Decision Tree

```
1. Is this in the hard exclusion list?
   YES → Don't report
   NO → Continue

2. Is this in test-only code?
   YES → Don't report
   NO → Continue

3. Is there a concrete attack path with untrusted input?
   NO → Don't report
   YES → Continue

4. Is confidence ≥ 0.8?
   NO → Don't report
   YES → Report with severity and remediation
```
