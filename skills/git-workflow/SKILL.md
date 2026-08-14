---
name: git-workflow
description: "Use when committing, opening a PR, creating or naming a branch, resolving a merge conflict, setting up a worktree, squashing, rebasing, or wrapping up a finished branch — i.e. any hands-on git operation where the output (commit message, PR body, branch name, conflict resolution) needs to be correct."
---

# Git Workflow

Active assistant for everyday git operations: produce well-formed conventional commits, complete PR descriptions, valid branch names, and guided conflict resolution. This is a flexible skill — adapt the steps to the repo's conventions; the guardrails below are non-negotiable.

**Announce at start:** "Using git-workflow to [commit | open a PR | create a branch | resolve conflicts | finish this branch]."

## Guardrails (always on)

These mirror the user's standing git-safety rules. They override convenience.

- **Branch check first.** Run `git branch --show-current`. If on `main`/`master`/`develop`, STOP and ask before committing, merging, or pushing.
- **Never push to `main`/`master` without explicit approval.** No force-push to a protected branch, ever.
- **Never commit secrets.** Scan the staged diff for `.env`, credentials, tokens, keys before committing. If found, unstage and warn.
- **Prefer specific staging.** Stage named files (`git add path/...`); avoid `git add -A` / `git add .` unless the user asked for it.
- **Prefix `gh` with the token.** The bare `GITHUB_TOKEN` env var is invalid here; run GitHub commands as `GITHUB_TOKEN= gh ...` so `gh` falls back to keyring auth.
- **Commit trailer.** End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.

Stacking-specific, whenever `gh stack` is in play:

- **Never run `gh stack modify`.** It is a full-screen TUI with no non-interactive path. Restructuring a stack (drop, fold, reorder, rename) is a human hand-off — describe the change you want and stop.
- **Always pass `--auto` to `gh stack submit`, and explicit branch names to `init`/`add`.** Without them these commands open an editor or prompt. Never rely on the tool detecting a non-interactive terminal.
- **Never run `gh stack merge` without explicit human approval.** It merges every layer up to the chosen PR in one all-or-nothing operation, and it cannot bypass merge requirements.
- **Never trust `gh stack sync`'s exit code.** A diverged stack aborts the sync *with exit status 0* in a non-interactive terminal, pushing nothing. Confirm with `gh stack view --json`.

## Mode Selection

Detect the sub-workflow from the request or context; if ambiguous, ask.

| Mode | Trigger | Action |
|------|---------|--------|
| commit | Staged changes exist, user wants to commit | Generate a conventional commit message |
| pr | User wants to open a PR | Generate PR body, push, create via `gh` |
| stack | Related work spans 2+ dependent branches, or one PR would be too big | Build a stack with `gh stack`; one PR per layer |
| branch | User wants a new branch | Enforce naming, create branch |
| conflict | `UU` markers in `git status` | Guide per-file resolution |
| worktree | User wants an isolated workspace | Follow `references/using-git-worktrees/` |
| finish | Work done, branch ready to dispose | Follow `references/finishing-a-development-branch/` |

Auto-detect: staged files + no conflicts → commit; conflict markers → conflict; branch in a tracked stack (`gh stack view` exits 0) → stack; clean branch + no argument → ask.

## Sub-Workflow: commit

1. `git diff --cached --stat` — confirm what is staged. If nothing staged, show `git diff --stat` and ask which named files to stage (do not blanket-add).
2. Scan the staged diff for secrets (guardrails). Abort if any found.
3. Read the full diff: `git diff --cached`.
4. Pick the type from the change pattern (see `references/conventional-commits.md`): new behavior → `feat`; corrected wrong behavior → `fix`; restructure, behavior unchanged → `refactor`; tests only → `test`; docs only → `docs`; build/deps → `chore`; pipeline → `ci`; measured speedup → `perf`.
5. Derive the scope from the primary package/module/component.
6. Draft `<type>(<scope>): <description>` — imperative, present tense, first line under 72 chars; explain *why* in the body, not *what*.
7. Present for approval, then commit with the `Co-Authored-By` trailer.

`scripts/commit-msg.sh` suggests type, scope, and a description hint from the staged diff:
```bash
bash scripts/commit-msg.sh
```

Good/bad messages:
- ✅ `fix(api): return 404 instead of 500 for deleted users`
- ❌ `fix: various fixes` (no information) / `feat: updated stuff` (vague, past tense) / `WIP` (incomplete)

## Sub-Workflow: pr

**Before step 1:** if this branch is part of a tracked stack (`gh stack view` exits 0), use the stack sub-workflow instead — a plain `gh pr create` would base the PR on the trunk rather than the layer below it.

1. Determine the base branch (`main` → `master` → `develop`).
2. Collect history: `git log --oneline <base>..HEAD` and `git diff <base>...HEAD --stat`.
3. Generate a title under 70 chars summarizing the whole change.
4. Generate the body. **Check for `.github/PULL_REQUEST_TEMPLATE.md` (or `pull_request_template.md`) first — the repo template overrides `assets/pr-template.md`.**
5. Push: if the branch has no upstream, `git push -u origin <branch>`; else `git push`. (Re-check the branch-check guardrail before pushing.)
6. Create the PR: `GITHUB_TOKEN= gh pr create --title "<title>" --body "<body>"`. If `gh` is missing, print the body + remote URL and suggest `brew install gh`.
7. Report the PR URL.

