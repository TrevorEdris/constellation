# Merge Conflict Resolution Guide

Merge conflicts occur when two branches modify the same region of a file in incompatible ways. Git cannot automatically determine which version to keep, so it inserts conflict markers and stops.

---

## Reading Conflict Markers

```
<<<<<<< HEAD
code from your current branch (ours)
=======
code from the incoming branch (theirs)
>>>>>>> feature/other-branch
```

| Marker | Meaning |
|--------|---------|
| `<<<<<<< HEAD` | Start of your branch's version |
| `=======` | Divider between the two versions |
| `>>>>>>> <branch>` | End of the incoming branch's version |

**In a rebase:** "ours" and "theirs" are *swapped* from what you might expect. During `git rebase`, `HEAD` refers to the *upstream* branch being rebased onto, and the incoming changes are *your* commits being replayed. Keep this in mind when deciding which side to keep.

---

## Finding Conflicted Files

```bash
# List all files with unresolved conflicts
git diff --name-only --diff-filter=U

# Show conflict markers in a specific file
git diff <filename>

# Show the three versions (base, ours, theirs) for a file
git show :1:<filename>   # base (common ancestor)
git show :2:<filename>   # ours (current branch / HEAD)
git show :3:<filename>   # theirs (incoming)
```

---

## Common Conflict Patterns

### Pattern 1: Lockfiles

**Files:** `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Pipfile.lock`, `poetry.lock`, `go.sum`, `Gemfile.lock`

**Problem:** Lockfiles are generated, not hand-written. Manual merging almost always produces an invalid file.

**Resolution:**
1. Accept either version (or delete the file)
2. Regenerate with the package manager
3. Stage the regenerated file

```bash
# Node.js
rm package-lock.json && npm install

# Python (pip)
pip install -r requirements.txt

# Go
go mod tidy

# Ruby
bundle install
```

**Never** manually edit a lockfile to resolve conflicts.

---

### Pattern 2: Import / Use Statement Ordering

**Files:** Any source file where both branches added imports

**Example:**
```
<<<<<<< HEAD
import "fmt"
import "log"
=======
import "fmt"
import "os"
>>>>>>> feature/other
```

**Resolution:** Accept both sets of imports, remove duplicates, sort alphabetically (or follow the project's import grouping convention).

```go
import (
    "fmt"
    "log"
    "os"
)
```

---

### Pattern 3: Adjacent Line Edits

Two developers edited different lines in the same function, but close enough that git considers it a conflict.

**Example:**
```
<<<<<<< HEAD
func ProcessOrder(ctx context.Context, orderID string, timeout time.Duration) error {
=======
func ProcessOrder(ctx context.Context, orderID string, userID string) error {
>>>>>>> feature/user-tracking
```

**Resolution:** Both changes are typically needed — merge them manually.

```go
func ProcessOrder(ctx context.Context, orderID string, userID string, timeout time.Duration) error {
```

Verify that callers are updated to pass both new parameters.

---

### Pattern 4: Deleted-vs-Modified

One branch deleted a file or function; the other modified it.

**Diagnosis:**
```bash
# See what happened on each side
git log --oneline --diff-filter=D HEAD..MERGE_HEAD -- <file>  # deleted on incoming
git log --oneline --diff-filter=M MERGE_HEAD..HEAD -- <file>  # modified on ours
```

**Resolution:** Determine which intent wins:
- If the deletion is correct (the thing was removed intentionally), apply the deletion and update any callers that the modified version was preparing for
- If the modification is correct (the thing should still exist), restore the file and apply the modification, then communicate with the author of the deletion

---

### Pattern 5: Config File Additions

Both branches added new configuration keys to the same config block.

**Example:**
```yaml
<<<<<<< HEAD
database:
  host: localhost
  port: 5432
  timeout: 30s
=======
database:
  host: localhost
  port: 5432
  pool_size: 10
>>>>>>> feature/db-pooling
```

**Resolution:** Accept both new keys — they are additive and compatible.

```yaml
database:
  host: localhost
  port: 5432
  timeout: 30s
  pool_size: 10
```

---

### Pattern 6: Schema / Migration Files

**Problem:** Two migrations were created with overlapping sequence numbers or modifying the same table.

**Resolution:**
1. Determine the correct ordering of the two changes
2. Renumber the conflicting migration if necessary
3. Verify the combined migrations produce the correct final schema
4. Test by running both migrations on a clean database

---

## Merge vs Rebase Differences

| Situation | What "ours" means | What "theirs" means |
|-----------|-------------------|---------------------|
| `git merge <branch>` | Your current branch (HEAD) | The branch being merged in |
| `git rebase <upstream>` | The upstream branch (target) | **Your commits** being replayed |
| `git cherry-pick` | Your current branch | The commit being picked |

The rebase inversion is the most common source of confusion. When rebasing `feature` onto `main`, "ours" is `main` and "theirs" is your `feature` changes.

---

## Resolution Workflow

```
1. git status                          # Identify conflicted files
2. (for each file)
   a. git diff <file>                  # Read the conflict
   b. Determine resolution strategy    # From patterns above
   c. Edit the file to resolved state  # Remove all markers
   d. git add <file>                   # Mark as resolved
3. git diff --check                    # Verify no markers remain
4. git merge --continue                # Or: git rebase --continue
   (or: git cherry-pick --continue)
```

---

## Post-Resolution Verification

After resolving all conflicts:

```bash
# Verify no conflict markers remain in tracked files
git diff --check

# Run the test suite
# (project-specific — use your test runner)

# Review the final diff
git diff HEAD

# Confirm the history looks correct
git log --oneline -10 --graph
```

If tests fail after resolution, the merge logic may be incorrect even if git was satisfied. Review the merged code carefully before committing.

---

## Aborting a Merge or Rebase

If the conflict is too complex or you need to start over:

```bash
# Abort an in-progress merge
git merge --abort

# Abort an in-progress rebase
git rebase --abort

# Abort an in-progress cherry-pick
git cherry-pick --abort
```

This returns the repository to the state before the operation began. No data is lost.

---

## Tools

| Tool | Command | Description |
|------|---------|-------------|
| Built-in 3-way | `git mergetool` | Opens configured merge tool |
| VS Code | Open conflicted file | Inline "Accept Current / Incoming / Both" buttons |
| vimdiff | `git mergetool -t vimdiff` | Terminal 3-way diff |
| IntelliJ | Open conflicted file → Resolve Conflicts | Full 3-panel merge UI |

Configure a default tool: `git config --global merge.tool <tool>`
