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

## Mode Selection

Detect the sub-workflow from the request or context; if ambiguous, ask.

| Mode | Trigger | Action |
|------|---------|--------|
| commit | Staged changes exist, user wants to commit | Generate a conventional commit message |
| pr | User wants to open a PR | Generate PR body, push, create via `gh` |
| branch | User wants a new branch | Enforce naming, create branch |
| conflict | `UU` markers in `git status` | Guide per-file resolution |
| worktree | User wants an isolated workspace | Delegate to `constellation:git-workflow` |
| finish | Work done, branch ready to dispose | Delegate to `constellation:git-workflow` |

Auto-detect: staged files + no conflicts → commit; conflict markers → conflict; clean branch + no argument → ask.

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

1. Determine the base branch (`main` → `master` → `develop`).
2. Collect history: `git log --oneline <base>..HEAD` and `git diff <base>...HEAD --stat`.
3. Generate a title under 70 chars summarizing the whole change.
4. Generate the body. **Check for `.github/PULL_REQUEST_TEMPLATE.md` (or `pull_request_template.md`) first — the repo template overrides `assets/pr-template.md`.**
5. Push: if the branch has no upstream, `git push -u origin <branch>`; else `git push`. (Re-check the branch-check guardrail before pushing.)
6. Create the PR: `GITHUB_TOKEN= gh pr create --title "<title>" --body "<body>"`. If `gh` is missing, print the body + remote URL and suggest `brew install gh`.
7. Report the PR URL.

`scripts/pr-body.sh [base-branch]` generates a formatted body from commit history.

## Sub-Workflow: branch

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

## Sub-Workflow: worktree

**REQUIRED SUB-SKILL:** delegate to `constellation:git-workflow`. Do not hand-roll worktree creation here. That skill owns directory selection and the safety gates below.

Non-negotiable safety carried from that skill — apply even if you set up a worktree inline:
- **Verify the worktree directory is gitignored before creating it.** For project-local dirs run `git check-ignore -q .worktrees || git check-ignore -q worktrees`. If NOT ignored: add the line to `.gitignore` and commit it (auto-fix immediately), then proceed. Skipping this lets worktree contents get tracked and committed.
- **Verify a clean test baseline after setup.** Run the project's test suite in the new worktree. If tests fail, report failures and ask whether to proceed or investigate — never start work on an unknown-broken baseline.
- Auto-detect setup (`package.json`→install, `go.mod`→`go mod download`, `Cargo.toml`→`cargo build`, `requirements.txt`/`pyproject.toml`→install); never hardcode.

## Sub-Workflow: finish

**REQUIRED SUB-SKILL:** delegate to `constellation:git-workflow` for branch disposition (run tests, then merge / PR / keep / discard, plus worktree cleanup). The "keep as-is" path pairs with `constellation:session-handoff`. Do not delete a branch or merge to a base without running the test suite first and getting explicit confirmation for destructive options.

## Integration

- `constellation:git-workflow` — REQUIRED SUB-SKILL for the worktree mode.
- `constellation:git-workflow` — REQUIRED SUB-SKILL for the finish mode.
- `constellation:code-review` / `code-review` — review a PR this skill opened (no direct coupling; pin reviewers to `gh pr diff --name-only` scope).
- `constellation:verification-before-completion` — run before claiming a commit/PR is done; verify by running, not by reasoning.

## References

- `references/conventional-commits.md` — types, scopes, breaking-change format, anti-patterns.
- `references/branch-naming.md` — naming rules, ticket formats, pass/fail examples.
- `references/merge-conflict-guide.md` — conflict patterns and resolution strategies.

## Scripts

- `scripts/commit-msg.sh` — suggest type + scope + description from the staged diff.
- `scripts/pr-body.sh [base]` — generate a PR body from commit history and diff stat.
- `scripts/branch-check.sh <name>` — validate a branch name, return PASS/FAIL + suggestion.

## Assets

- `assets/pr-template.md` — fallback PR body template (repo `PULL_REQUEST_TEMPLATE.md` wins when present).