`scripts/pr-body.sh [base-branch]` generates a formatted body from commit history.

## Sub-Workflow: stack

Stacked PRs split one large change into a chain of small PRs, each based on the branch below it, so every PR's diff shows only its own layer. Driven by the official `gh stack` extension.

**Prefer a stack when any of these hold:**
- The new branch would build on an unmerged, non-trunk branch.
- The plan has 2+ phases that each ship something reviewable on their own.
- The estimated PR size exceeds 1,000 lines (the `constellation:writing-plans` threshold).
- Layers have a strict dependency order — later ones cannot build or pass tests without earlier ones.

**Do not stack when:** the change is self-contained; the layers cannot be reviewed independently; or the base branch uses a merge queue (the queue picks the merge method and may land layers in separate groups).

### 1. Preflight

```bash
bash scripts/stack-check.sh
```
Any FAIL means stop and fix it first. If the extension is missing, offer `gh extension install github/gh-stack` (requires `gh` v2.0+) or use the fallback below. Add `--remote` to also compare each branch against the remote.

### 2. Build the stack

Name every layer bottom to top, validating each with `scripts/branch-check.sh` before creating it.

```bash
GITHUB_TOKEN= gh stack init --base main <layer1> <layer2> <layer3>
GITHUB_TOKEN= gh stack bottom
# ... commit layer 1 per the commit sub-workflow ...
GITHUB_TOKEN= gh stack rebase     # cascade new commits upward
GITHUB_TOKEN= gh stack up         # move to the next layer
```

`init` leaves you on the top layer, so step down before starting work. It also enables `git rerere`. Navigation: `up [n]`, `down [n]`, `top`, `bottom`, `trunk`.

### 3. Submit as drafts

```bash
GITHUB_TOKEN= gh stack submit --auto
```
Pushes every branch, opens one PR per layer with the bases chained, and links them as a Stack on GitHub. `--auto` creates them as **drafts**; `--open` would mark them ready for review instead.

### 4. Replace the generated titles and bodies

`--auto` invents throwaway titles and writes no body. For each PR, apply the title and body you would have produced in the `pr` sub-workflow, using `assets/stacked-pr-template.md`:

```bash
GITHUB_TOKEN= gh stack view --json                          # read the PR numbers
GITHUB_TOKEN= gh pr edit <n> --title "<title>" --body "<body>"
GITHUB_TOKEN= gh pr view <n> --json title,body,isDraft      # verify
```
Skipping this ships a stack of PRs with meaningless titles.

### 5. Responding to review on a lower layer

```bash
GITHUB_TOKEN= gh stack down       # or: gh stack bottom
# ... commit the fix ...
GITHUB_TOKEN= gh stack rebase     # replays every branch above it
GITHUB_TOKEN= gh stack push
```
`push` is **not atomic** — some branches may update while another is rejected; fix the rejected one and re-run. On a rebase conflict, resolve per the conflict sub-workflow then `gh stack rebase --continue`, or `gh stack rebase --abort` to restore every branch.

### 6. After the bottom PR merges

```bash
GITHUB_TOKEN= gh stack sync --prune
GITHUB_TOKEN= gh stack view --json    # verify; do NOT trust sync's exit code
```
Confirm trunk moved and the merged layer is gone. If the stacks diverged, sync did nothing despite succeeding — `gh stack unstack`, then rebuild with `gh stack submit --auto`.

### Retrofitting branches that already exist

```bash
GITHUB_TOKEN= gh stack link --base main <b1> <b2> <b3>
```
Pushes the branches, creates or reuses their PRs, chains the bases, and links them into a stack without taking over local tracking. Additive only — it never removes a PR from a stack.

### Fallback when the extension is unavailable

Create each branch off the previous one, then:
```bash
GITHUB_TOKEN= gh pr create --draft --base <branch-below> --head <branch>
git rebase --onto <new-parent> <old-parent> <branch>   # cascade by hand, bottom to top
GITHUB_TOKEN= gh pr edit <n> --base main               # retarget once the bottom merges
```

### Notes

- `gh stack view` exits 0 inside a stack and 2 outside one — the reliable "am I in a stack?" probe. Exit 8 means another process or worktree holds the lock.
- Stack metadata lives in the **common** git dir (`.git/gh-stack`), so every worktree of a repo shares one stack and only one may operate on it at a time. It is not committed: a fresh clone has no stack, so recover with `gh stack checkout <stack-number>`.
- `rerere` replays earlier conflict resolutions automatically. Verify what it replayed — a stale resolution applies silently.

## Sub-Workflow: branch

**Before step 1:** if the new branch would build on unmerged, non-trunk work, or the plan has 2+ phases that each ship independently, use the stack sub-workflow instead of a lone branch.

