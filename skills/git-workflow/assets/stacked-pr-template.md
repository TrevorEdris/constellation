## Stack

<!-- Fill this block in AFTER `gh stack submit --auto` has created the PRs, so
     the real PR numbers are known. Get them from `gh stack view --json`.

     Keep the table ordered bottom to top — the bottom layer is the one based
     on the trunk. Mark the current PR so a reviewer landing here knows where
     they are.
-->

Part <N> of <TOTAL>. Review bottom to top.

| # | PR | Branch | What this layer does |
|---|----|--------|----------------------|
| 1 | #<n> | `<bottom-branch>` | <one line> |
| 2 | #<n> | `<branch>` | <one line> <- you are here |
| 3 | #<n> | `<top-branch>` | <one line> |

> This PR is based on the branch below it, not on the trunk, so the diff shows
> only this layer's change. Merging out of order will retarget the PRs above it.

## Summary

<!-- 1-3 bullets on what THIS layer changes and why — not the whole stack.
     The stack-wide rationale belongs in the bottom PR; each layer above it
     should stand on its own.
     Example:
     - Adds the preflight script the stack sub-workflow depends on
     - Fixes the validator bug that blocked every hyphenated branch name
-->

## Changes

<!-- Significant files or areas changed in THIS layer only.
     Example:
     - `scripts/stack-check.sh` — new preflight gate
     - `scripts/branch-check.sh` — hyphen accepted in the character class
-->

## Test Plan

- [ ] This layer builds and its tests pass **on its own**, with only the layers below it merged
- [ ] Existing tests pass
- [ ] New tests cover the added behavior
<!-- The first box is what makes a stack reviewable. If a layer only works once
     a higher layer lands, the split is wrong — fold it into the layer above
     with `gh stack modify` (a human-driven TUI) and resubmit.
-->

## Related

<!-- Links to tickets, design docs, or the other PRs in this stack.
     The per-PR links are already in the Stack table above, so use this for
     everything else.
     Example:
     - Closes #142
     - Design doc: https://...
-->

---

<!-- Reviewer notes (remove if your team doesn't use them)
- Review bottom to top; a comment on a lower layer may dissolve the ones above it.
- Approving a layer does not approve the ones above it.
- The author rebases the whole chain after any change to a lower layer, so
  expect force-pushes on the upper branches. That is normal for a stack.
-->
