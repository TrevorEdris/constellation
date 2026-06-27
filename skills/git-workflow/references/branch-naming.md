# Branch Naming Conventions

Consistent branch names make history readable, CI rules writable, and PR filtering useful. This reference defines the recommended convention — teams can customize it, but it must be documented and applied uniformly.

---

## Format

```
<type>/<description>
<type>/<ticket-id>-<description>
```

- **type**: The category of work
- **ticket-id**: Optional reference to an issue tracker (Jira, GitHub Issues, Linear, etc.)
- **description**: Short kebab-case summary of the work

---

## Branch Types

| Type | When to Use |
|------|-------------|
| `feature` | New capability or user-facing behavior |
| `fix` | Bug fix on a non-production branch |
| `hotfix` | Emergency fix that goes directly to production |
| `chore` | Dependency updates, tooling, non-code maintenance |
| `docs` | Documentation-only changes |
| `refactor` | Code restructure with no behavior change |
| `test` | Adding or fixing tests, no production code change |
| `release` | Release preparation branch (`release/v2.3.0`) |
| `experiment` | Exploratory work, may never merge |

---

## Rules

| Rule | Detail |
|------|--------|
| Lowercase only | No uppercase letters anywhere |
| Hyphens, not underscores | `add-user-auth` not `add_user_auth` |
| No spaces | Spaces break shell commands |
| No special characters | Only `/`, `-`, and `.` (dot for version numbers in release branches) |
| Ticket prefix before description | `feature/PROJ-123-add-oauth` not `feature/add-oauth-PROJ-123` |
| Description max 50 characters | Keeps the full name readable in terminal output |
| Total max 100 characters | GitHub hard limit is 255; keep it practical |
| No trailing hyphens or slashes | `feature/auth` not `feature/auth-` |

---

## Examples

| Branch Name | Verdict | Reason |
|-------------|---------|--------|
| `feature/PROJ-42-add-oauth-login` | PASS | Type, ticket, kebab-case description |
| `fix/PROJ-101-null-pointer-on-logout` | PASS | Bug fix with ticket reference |
| `hotfix/payment-gateway-timeout` | PASS | Emergency fix, no ticket needed |
| `chore/upgrade-go-1.23` | PASS | Dependency update |
| `docs/api-rate-limiting` | PASS | Documentation-only |
| `release/v3.2.0` | PASS | Release branch with semver |
| `feature/AddOAuthLogin` | FAIL | Uppercase letters |
| `feature/add_oauth_login` | FAIL | Underscores not allowed |
| `PROJ-42-oauth` | FAIL | Missing type prefix |
| `feature/` | FAIL | Empty description |
| `fix/this-branch-has-an-incredibly-long-name-that-exceeds-the-maximum-allowed-length-for-descriptions` | FAIL | Description exceeds 50 chars |

---

## Ticket ID Formats

Match the format your team uses in the issue tracker:

| Tracker | Format | Example Branch |
|---------|--------|----------------|
| Jira | `PROJ-123` | `feature/PROJ-123-user-invitations` |
| GitHub Issues | `123` or `gh-123` | `fix/123-email-validation` |
| Linear | `ENG-456` | `refactor/ENG-456-extract-service-layer` |
| Azure DevOps | `12345` | `feature/12345-new-dashboard` |
| No tracker | Omit entirely | `chore/upgrade-dependencies` |

---

## Common Patterns

### Feature with ticket

```
feature/PROJ-123-add-user-invitations
feature/ENG-456-multi-tenant-support
```

### Bug fix

```
fix/PROJ-789-fix-null-pointer-on-logout
fix/payment-gateway-timeout
```

### Hotfix (urgent, may bypass normal review)

```
hotfix/PROJ-999-stripe-webhook-signature
hotfix/db-connection-pool-exhaustion
```

### Release branch

```
release/v2.3.0
release/v2.3.0-rc1
```

### Chore / maintenance

```
chore/upgrade-go-1.23
chore/remove-deprecated-endpoints
chore/update-ci-node-version
```

### Experimental

```
experiment/graphql-federation
experiment/rust-rewrite
```

---

## CI Integration

Branch naming conventions enable CI rules:

```yaml
# Example: Only run deploy pipeline on feature branches
on:
  push:
    branches:
      - 'feature/**'
      - 'fix/**'
      - 'hotfix/**'

# Example: Prevent direct pushes to main
branch_protection:
  main:
    require_pull_request: true
    restrict_pushes: true
```

If your CI uses branch patterns, ensure the `type` you use matches those patterns.

---

## Validation

Use `scripts/branch-check.sh` to validate a branch name before creating it:

```bash
bash scripts/branch-check.sh "feature/PROJ-123-add-oauth-login"
# PASS: feature/PROJ-123-add-oauth-login

bash scripts/branch-check.sh "Feature/AddOAuthLogin"
# FAIL: Contains uppercase letters
# Suggestion: feature/add-oauth-login
```