1. Ask for purpose (`feature|fix|chore|docs|refactor|test|hotfix|release`), optional ticket ID, and a 2–5 word description.
2. Build the name: with ticket `<type>/<ticket>-<kebab-desc>`, without `<type>/<kebab-desc>`.
3. Validate: `bash scripts/branch-check.sh "<name>"` (PASS/FAIL + suggestion).
4. Confirm, then `git checkout -b <name>`.

Constraints (full set in `references/branch-naming.md`): lowercase; hyphens not underscores; only `/`, `-`, `.`; description ≤ 50 chars; total ≤ 100.

- ✅ `feature/PROJ-42-add-oauth-login`
- ❌ `feature/AddOAuthLogin` (uppercase) / `feature/add_oauth_login` (underscores) / `PROJ-42-oauth` (no type prefix)

## Sub-Workflow: conflict

1. List conflicts: `git diff --name-only --diff-filter=U`.
2. Per file: read with `git diff <file>`, classify the pattern, resolve, then `git add <file>`.
   - Lockfiles (`package-lock.json`, `go.sum`, `poetry.lock`, …): never hand-edit — delete and regenerate with the package manager.
   - Import ordering: keep both sets, dedupe, sort.
   - Adjacent edits: usually merge both changes.
   - Deleted-vs-modified: decide which intent wins from PR context.
   - Config/schema additions: accept both additive blocks.
3. Verify no markers remain: `git diff --check`.
4. Continue: `git rebase --continue` or `git merge --continue`.
5. Run the test suite after resolution — git being satisfied does not mean the merge is logically correct.

Note: during `git rebase`, "ours" and "theirs" are swapped (HEAD is the upstream target, "theirs" is your replayed commits). Full patterns in `references/merge-conflict-guide.md`.

In a stack, `gh stack init` has enabled `git rerere`, so a conflict you resolved once is replayed automatically on later cascades. Read what it replayed before continuing — a resolution that was right for an earlier version of the layer applies silently to the new one.

## Sub-Workflow: worktree

**Bundled reference:** follow `references/using-git-worktrees/` (its SKILL.md). Do not hand-roll worktree creation here. That reference owns directory selection and the safety gates below.

Non-negotiable safety carried from that skill — apply even if you set up a worktree inline:
- **Verify the worktree directory is gitignored before creating it.** For project-local dirs run `git check-ignore -q .worktrees || git check-ignore -q worktrees`. If NOT ignored: add the line to `.gitignore` and commit it (auto-fix immediately), then proceed. Skipping this lets worktree contents get tracked and committed.
- **Verify a clean test baseline after setup.** Run the project's test suite in the new worktree. If tests fail, report failures and ask whether to proceed or investigate — never start work on an unknown-broken baseline.
- Auto-detect setup (`package.json`→install, `go.mod`→`go mod download`, `Cargo.toml`→`cargo build`, `requirements.txt`/`pyproject.toml`→install); never hardcode.

## Sub-Workflow: finish

**Bundled reference:** follow `references/finishing-a-development-branch/` for branch disposition (run tests, then merge / PR / keep / discard, plus worktree cleanup). The "keep as-is" path pairs with `constellation:session-handoff`. Do not delete a branch or merge to a base without running the test suite first and getting explicit confirmation for destructive options.

Stacked branches are disposed of with `gh stack sync --prune` after their PR merges, never with `git branch -D` — deleting a layer by hand leaves the stack metadata pointing at a branch that no longer exists.

## Integration

- `references/using-git-worktrees/` — bundled reference for the worktree mode.
- `references/finishing-a-development-branch/` — bundled reference for the finish mode.
- `constellation:code-review` / `code-review` — review a PR this skill opened (no direct coupling; pin reviewers to `gh pr diff --name-only` scope).
- `constellation:verification-before-completion` — run before claiming a commit/PR is done; verify by running, not by reasoning.
- `constellation:writing-plans` — its estimated-PR-size forecast is the trigger for the stack mode: a plan over 1,000 lines should ship as a stack rather than one PR.

## References

- `references/conventional-commits.md` — types, scopes, breaking-change format, anti-patterns.
- `references/branch-naming.md` — naming rules, ticket formats, pass/fail examples.
- `references/merge-conflict-guide.md` — conflict patterns and resolution strategies.

## Scripts

- `scripts/commit-msg.sh` — suggest type + scope + description from the staged diff.
- `scripts/pr-body.sh [base]` — generate a PR body from commit history and diff stat.
- `scripts/branch-check.sh <name>` — validate a branch name, return PASS/FAIL + suggestion.
- `scripts/stack-check.sh [--remote]` — preflight before any `gh stack` operation; PASS/FAIL/INFO per check.

Regression tests for the two validators: `scripts/test-branch-check.sh`, `scripts/test-stack-check.sh`. Both are plain bash and take no arguments.

## Assets

- `assets/pr-template.md` — fallback PR body template (repo `PULL_REQUEST_TEMPLATE.md` wins when present).
- `assets/stacked-pr-template.md` — per-layer PR body for a stack; applied with `gh pr edit` after `gh stack submit --auto`.
