# Conventional Commits Reference

Conventional Commits is a lightweight specification for commit message format. It makes commit history machine-readable (for changelog generation, semver bumping) and human-readable (for code review, blame, bisect).

**Specification:** https://www.conventionalcommits.org/

---

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

- **type**: Required. Categorizes the change.
- **scope**: Optional but recommended. The module, package, or component affected.
- **description**: Required. Imperative mood, present tense, no period at end, under 72 characters total for the first line.
- **body**: Optional. Explain *why*, not *what*. Wrap at 72 characters.
- **footer**: Optional. Breaking change notices, issue references, co-authors.

---

## Commit Types

| Type | When to Use | Example |
|------|-------------|---------|
| `feat` | New capability visible to users or callers | `feat(auth): add OAuth2 login flow` |
| `fix` | Corrects a bug or incorrect behavior | `fix(api): handle null response from /users` |
| `refactor` | Code restructure with no behavior change | `refactor(db): extract query builder from handler` |
| `docs` | Documentation only — no code changes | `docs(readme): add quickstart instructions` |
| `test` | Adding or updating tests | `test(auth): add unit tests for token refresh` |
| `chore` | Build system, CI config, dependency updates | `chore(deps): upgrade axios to 1.7.0` |
| `perf` | Performance improvement with measurable impact | `perf(query): add index on users.email` |
| `ci` | CI/CD pipeline definitions and scripts | `ci(github-actions): add matrix build for Node 20` |
| `style` | Formatting, whitespace, semicolons — no logic change | `style: apply prettier formatting` |
| `revert` | Reverts a previous commit | `revert: feat(auth): add OAuth2 login flow` |

### Choosing Between Types

- `fix` vs `refactor`: If the code was *wrong* before, it's a `fix`. If it was *correct but messy*, it's a `refactor`.
- `chore` vs `ci`: Use `ci` when the change is specifically to CI/CD pipeline files. Use `chore` for everything else in the build/tooling category.
- `feat` vs `refactor`: If a new public interface or capability is exposed, it's a `feat`. If it's an internal restructure, it's a `refactor`.

---

## Scope Guidelines

The scope identifies *where* the change lives in the codebase. Use the most specific relevant unit:

- Package or module name: `feat(payments): ...`
- Layer: `fix(middleware): ...`
- Component: `feat(sidebar): ...`
- Service: `chore(worker): ...`
- File (for small repos): `test(utils): ...`

**Rules:**
- Lowercase
- Single word or hyphenated phrase
- Omit scope only when the change truly spans the entire codebase

---

## Examples

### Feature Addition

```
feat(auth): add OAuth2 login flow

Integrates with Google OAuth2. Users can now sign in without a password.
Stores the refresh token encrypted in the session store.

Closes #142
```

### Bug Fix

```
fix(api): handle null response from /users endpoint

The /users/:id endpoint returned 500 when the user record was deleted
while the request was in-flight. Now returns 404 with a structured error.
```

### Refactor

```
refactor(db): extract query builder from repository layer

Moves all raw SQL construction into a dedicated QueryBuilder struct.
No behavior change — output SQL is identical to before.
```

### Documentation Only

```
docs(api): document rate limiting headers in OpenAPI spec
```

### Chore / Dependency Update

```
chore(deps): upgrade Go from 1.21 to 1.23

Updates go.mod and go.sum. No API changes required.
```

### CI Change

```
ci(github-actions): add matrix build for Node 18, 20, 22

Previously only tested on Node 18. Matrix ensures forward compatibility.
```

---

## Breaking Changes

Breaking changes must be surfaced in either the type suffix or the footer.

### Method 1: Exclamation Mark (type suffix)

```
feat!(auth): replace session tokens with JWTs

BREAKING CHANGE: The Authorization header format changed from
"Bearer <session-id>" to "Bearer <jwt>". Clients must be updated.
```

### Method 2: Footer

```
feat(auth): replace session tokens with JWTs

BREAKING CHANGE: Authorization header format changed from
"Bearer <session-id>" to "Bearer <jwt>". All API clients must update
their authentication handling before deploying this version.
```

Both methods signal to semver tooling that a major version bump is required.

---

## Multi-Line Bodies

Use the body to explain context that the description cannot fit:

```
fix(cache): prevent thundering herd on cold start

On service restart, all 50 workers would simultaneously attempt to
populate an empty cache, overwhelming the database. Added a
probabilistic early expiration (PER) strategy so only one worker
refreshes each key at a time.

The fix is backward compatible — existing cache entries are not
invalidated by the deployment.

Refs #301
```

**Guidelines:**
- Separate subject from body with a blank line
- Explain the *why* and the *impact*, not the mechanical *what*
- Reference issues with `Fixes #N`, `Closes #N`, or `Refs #N`

---

## Footer Trailers

```
fix(payments): correct Stripe webhook signature validation

Fixes #89
Refs #102
Co-Authored-By: Jane Smith <jane@example.com>
Co-Authored-By: Claude <noreply@anthropic.com>
```

Common trailers:
- `Fixes #N` / `Closes #N` — closes the referenced issue
- `Refs #N` — references without closing
- `Co-Authored-By:` — credits paired contributors
- `BREAKING CHANGE:` — signals a semver major bump

---

## Anti-Patterns

| Avoid | Why | Instead |
|-------|-----|---------|
| `fix: various fixes` | No information | `fix(auth): prevent expired tokens from bypassing middleware` |
| `feat: updated stuff` | Vague, past tense | `feat(dashboard): add weekly revenue chart` |
| `WIP` | Not a complete commit | Squash or use `git stash` |
| `chore: merge main into feature` | Noise in history | Rebase instead of merge commit |
| First line over 72 chars | Truncates in git log | Break into subject + body |
| Describing *what* the code does | Code shows that | Describe *why* the change was needed |
