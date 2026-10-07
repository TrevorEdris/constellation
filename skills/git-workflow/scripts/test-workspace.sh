#!/usr/bin/env bash
# test-workspace.sh — Regression tests for workspace.sh
#
# Why this exists: finishing a branch went wrong in ways prose cannot pin down:
# directories compared before canonicalizing made a normal repo look like a
# worktree, the main checkout was taken from the wrong git command, and a piped
# `grep -q` under pipefail reported "no PR history" for a repo that had it.
# Every case here builds a real git repo and runs the real script, so the exact
# code the agent runs is what gets tested. No network, no `gh`.
#
# Usage: test-workspace.sh        (any working directory)
#
# Output:
#   ok / not ok  per case, then "passed: N  failed: M"
#
# Exit codes:
#   0  - All cases passed
#   1  - One or more cases failed
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/workspace.sh"

PASSED=0
FAILED=0

# ── Hermetic git environment ──────────────────────────────────────────────────
# Temp repos live under a canonical path (macOS /var is a symlink to /private/var,
# and the script prints canonical paths). Ambient git state must not leak in.

TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
# Never let repo discovery climb out of the temp dir into a real repository;
# the "outside a repo" case depends on it.
export GIT_CEILING_DIRECTORIES="$TMP"

CASE_N=0     # sandbox counter: each repo setup gets its own directory
SB=""        # current sandbox directory
REPO=""      # main checkout inside the sandbox
WT=""        # most recently added worktree
OUT=""       # stdout of the last run
ERR=""       # stderr of the last run
RC=0         # exit status of the last run

# ── Helpers ───────────────────────────────────────────────────────────────────

die() {
  echo "setup failed: $*" >&2
  exit 1
}

# Setup git: fixed identity, no signing, main as the default branch.
g() {
  git -c user.name=test -c user.email=test@example.com \
    -c commit.gpgsign=false -c init.defaultBranch=main "$@"
}

# The script under test gets the same four settings through the environment
# (the env form of -c), so its own git calls can commit and merge.
ws() {
  env GIT_CONFIG_COUNT=4 \
    GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=test \
    GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1=test@example.com \
    GIT_CONFIG_KEY_2=commit.gpgsign GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=init.defaultBranch GIT_CONFIG_VALUE_3=main \
    bash "$TARGET" "$@"
}

# commit <dir> <subject> — empty commit; only the subject matters here.
commit() {
  g -C "$1" commit -q --allow-empty -m "$2" || die "commit '$2' in $1"
}

# new_repo [branch] — fresh sandbox with a one-commit repo at $REPO.
new_repo() {
  local branch="${1:-main}"
  CASE_N=$((CASE_N + 1))
  SB="$TMP/c$CASE_N"
  REPO="$SB/repo"
  mkdir -p "$SB" || die "mkdir $SB"
  g init -q -b "$branch" "$REPO" || die "git init $REPO"
  commit "$REPO" "init"
}

# add_wt <relpath> <branch> — worktree at $SB/<relpath> on a new branch, or a
# detached one when <branch> is --detach. Sets $WT.
add_wt() {
  WT="$SB/$1"
  if [ "$2" = "--detach" ]; then
    g -C "$REPO" worktree add -q --detach "$WT" || die "worktree add $WT"
  else
    g -C "$REPO" worktree add -q -b "$2" "$WT" || die "worktree add $WT"
  fi
}

# detect_in <dir> [args...] — run `workspace.sh detect` from <dir>.
# Sets OUT, ERR, RC.
detect_in() {
  local dir="$1"
  shift
  OUT="$(cd "$dir" && ws detect "$@" 2>"$TMP/stderr")"
  RC=$?
  ERR="$(cat "$TMP/stderr")"
}

# kv <KEY> — the value of KEY=value from the last run's stdout.
kv() {
  sed -n "s/^$1=//p" <<<"$OUT"
}

# Per-case bookkeeping: assertions accumulate, finish reports once.
CASE_NAME=""
CASE_FAILED=0
CASE_DETAIL=""

begin() {
  CASE_NAME="$1"
  CASE_FAILED=0
  CASE_DETAIL=""
}

assert_eq() {
  # assert_eq <label> <expected> <actual>
  if [ "$2" != "$3" ]; then
    CASE_FAILED=1
    CASE_DETAIL="$CASE_DETAIL"$'\n'"           $1: expected '$2', got '$3'"
  fi
}

