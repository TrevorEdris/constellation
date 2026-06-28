# OWASP Top 10 Quick Reference

## A01:2021 - Broken Access Control

**What:** Users can act outside their intended permissions.

**Look for:**
- Missing authorization checks
- IDOR (Insecure Direct Object References)
- Privilege escalation paths
- CORS misconfigurations

**Fix:** Implement deny-by-default access control, verify permissions server-side.

---

## A02:2021 - Cryptographic Failures

**What:** Failures related to cryptography leading to data exposure.

**Look for:**
- Hardcoded secrets/credentials
- Weak encryption algorithms (MD5, SHA1 for passwords)
- Missing encryption for sensitive data
- Improper key management

**Fix:** Use strong, modern algorithms. Never store secrets in code.

---

## A03:2021 - Injection

**What:** User-controlled data sent to interpreter without validation.

**Look for:**
- SQL injection (string concatenation in queries)
- Command injection (user input in shell commands)
- NoSQL injection
- LDAP injection
- XPath injection

**Fix:** Use parameterized queries, ORMs, safe APIs.

---

## A04:2021 - Insecure Design

**What:** Missing or ineffective security controls in design.

**Look for:**
- Missing rate limiting on auth
- No brute force protection
- Insecure password recovery
- Missing multi-factor auth for sensitive ops

**Fix:** Threat model during design, implement defense in depth.

---

## A05:2021 - Security Misconfiguration

**What:** Insecure default configs, incomplete setups, verbose errors.

**Look for:**
- Default credentials
- Unnecessary features enabled
- Verbose error messages exposing internals
- Missing security headers

**Fix:** Hardened, minimal configurations. Automate verification.

---

## A06:2021 - Vulnerable and Outdated Components

**What:** Using components with known vulnerabilities.

**Look for:**
- Outdated dependencies
- Unmaintained libraries
- Components with known CVEs

**Fix:** Regular dependency updates, vulnerability scanning.

---

## A07:2021 - Identification and Authentication Failures

**What:** Broken authentication mechanisms.

**Look for:**
- Weak password policies
- Credential stuffing vulnerabilities
- Session fixation
- Missing session timeout
- Insecure session token generation

**Fix:** Multi-factor auth, secure session management.

---

## A08:2021 - Software and Data Integrity Failures

**What:** Code and infrastructure without integrity verification.

**Look for:**
- Insecure deserialization
- Unsigned updates
- Untrusted CI/CD pipelines
- Auto-update without verification

**Fix:** Digital signatures, integrity checks, secure CI/CD.

---

## A09:2021 - Security Logging and Monitoring Failures

**What:** Insufficient logging to detect breaches.

**Look for:**
- Missing auth event logging
- Logs not protected
- No alerting on suspicious activity
- Logs with sensitive data

**Fix:** Log security events, protect logs, implement alerting.

---

## A10:2021 - Server-Side Request Forgery (SSRF)

**What:** Application fetches remote resource without validating user-supplied URL.

**Look for:**
- User-controlled URLs in server requests
- URL parsers that can be bypassed
- Internal service access via redirects

**Fix:** Allowlist allowed hosts, validate/sanitize URLs.
