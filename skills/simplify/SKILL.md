---
name: simplify
description: Use when changed code works but feels heavier than it should — after finishing a feature or fix, before requesting review, when a diff has duplication, reinvented helpers, needless layers, awkward abstraction levels, or dead/over-engineered code, or when the user says "clean this up", "simplify", "tighten this", or "make it nicer".
---

# Simplify

## Overview

Review only the changed code through four quality lenses, then apply the cleanups. Make working code simpler, not different.

This is a quality pass, not a bug hunt. If you find a correctness defect, note it and route to constellation:code-review — do not silently "fix" behavior under the guise of cleanup.

## Scope: changed code only

Pin the review to the diff. Do not wander into untouched files.

- Working tree: `git diff --name-only` (and `git diff` for the hunks)
- PR: `gh pr diff --name-only`

Read the surrounding code to understand intent, but only propose changes inside the diff unless the user widens scope.

## The four lenses

Pass the changed code through each lens. Catalog findings as `file:line — lens — what — proposed change`.

| Lens | Looking for | Fix |
|------|-------------|-----|
| Reuse | Logic that duplicates an existing helper, util, or stdlib function; a private reimplementation of something the codebase already has | Call the existing thing; delete the copy |
| Simplification | Nested conditionals, redundant branches, dead code, over-engineered abstraction for one caller, needless intermediate variables | Flatten, inline, delete |
| Efficiency | Obvious waste: work inside a loop that belongs outside, repeated recomputation, allocations in a hot path, an O(n^2) shape where O(n) is trivial | Hoist, memoize, pick the simpler data structure |
| Altitude | Code at the wrong level of abstraction: a high-level function tangled with low-level detail, or a helper that leaks its caller's concerns | Extract or collapse a layer so each function reads at one consistent level |

Altitude is the subtle one: a function "reads at one altitude" when every line is roughly the same level of detail. Mixing `parseConfig()` with raw byte-shifting in the same function is an altitude smell.

## Process

1. Announce: "Using simplify to clean up the changed code (quality only, no bug hunting)."
2. Resolve scope from the diff (see above). Establish a green test baseline before touching anything — if you cannot run tests, say so and proceed cautiously.
3. Walk the diff through the four lenses; record findings in TodoWrite, one todo per cleanup.
4. Apply cleanups one at a time. After each, run the relevant tests/lint. Behavior must not change — a cleanup that turns a test red is a wrong cleanup; revert it.
5. Verify: run the full test suite at the end. Report what changed and what you deliberately left alone.

## Behavior must not change

A simplification that alters output is a rewrite, not a cleanup. The test suite is the contract. Tests must exercise the real code path, not fakes or injected state — if the only test covering a cleanup drives a mock, the green is meaningless; flag it rather than trust it.

When tooling allows, confirm before/after equivalence beyond tests (same output on a sample input, unchanged public signature).

## Good / bad

Reuse:
- Bad: hand-rolled `function unique(arr) { return arr.filter((x,i)=>arr.indexOf(x)===i) }` next to an existing `import { dedupe } from "./collections"`.
- Good: `import { dedupe }` and delete the local copy.

Simplification:
- Bad: `if (ok) { return true } else { return false }`
- Good: `return ok`

Efficiency:
- Bad: `for (const id of ids) { const all = await db.fetchAll(); use(all, id) }` — full fetch every iteration.
- Good: hoist `const all = await db.fetchAll()` above the loop.

Altitude:
- Bad: a `handleRequest()` that validates, then inline-parses a binary header byte by byte, then responds.
- Good: `handleRequest()` calls `parseHeader(buf)`; the byte work lives in `parseHeader`.

Scope discipline:
- Bad: "While I was here I also refactored the unrelated auth module."
- Good: confine changes to the diff; mention adjacent smells as suggestions, do not touch them.

## When NOT to use

- Hunting for or fixing bugs, security issues, or correctness — use constellation:code-review.
- Large structural rework, dead-code sweeps across the codebase, or smell-driven refactoring beyond the diff — use constellation:refactoring (REQUIRED SUB-SKILL for anything bigger than a localized cleanup).
- Behavior changes, new features, or anything that needs a new test — out of scope; this pass never changes what the code does.

## Integration

- Pairs with constellation:code-review (REQUIRED BACKGROUND) — code-review judges correctness and spec compliance; simplify only polishes quality. Run code-review for defects, simplify for cleanliness.
- Escalates to constellation:refactoring (REQUIRED SUB-SKILL) when cleanups grow beyond the diff into structural change.
- Verify final state with constellation:verification-before-completion before claiming done.