assert_contains() {
  # assert_contains <label> <needle> <haystack>
  case "$3" in
    *"$2"*) ;;
    *)
      CASE_FAILED=1
      CASE_DETAIL="$CASE_DETAIL"$'\n'"           $1: expected to contain '$2', got '$3'"
      ;;
  esac
}

finish() {
  if [ "$CASE_FAILED" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    echo "ok       $CASE_NAME"
  else
    FAILED=$((FAILED + 1))
    echo "not ok   $CASE_NAME"
    printf '%s\n' "${CASE_DETAIL#$'\n'}"
  fi
}

# ── Cases: where the workspace is ─────────────────────────────────────────────

# From a subdirectory, --git-dir is absolute but --git-common-dir is relative.
# Comparing them before canonicalizing calls a normal repo a worktree.
begin "detect: normal repo, from a subdirectory"
new_repo
mkdir -p "$REPO/sub/dir"
detect_in "$REPO/sub/dir"
assert_eq "exit" 0 "$RC"
assert_eq "ISOLATION" none "$(kv ISOLATION)"
assert_eq "HEAD" branch "$(kv HEAD)"
assert_eq "BRANCH" main "$(kv BRANCH)"
assert_eq "GIT_DIR" "$REPO/.git" "$(kv GIT_DIR)"
assert_eq "GIT_COMMON" "$REPO/.git" "$(kv GIT_COMMON)"
assert_eq "WORKTREE_PATH" "$REPO" "$(kv WORKTREE_PATH)"
assert_eq "MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq "CLEANUP" none "$(kv CLEANUP)"
finish

# MAIN_ROOT must be the main checkout. --show-toplevel inside a worktree names
# the worktree itself, which is the directory about to be removed.
begin "detect: named worktree under .worktrees"
new_repo
add_wt repo/.worktrees/x feat/x
detect_in "$WT"
assert_eq "exit" 0 "$RC"
assert_eq "ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "HEAD" branch "$(kv HEAD)"
assert_eq "BRANCH" feat/x "$(kv BRANCH)"
assert_eq "GIT_DIR" "$REPO/.git/worktrees/x" "$(kv GIT_DIR)"
assert_eq "GIT_COMMON" "$REPO/.git" "$(kv GIT_COMMON)"
assert_eq "WORKTREE_PATH" "$WT" "$(kv WORKTREE_PATH)"
assert_eq "MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq "CLEANUP" git "$(kv CLEANUP)"
finish

begin "detect: .claude/worktrees is git-cleaned"
new_repo
add_wt repo/.claude/worktrees/y fix/y
detect_in "$WT"
assert_eq "ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq "CLEANUP" git "$(kv CLEANUP)"
finish

begin "detect: worktrees/ under the main checkout is git-cleaned"
new_repo
add_wt repo/worktrees/p feat/p
detect_in "$WT"
assert_eq "CLEANUP" git "$(kv CLEANUP)"
finish

# A host (IDE, harness) that places worktrees itself will clean them up itself.
begin "detect: sibling worktree is host-owned"
new_repo
add_wt wt-sibling feat/s
detect_in "$WT"
assert_eq "ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "BRANCH" feat/s "$(kv BRANCH)"
assert_eq "MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq "CLEANUP" host "$(kv CLEANUP)"
finish

# A name that merely starts like a managed directory is not one.
begin "detect: lookalike directory is host-owned"
new_repo
add_wt repo/.worktrees-old/q feat/q
detect_in "$WT"
assert_eq "CLEANUP" host "$(kv CLEANUP)"
finish

# The managed directories only count under the main checkout. A worktrees/ or
# .claude/worktrees/ directory elsewhere belongs to whoever made it; reading it
# as git-cleaned would let the agent remove a directory the host owns.
begin "detect: worktrees dir outside the main checkout is host-owned"
new_repo
add_wt other/worktrees/o feat/o
detect_in "$WT"
assert_eq "worktrees/: ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "worktrees/: MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq "worktrees/: CLEANUP" host "$(kv CLEANUP)"
add_wt other/.claude/worktrees/p feat/p
detect_in "$WT"
assert_eq ".claude/worktrees/: ISOLATION" worktree "$(kv ISOLATION)"
assert_eq ".claude/worktrees/: MAIN_ROOT" "$REPO" "$(kv MAIN_ROOT)"
assert_eq ".claude/worktrees/: CLEANUP" host "$(kv CLEANUP)"
finish

# Detached beats location: the path rule alone would say git.
begin "detect: detached worktree"
new_repo
add_wt repo/.worktrees/d --detach
detect_in "$WT"
assert_eq "exit" 0 "$RC"
assert_eq "ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "HEAD" detached "$(kv HEAD)"
assert_eq "BRANCH" "" "$(kv BRANCH)"
assert_eq "CLEANUP" host "$(kv CLEANUP)"
finish

# Characterization only: git-dir equals common-dir inside a submodule, so this
# passes even without the superproject guard.
begin "detect: submodule reads as a normal repo"
new_repo
g init -q "$SB/libsrc" || die "git init libsrc"
commit "$SB/libsrc" "lib init"
g -c protocol.file.allow=always -C "$REPO" submodule add -q "$SB/libsrc" libs/sub \
  >/dev/null 2>&1 || die "submodule add"
detect_in "$REPO/libs/sub"
assert_eq "exit" 0 "$RC"
assert_eq "ISOLATION" none "$(kv ISOLATION)"
assert_eq "GIT_DIR is GIT_COMMON" "$(kv GIT_COMMON)" "$(kv GIT_DIR)"
assert_eq "WORKTREE_PATH" "$REPO/libs/sub" "$(kv WORKTREE_PATH)"
assert_eq "MAIN_ROOT" "$REPO/libs/sub" "$(kv MAIN_ROOT)"
assert_eq "CLEANUP" none "$(kv CLEANUP)"
finish

# The directory above the common dir is only the main checkout if it really
# owns that common dir. Bare repos have no checkout; a different repo above
# the bare repo must not be mistaken for one. Both must read as host-owned
# with MAIN_ROOT empty, never a guess.
begin "detect: MAIN_ROOT is empty when the common dir has no checkout"
new_repo
g clone -q --bare "$REPO" "$SB/bare.git" || die "bare clone"
g -C "$SB/bare.git" worktree add -q -b feat/b "$SB/wt-bare" || die "bare worktree"
detect_in "$SB/wt-bare"
assert_eq "bare: ISOLATION" worktree "$(kv ISOLATION)"
assert_eq "bare: GIT_COMMON" "$SB/bare.git" "$(kv GIT_COMMON)"
assert_eq "bare: MAIN_ROOT" "" "$(kv MAIN_ROOT)"
assert_eq "bare: CLEANUP" host "$(kv CLEANUP)"
g init -q "$SB/box" || die "git init box"
g clone -q --bare "$REPO" "$SB/box/bare.git" || die "bare clone in box"
g -C "$SB/box/bare.git" worktree add -q -b feat/c "$SB/wt-box" || die "box worktree"
detect_in "$SB/wt-box"
assert_eq "other repo above: GIT_COMMON" "$SB/box/bare.git" "$(kv GIT_COMMON)"
assert_eq "other repo above: MAIN_ROOT" "" "$(kv MAIN_ROOT)"
assert_eq "other repo above: CLEANUP" host "$(kv CLEANUP)"
finish

# ── Cases: output shape ───────────────────────────────────────────────────────

# Callers parse by key, but the printed order is part of the interface. An
# empty-valued state (detached, no base, no remote) must still print every key.
begin "detect: keys print in C4 order"
new_repo trunk
add_wt repo/.worktrees/k --detach
detect_in "$WT"
keys="$(sed 's/=.*//' <<<"$OUT" | paste -sd, -)"
assert_eq "keys" \
  "ISOLATION,HEAD,BRANCH,BASE,GIT_DIR,GIT_COMMON,WORKTREE_PATH,MAIN_ROOT,CLEANUP,REMOTE,DELIVERY" \
  "$keys"
finish

begin "detect: extra or option-like arguments exit 2"
new_repo
detect_in "$REPO" main extra
assert_eq "two args: exit" 2 "$RC"
assert_eq "two args: stdout" "" "$OUT"
detect_in "$REPO" -x
assert_eq "option: exit" 2 "$RC"
assert_eq "option: stdout" "" "$OUT"
finish

begin "detect: outside a repo exits 2"
mkdir -p "$TMP/notrepo"
detect_in "$TMP/notrepo"
assert_eq "exit" 2 "$RC"
assert_eq "stdout" "" "$OUT"
assert_contains "stderr" "git work tree" "$ERR"
finish

begin "usage: missing or unknown subcommand exits 2"
OUT="$(cd "$TMP" && ws 2>"$TMP/stderr")"
RC=$?
ERR="$(cat "$TMP/stderr")"
assert_eq "no args: exit" 2 "$RC"
assert_contains "no args: stderr" "Usage: workspace.sh" "$ERR"
OUT="$(cd "$TMP" && ws frobnicate 2>"$TMP/stderr")"
RC=$?
ERR="$(cat "$TMP/stderr")"
assert_eq "unknown: exit" 2 "$RC"
assert_eq "unknown: stdout" "" "$OUT"
assert_contains "unknown: stderr" "frobnicate" "$ERR"
finish

# ── Cases: base branch ────────────────────────────────────────────────────────

begin "detect: BASE fallbacks"
new_repo
detect_in "$REPO" develop
assert_eq "arg wins over main" develop "$(kv BASE)"
detect_in "$REPO"
assert_eq "main when no arg" main "$(kv BASE)"
g -C "$REPO" branch master || die "branch master"
detect_in "$REPO"
assert_eq "main beats master" main "$(kv BASE)"
new_repo master
detect_in "$REPO"
assert_eq "master when no main" master "$(kv BASE)"
new_repo trunk
detect_in "$REPO"
assert_eq "empty when neither" "" "$(kv BASE)"
assert_eq "empty BASE still exits 0" 0 "$RC"
finish

# ── Cases: remote and delivery ────────────────────────────────────────────────

begin "detect: remote means PR delivery"
new_repo
g init -q --bare "$SB/origin.git" || die "bare origin"
g -C "$REPO" remote add origin "$SB/origin.git" || die "remote add"
detect_in "$REPO"
assert_eq "REMOTE" origin "$(kv REMOTE)"
assert_eq "DELIVERY" pr "$(kv DELIVERY)"
# origin is preferred even when another remote sorts first.
g -C "$REPO" remote add alpha "$SB/origin.git" || die "remote add alpha"
detect_in "$REPO"
assert_eq "origin preferred over alpha" origin "$(kv REMOTE)"
finish

begin "detect: first remote without origin"
new_repo
g init -q --bare "$SB/upstream.git" || die "bare upstream"
g -C "$REPO" remote add upstream "$SB/upstream.git" || die "remote add"
detect_in "$REPO"
assert_eq "REMOTE" upstream "$(kv REMOTE)"
assert_eq "DELIVERY" pr "$(kv DELIVERY)"
finish

# No remote at all: merged-PR subjects are the only evidence.
begin "detect: PR subjects mean PR delivery"
new_repo
commit "$REPO" "feat: x (#3)"
detect_in "$REPO"
assert_eq "REMOTE" "" "$(kv REMOTE)"
assert_eq "squash subject (#3)" pr "$(kv DELIVERY)"
new_repo
commit "$REPO" "Merge pull request #7 from a/b"
detect_in "$REPO"
assert_eq "merge subject #7" pr "$(kv DELIVERY)"
finish

# Six own commits push the (#4) subject out of HEAD's last five. It is still on
# the base branch. Scanning HEAD only misses it; so does a piped `grep -q`
# under pipefail, where the early exit kills the writer and the match becomes
# "no match".
begin "detect: BASE history counts"
new_repo
commit "$REPO" "feat: seed (#4)"
add_wt repo/.worktrees/w feat/w
for i in 1 2 3 4 5 6; do commit "$WT" "work $i"; done
assert_eq "setup: (#4) is outside HEAD's last 5" 0 \
  "$(g -C "$WT" log -5 --format=%s | grep -c '(#4)')"
detect_in "$WT"
assert_eq "REMOTE" "" "$(kv REMOTE)"
assert_eq "DELIVERY" pr "$(kv DELIVERY)"
finish

# With no main or master there is no BASE to scan, so HEAD's own subjects are
# the only evidence. Dropping the HEAD scan would read this squash-merge repo as
# local and permit the local merge the PR flow forbids.
begin "detect: HEAD subjects count when BASE is empty"
new_repo trunk
commit "$REPO" "feat: x (#3)"
detect_in "$REPO"
assert_eq "BASE" "" "$(kv BASE)"
assert_eq "REMOTE" "" "$(kv REMOTE)"
assert_eq "DELIVERY" pr "$(kv DELIVERY)"
finish

# Issue numbers without parentheses and plain merges are not PR evidence.
begin "detect: no remote and no PR subjects means local"
new_repo
commit "$REPO" "docs: mention issue #12"
commit "$REPO" "Merge branch 'feature/x'"
detect_in "$REPO"
assert_eq "REMOTE" "" "$(kv REMOTE)"
assert_eq "DELIVERY" local "$(kv DELIVERY)"
finish

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ]
