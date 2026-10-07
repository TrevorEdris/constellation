---
schema: plan/v3
date: 2026-10-07
slug: Wishlist-Share-Link
status: draft
delivery:
  - repo: {repo}
    mode: pr
    branch: feat/share-link
    base: main
    remote: origin
    prs: 1
tags: [wishlist, sharing]
---

# PLAN: Wishlist: share a list by link

## Brief
**Needs your call:**
1. Share links expire? → **after 30 days** (limits leaked links; if wrong: one config value)
2. Link viewers see claimed items? → **no** (protects the surprise invariant; if wrong: one flag)
3. Run → **subagent-driven** (5 independent tasks; or inline)
**Ships as:** 1 PR, feat/share-link → origin/main
**Delivers:** A signed-in user can share a read-only wishlist link with anyone.
**Size:** ~430 lines · 9 files · 5 tasks · 1 endpoint · 1 PR
**Made for you:**
- D4 Token is 128-bit random, stored hashed (if wrong: rotate all tokens)
- D5 Viewer reuses the list component (if wrong: one file)
**Flags:** none

---
> **For agentic workers:** REQUIRED SUB-SKILL: constellation:subagent-driven-development (inline: its references/executing-plans). Run is answered on the card.

## Global Constraints
- D1 [ask] Share links expire? Default: after 30 days. Why: limits leaked links. If wrong: one config value.
- D2 [ask] Link viewers see claimed items? Default: no. Why: protects the surprise invariant. If wrong: one flag.
- D3 [made] A share link grants read access only. Why: viewers never need to change a list. If wrong: add a role column.
- D4 [made] Token is 128-bit random, stored hashed. Why: a leaked database exposes no usable links. If wrong: rotate all tokens.
- D5 [made] Viewer reuses the list component. Why: one rendering path to maintain. If wrong: one file.
- Do not change: the owner-only list edit path.
- Out of scope: link analytics and per-viewer permissions.

## Target repo & files
The wishlist service, on branch `feat/share-link`.

New:
- `internal/share/token.go`
- `internal/share/token_test.go`
- `internal/share/handler.go`
- `internal/share/handler_test.go`
- `web/list/SharedList.tsx`

Modified:
- `internal/api/routes.go`
- `internal/config/config.go`
- `web/list/ListPage.tsx`
- `docs/api.md`

## Estimated PR size

| Area | Added | Removed |
|---|---|---|
| internal/share | 300 | 0 |
| internal/api and config | 20 | 0 |
| web/list | 90 | 10 |
| docs/api.md | 10 | 0 |
| **Total** | 420 | 10 |

**Estimated PR size: 430 lines.**

## Structure (phased)
| Phase | Delivers | Depends On | Enables |
|---|---|---|---|
| P1 | Token and expiry | none | P2 |
| P2 | Endpoint and viewer page | P1 | none |

**Critical path:** P1, then P2.

## Ordered steps

### Phase 1 — Token and expiry
1. **(1.1)** [RED→GREEN] Add token generation and hashing in `internal/share/token.go`. Verify: `go test ./internal/share -run TestToken` passes.
2. **(1.2)** [RED→GREEN] Add the expiry setting in `internal/config/config.go`, default 30 days. Verify: `go test ./internal/config` passes.

### Phase 2 — Endpoint and viewer page
3. **(2.1)** [RED→GREEN] Add `GET /share/{token}` in `internal/share/handler.go` and register it in `internal/api/routes.go`. Verify: `go test ./internal/share -run TestHandler` passes.
4. **(2.2)** [RED→GREEN] Hide claimed items from link viewers in `internal/share/handler.go`. Verify: `go test ./internal/share -run TestClaimedHidden` passes.
5. **(2.3)** [exempt: UI] Render the shared list in `web/list/SharedList.tsx` and add a Share button to `web/list/ListPage.tsx`. Verify: `pnpm test web/list` passes.

## Risks & assumptions
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A leaked link exposes a list | Low | Medium | 30-day expiry and hashed tokens |
| Viewers see claimed items | Low | High | Test pins the hidden-claims behavior |

Assumption: the list component already renders read-only lists.

## Verification (aggregate)
- Run `go test ./...` and `pnpm test`.
- Run `task lint`.
- Request a share link on LocalStack and confirm the list loads without claimed items.

## Traceability
| Discovery finding | Plan step |
|---|---|
| Viewers must not see claimed items | 2.2 |
| Links need an expiry | 1.2 |

## Out of scope
Link analytics and per-viewer permissions will not be built here.

## Git strategy
- Branch: `feat/share-link`.
- Commits: `feat(share): add token and expiry`, then `feat(share): add share endpoint and viewer page`.
- PR title: `feat: share a wishlist by link`. The repo PR template sets the PR description.
