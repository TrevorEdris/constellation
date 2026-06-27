## Summary

<!-- 1-3 bullet points describing what changed and why.
     Focus on the "why" — what problem does this solve?
     Example:
     - Adds OAuth2 login so users don't need to manage passwords
     - Integrates with Google's identity provider for enterprise SSO
-->

## Changes

<!-- Auto-populated by scripts/pr-body.sh from diff stat.
     If filling manually, list the significant files or areas changed.
     Example:
     - `auth/oauth.go` — new OAuth2 handler
     - `middleware/session.go` — session token replaced with JWT
     - `db/migrations/` — new users.refresh_token column
-->

## Test Plan

- [ ] Existing tests pass
- [ ] New tests cover the added behavior
- [ ] Manual smoke test of the primary user flow
<!-- Add scenario-specific checks:
     - [ ] OAuth login works with a real Google account
     - [ ] Existing sessions are invalidated after the migration
     - [ ] API returns 401 (not 500) when token is expired
-->

## Related

<!-- Links to tickets, related PRs, documentation, or design docs.
     Example:
     - Closes #142
     - Refs PROJ-456
     - Design doc: https://...
-->

---

<!-- PR Checklist (remove before submitting if your team doesn't use it)
- [ ] Self-reviewed the diff
- [ ] No secrets or credentials in the diff
- [ ] CHANGELOG updated (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] Breaking changes called out in the summary
-->
