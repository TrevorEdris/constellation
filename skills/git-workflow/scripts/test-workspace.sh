#!/usr/bin/env bash
# test-workspace.sh — Regression tests for workspace.sh
#
# Why this exists: finishing a branch went wrong in ways prose cannot pin down:
# directories compared before canonicalizing made a normal repo look like a
# worktree, the main checkout was taken from the wrong git command, and a piped
# `grep -q` under pipefail reported "no PR history" for a repo that had it.
# merge-local adds its own: a local merge into a repo that ships by PR, a
# checkout run in the worktree where the base is already taken, and a plan flag
# taken on trust. cleanup adds more: a branch deleted before the worktree that
# holds it is removed, and git's force flag deleting a file the user had not
# committed. Every case here builds a real git repo and runs the real script, so
# the exact code the agent runs is what gets tested. No network, no `gh`.
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
# (the env form of -c), so its own git calls can commit and merge. A fifth,
# pull.rebase=true, makes a diverged `git pull` succeed by rebasing unless the
# script passes --ff-only itself, so a pull that lost its flag shows up as a
# changed base instead of hiding behind git's own "reconcile" error.
ws() {
  env GIT_CONFIG_COUNT=5 \
    GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=test \
    GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1=test@example.com \
    GIT_CONFIG_KEY_2=commit.gpgsign GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=init.defaultBranch GIT_CONFIG_VALUE_3=main \
    GIT_CONFIG_KEY_4=pull.rebase GIT_CONFIG_VALUE_4=true \
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

# merge_in <dir> [args...] — run `workspace.sh merge-local` from <dir>.
# Sets OUT, ERR, RC.
merge_in() {
  local dir="$1"
  shift
  OUT="$(cd "$dir" && ws merge-local "$@" 2>"$TMP/stderr")"
  RC=$?
  ERR="$(cat "$TMP/stderr")"
}

# cleanup_in <dir> [args...] — run `workspace.sh cleanup` from <dir>.
# Sets OUT, ERR, RC.
cleanup_in() {
  local dir="$1"
  shift
  OUT="$(cd "$dir" && ws cleanup "$@" 2>"$TMP/stderr")"
  RC=$?
  ERR="$(cat "$TMP/stderr")"
}

# kv <KEY> — the value of KEY=value from the last run's stdout.
kv() {
  sed -n "s/^$1=//p" <<<"$OUT"
}

# has <KEY> — "yes" when the last run printed a KEY= line, even an empty one.
has() {
  case $'\n'"$OUT" in
    *$'\n'"$1="*) echo yes ;;
    *) echo no ;;
  esac
}

# commit_file <dir> <file> <content> <subject> — commit one file.
commit_file() {
  printf '%s\n' "$3" >"$1/$2" || die "write $1/$2"
  g -C "$1" add "$2" || die "add $2"
  g -C "$1" commit -q -m "$4" || die "commit '$4' in $1"
}

# new_feature [remote] — new_repo plus a tracked file on main, and a worktree
# $WT on feat/w with one commit that adds feature.txt. With "remote", main also
# tracks a bare origin, which makes the repo PR-based. Sets $MAIN_SHA.
new_feature() {
  new_repo
  commit_file "$REPO" tracked.txt base "add tracked"
  if [ "${1:-}" = remote ]; then
    g init -q --bare "$SB/origin.git" || die "bare origin"
    g -C "$REPO" remote add origin "$SB/origin.git" || die "remote add"
    g -C "$REPO" push -q -u origin main || die "push main"
  fi
  add_wt repo/.worktrees/w feat/w
  commit_file "$WT" feature.txt feature "add feature"
  MAIN_SHA="$(g -C "$REPO" rev-parse main)"
}

# diverge_main — put a commit on main that feat/w lacks, so merging makes a real
# merge commit. Call it while the main checkout is still on main. Updates $MAIN_SHA.
diverge_main() {
  commit_file "$REPO" mainline.txt mainline "add mainline"
  MAIN_SHA="$(g -C "$REPO" rev-parse main)"
}

# park_main — move the main checkout off main, onto a new branch "other".
park_main() {
  g -C "$REPO" checkout -q -b other || die "checkout -b other"
}

# is_merged <branch> <into> — "yes" when <branch> is an ancestor of <into>.
is_merged() {
  if g -C "$REPO" merge-base --is-ancestor "$1" "$2"; then echo yes; else echo no; fi
}

# exists <path> — "yes" or "no".
exists() {
  if [ -e "$1" ]; then echo yes; else echo no; fi
}

# has_branch <branch> — "yes" when <branch> is a local branch of $REPO.
has_branch() {
  if g -C "$REPO" show-ref --verify --quiet "refs/heads/$1"; then echo yes; else echo no; fi
}

# land_feature — fast-forward main to feat/w, the state after a finished merge.
# cleanup only removes work that main already holds. Call it while the main
# checkout is still on main.
land_feature() {
  g -C "$REPO" merge -q --ff-only feat/w || die "merge feat/w into main"
}

# write_plan <file> <status> <repo> <mode> — a plan whose single delivery item
# is <repo> / <mode>. <status> goes in verbatim, so it can carry a comment.
write_plan() {
  cat >"$1" <<EOF
---
schema: plan/v3
date: 2026-10-07
slug: t
status: $2
delivery:
  - repo: $3
    mode: $4
    branch: feat/w
    base: main
    remote: none
    prs: 0
tags: [t]
---
# Plan

Body text.
EOF
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

# ── Cases: merge-local ────────────────────────────────────────────────────────

# The seed incident: a local merge into a repo that ships by PR. Both signals
# (a remote, merged-PR subjects) must refuse before anything moves: the base
# keeps its SHA and the main checkout stays on the branch the user left it on.
begin "merge-local: refuses PR-based repo"
new_feature remote
park_main
merge_in "$WT" main feat/w -- true
assert_eq "remote: exit" 4 "$RC"
assert_contains "remote: REFUSED" "PR-based repo" "$(kv REFUSED)"
assert_contains "remote: REFUSED names the fix" "open a PR instead" "$(kv REFUSED)"
assert_eq "remote: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "remote: main checkout untouched" other "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "remote: nothing reported as moved" no "$(has PREVIOUS_BRANCH)"
new_feature
commit "$REPO" "feat: seed (#4)"
MAIN_SHA="$(g -C "$REPO" rev-parse main)"
merge_in "$WT" main feat/w -- true
assert_eq "PR subjects: exit" 4 "$RC"
assert_eq "PR subjects: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
finish

# Run from the worktree, with the main checkout on another branch. The checkout
# and merge must happen in the main checkout: base is free there, and the
# worktree's own checkout of it would be the wrong directory.
begin "merge-local: works from inside the worktree"
new_feature
park_main
merge_in "$WT" main feat/w -- true
assert_eq "exit" 0 "$RC"
assert_eq "PREVIOUS_BRANCH" other "$(kv PREVIOUS_BRANCH)"
assert_eq "feat/w is an ancestor of main" yes "$(is_merged feat/w main)"
assert_eq "MERGED is main's tip" "$(g -C "$REPO" rev-parse main)" "$(kv MERGED)"
assert_eq "main checkout is left on the base" main "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "worktree kept" yes "$(exists "$WT")"
assert_eq "branch kept" feat/w "$(g -C "$REPO" branch --list feat/w --format='%(refname:short)')"
finish

# Base already checked out in the main checkout: `git checkout main` in the
# worktree would exit 128 ("already checked out"). The main checkout is where
# the checkout has to run.
begin "merge-local: works when the main checkout already sits on the base"
new_feature
merge_in "$WT" main feat/w -- true
assert_eq "exit" 0 "$RC"
assert_eq "PREVIOUS_BRANCH" main "$(kv PREVIOUS_BRANCH)"
assert_eq "feat/w is an ancestor of main" yes "$(is_merged feat/w main)"
finish

begin "merge-local: detached main checkout reports an empty PREVIOUS_BRANCH"
new_feature
g -C "$REPO" checkout -q --detach || die "detach"
merge_in "$WT" main feat/w -- true
assert_eq "exit" 0 "$RC"
assert_eq "PREVIOUS_BRANCH printed" yes "$(has PREVIOUS_BRANCH)"
assert_eq "PREVIOUS_BRANCH empty" "" "$(kv PREVIOUS_BRANCH)"
assert_eq "main checkout is on the base" main "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "feat/w is an ancestor of main" yes "$(is_merged feat/w main)"
finish

# The documented path: cd to the main checkout, which is on the feature branch
# itself when there is no worktree.
begin "merge-local: works from the main checkout"
new_repo
commit_file "$REPO" tracked.txt base "add tracked"
g -C "$REPO" checkout -q -b feat/x || die "checkout feat/x"
commit_file "$REPO" feature.txt feature "add feature"
merge_in "$REPO" main feat/x -- true
assert_eq "exit" 0 "$RC"
assert_eq "PREVIOUS_BRANCH" feat/x "$(kv PREVIOUS_BRANCH)"
assert_eq "feat/x is an ancestor of main" yes "$(is_merged feat/x main)"
assert_eq "main checkout is on the base" main "$(g -C "$REPO" symbolic-ref --short HEAD)"
finish

# The tests judge the merged result, from the main checkout, with the command's
# own arguments intact. Their output must not mix into the KEY=value lines.
begin "merge-local: tests run in the main checkout on the merged result"
new_feature
diverge_main
park_main
merge_in "$WT" main feat/w -- bash -c \
  'pwd -P >"$1"; ls | paste -sd, - >>"$1"; printf "%s\n" "$2" >>"$1"; echo NOISE=from-tests' \
  _ "$TMP/ran.out" "two words"
assert_eq "exit" 0 "$RC"
assert_eq "cwd, files, argument" \
  "$REPO"$'\n'"feature.txt,mainline.txt,tracked.txt"$'\n'"two words" "$(cat "$TMP/ran.out")"
assert_eq "test output stays off stdout" no "$(has NOISE)"
assert_contains "test output reaches stderr" "NOISE=from-tests" "$ERR"
finish

# Exit 5 leaves the merge in place for the caller to inspect, keeps the worktree
# and branch, and prints an UNDO that really restores the pre-merge base.
begin "merge-local: failing tests keep worktree and branch"
new_feature
diverge_main
park_main
merge_in "$WT" main feat/w -- false
assert_eq "exit" 5 "$RC"
assert_contains "REFUSED" "tests" "$(kv REFUSED)"
assert_eq "KEPT_BRANCH" feat/w "$(kv KEPT_BRANCH)"
assert_eq "UNDO" "git -C $REPO reset --merge $MAIN_SHA" "$(kv UNDO)"
assert_eq "worktree kept" yes "$(exists "$WT")"
assert_eq "branch kept" feat/w "$(g -C "$REPO" branch --list feat/w --format='%(refname:short)')"
assert_eq "merge is in place" yes "$(is_merged feat/w main)"
eval "$(kv UNDO)" >/dev/null 2>&1
assert_eq "UNDO restores the base" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
finish

# Tracked changes in the main checkout would ride along into the base or block
# the merge. Untracked files neither move nor merge, so they do not block.
begin "merge-local: dirty main checkout refuses"
new_feature
park_main
printf 'edit\n' >"$REPO/tracked.txt"
merge_in "$WT" main feat/w -- true
assert_eq "exit" 3 "$RC"
assert_contains "BLOCKING names the file" "tracked.txt" "$(kv BLOCKING)"
assert_contains "REFUSED" "uncommitted" "$(kv REFUSED)"
assert_eq "base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "main checkout untouched" other "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "edit still there" edit "$(cat "$REPO/tracked.txt")"
new_feature
printf 'scratch\n' >"$REPO/untracked.txt"
merge_in "$WT" main feat/w -- true
assert_eq "untracked file: exit" 0 "$RC"
finish

begin "merge-local: conflict aborts cleanly"
new_feature
commit_file "$WT" tracked.txt feature "feature edit"
commit_file "$REPO" tracked.txt mainline "mainline edit"
MAIN_SHA="$(g -C "$REPO" rev-parse main)"
park_main
merge_in "$WT" main feat/w -- true
assert_eq "exit" 1 "$RC"
assert_contains "REFUSED" "feat/w" "$(kv REFUSED)"
assert_eq "no MERGE_HEAD" no \
  "$(g -C "$REPO" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && echo yes || echo no)"
assert_eq "base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "tracked files clean" "" "$(g -C "$REPO" status --porcelain -uno)"
assert_eq "tests never ran, so no MERGED" no "$(has MERGED)"
finish

# A checkout that git refuses must stop the run. Carrying on would merge into
# whatever the main checkout is on (here `other`) and report that as a merge of
# the base. Two real causes: the base is held by a second worktree, and an
# untracked file that the base tracks.
begin "merge-local: checkout failure refuses without merging"
new_feature
park_main
OTHER_SHA="$(g -C "$REPO" rev-parse other)"
g -C "$REPO" worktree add -q "$SB/wm" main || die "worktree add wm on main"
merge_in "$WT" main feat/w -- true
assert_eq "base held by another worktree: exit" 1 "$RC"
assert_contains "base held: REFUSED" "check out" "$(kv REFUSED)"
assert_eq "base held: no MERGED" no "$(has MERGED)"
assert_eq "base held: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "base held: other unchanged" "$OTHER_SHA" "$(g -C "$REPO" rev-parse other)"
assert_eq "base held: main checkout untouched" other "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "base held: branch not merged" no "$(is_merged feat/w other)"
new_feature
park_main
g -C "$REPO" checkout -q main || die "checkout main"
commit_file "$REPO" clash.txt tracked "add clash"
MAIN_SHA="$(g -C "$REPO" rev-parse main)"
g -C "$REPO" checkout -q other || die "checkout other"
OTHER_SHA="$(g -C "$REPO" rev-parse other)"
printf 'mine\n' >"$REPO/clash.txt"
merge_in "$WT" main feat/w -- true
assert_eq "untracked clash: exit" 1 "$RC"
assert_contains "untracked clash: REFUSED" "check out" "$(kv REFUSED)"
assert_eq "untracked clash: no MERGED" no "$(has MERGED)"
assert_eq "untracked clash: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "untracked clash: other unchanged" "$OTHER_SHA" "$(g -C "$REPO" rev-parse other)"
assert_eq "untracked clash: file kept" mine "$(cat "$REPO/clash.txt")"
assert_eq "untracked clash: branch not merged" no "$(is_merged feat/w other)"
finish

# ── Cases: merge-local and the approved local-only plan ───────────────────────

# A PR-based repo can be merged locally only when the plan the user approved
# says so for this repo. The plan is read by the script, not taken on trust.
begin "merge-local: approved local-only plan overrides remote"
new_feature remote
write_plan "$SB/PLAN.md" "approved  # ok" "$REPO" local-only
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "main checkout path, 'approved  # ok': exit" 0 "$RC"
assert_eq "main checkout path: merged" yes "$(is_merged feat/w main)"
new_feature remote
write_plan "$SB/PLAN.md" '"in-progress"' "$WT" local-only
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "worktree path, quoted in-progress: exit" 0 "$RC"
assert_eq "worktree path: merged" yes "$(is_merged feat/w main)"
new_feature remote
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery:
  - repo: $SB/elsewhere
    mode: pr
    prs: 1
  - repo: $REPO
    mode: local-only
    prs: 0
---
EOF
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "second item qualifies: exit" 0 "$RC"
assert_eq "second item qualifies: merged" yes "$(is_merged feat/w main)"
new_feature remote
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery:
  - repo: $REPO
    mode: local-only
    prs: 0
  - repo: $SB/elsewhere
    mode: pr
    prs: 1
---
EOF
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "first item qualifies: exit" 0 "$RC"
assert_eq "first item qualifies: merged" yes "$(is_merged feat/w main)"
finish

# Each plan below is on disk and well-formed enough to read, and each must still
# be refused: a flag that merely named a file would let any of them through.
begin "merge-local: non-qualifying plans refuse"
new_feature remote
park_main
mkdir -p "$SB/elsewhere"
refuse_with() { # <label> — expect a refusal using the plan already at $SB/PLAN.md
  merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
  assert_eq "$1: exit" 4 "$RC"
  assert_eq "$1: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
}
write_plan "$SB/PLAN.md" awaiting-approval "$REPO" local-only
refuse_with "status awaiting-approval"
write_plan "$SB/PLAN.md" "awaiting-approval  # approved" "$REPO" local-only
refuse_with "status comment is not the status"
write_plan "$SB/PLAN.md" complete "$REPO" local-only
refuse_with "status complete"
write_plan "$SB/PLAN.md" approved "$REPO" pr
refuse_with "mode pr"
write_plan "$SB/PLAN.md" approved "$SB/elsewhere" local-only
refuse_with "another repo"
# From the worktree, "." would canonicalize to the worktree itself.
write_plan "$SB/PLAN.md" approved "." local-only
refuse_with "relative repo"
# Every delivery item in a plan names its repo. An item that does not, or names
# it with an empty value, is malformed and approves nothing: in a plan that
# covers several repos it could not say which one it meant.
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery:  # where it ships
  - mode: local-only
    remote: none
---
EOF
refuse_with "item without repo, commented delivery"
write_plan "$SB/PLAN.md" approved "" local-only
refuse_with "item with an empty repo"
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery:
  - repo: $SB/elsewhere
    mode: local-only
  - mode: local-only
    remote: none
---
EOF
refuse_with "item without repo beside another repo's item"
printf -- '---\nstatus: approved\n---\n# Legacy plan\n' >"$SB/PLAN.md"
refuse_with "legacy plan without delivery"
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery: [{repo: $REPO, mode: local-only}]
---
EOF
refuse_with "flow-form delivery"
cat >"$SB/PLAN.md" <<EOF
---
status: approved
---
# Plan

delivery:
  - repo: $REPO
    mode: local-only
tags: [t]
EOF
refuse_with "delivery outside the frontmatter"
cat >"$SB/PLAN.md" <<EOF
---
status: approved
delivery:
  - repo: $REPO
    mode: local-only
tags: [t]
EOF
refuse_with "unterminated frontmatter"
merge_in "$WT" main feat/w --plan "$SB/missing.md" -- true
assert_eq "missing file: exit" 4 "$RC"
assert_eq "missing file: base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
merge_in "$WT" main feat/w -- true
assert_eq "no --plan: exit" 4 "$RC"
finish

# An approved plan lifts the PR-based refusal only; the base still has to be
# brought up to date from its upstream first, or the merge lands on stale code.
begin "merge-local: fast-forwards base from its upstream first"
new_feature remote
g clone -q "$SB/origin.git" "$SB/clone" || die "clone origin"
commit_file "$SB/clone" upstream.txt upstream "add upstream"
g -C "$SB/clone" push -q origin main || die "push upstream commit"
UPSTREAM_SHA="$(g -C "$SB/clone" rev-parse HEAD)"
write_plan "$SB/PLAN.md" approved "$REPO" local-only
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "exit" 0 "$RC"
assert_eq "upstream commit is in main" yes "$(is_merged "$UPSTREAM_SHA" main)"
assert_eq "feat/w is in main" yes "$(is_merged feat/w main)"
finish

# When the base and its upstream have both moved, the pull cannot fast-forward.
# The merge must not run on that stale base. `ws` sets pull.rebase=true, so a
# pull without --ff-only would rebase main onto the upstream and succeed.
begin "merge-local: diverged upstream refuses"
new_feature remote
g clone -q "$SB/origin.git" "$SB/clone" || die "clone origin"
commit_file "$SB/clone" upstream.txt upstream "add upstream"
g -C "$SB/clone" push -q origin main || die "push upstream commit"
commit_file "$REPO" local.txt local "add local"
MAIN_SHA="$(g -C "$REPO" rev-parse main)"
write_plan "$SB/PLAN.md" approved "$REPO" local-only
merge_in "$WT" main feat/w --plan "$SB/PLAN.md" -- true
assert_eq "exit" 1 "$RC"
assert_contains "REFUSED" "fast-forward" "$(kv REFUSED)"
assert_eq "no MERGED" no "$(has MERGED)"
assert_eq "base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
assert_eq "branch not merged" no "$(is_merged feat/w main)"
assert_eq "tracked files clean" "" "$(g -C "$REPO" status --porcelain -uno)"
finish

# ── Cases: merge-local preconditions ──────────────────────────────────────────

begin "merge-local: usage errors exit 2"
new_feature
usage_case() { # <label> <args...> — expect exit 2, usage on stderr, nothing on stdout
  local label="$1"
  shift
  merge_in "$WT" "$@"
  assert_eq "$label: exit" 2 "$RC"
  assert_eq "$label: stdout" "" "$OUT"
  assert_contains "$label: stderr" "merge-local <base> <branch>" "$ERR"
}
usage_case "no branch" main
usage_case "no --" main feat/w
usage_case "no test command" main feat/w --
usage_case "unknown flag" main feat/w --bogus -- true
usage_case "--plan without a value" main feat/w --plan
usage_case "option-like base" -x feat/w -- true
usage_case "option-like branch" main -x -- true
mkdir -p "$TMP/notrepo"
merge_in "$TMP/notrepo" main feat/w -- true
assert_eq "outside a repo: exit" 2 "$RC"
assert_contains "outside a repo: stderr" "git work tree" "$ERR"
finish

# Without a main checkout (bare repo) there is no directory to merge in.
begin "merge-local: no provable main checkout exits 2"
new_repo
g clone -q --bare "$REPO" "$SB/bare.git" || die "bare clone"
g -C "$SB/bare.git" worktree add -q -b feat/b "$SB/wt-bare" || die "bare worktree"
merge_in "$SB/wt-bare" main feat/b -- true
assert_eq "exit" 2 "$RC"
assert_contains "REFUSED" "main checkout" "$(kv REFUSED)"
finish

# A base that is not a local branch (a remote-tracking ref, a tag) would leave
# the main checkout on a detached HEAD, and the merge would land on no branch.
# Both names must be local branches, checked before anything moves.
begin "merge-local: base and branch must be local branches"
new_feature
g -C "$REPO" update-ref refs/remotes/up/main main || die "update-ref"
park_main
merge_in "$WT" up/main feat/w -- true
assert_eq "remote-tracking base: exit" 2 "$RC"
assert_contains "remote-tracking base: REFUSED" "up/main" "$(kv REFUSED)"
merge_in "$WT" nosuch feat/w -- true
assert_eq "missing base: exit" 2 "$RC"
merge_in "$WT" main nosuch -- true
assert_eq "missing branch: exit" 2 "$RC"
assert_contains "missing branch: REFUSED" "nosuch" "$(kv REFUSED)"
assert_eq "main checkout untouched" other "$(g -C "$REPO" symbolic-ref --short HEAD)"
assert_eq "base unchanged" "$MAIN_SHA" "$(g -C "$REPO" rev-parse main)"
finish

# ── Cases: cleanup ────────────────────────────────────────────────────────────

# Order matters twice over. `branch -d` before removal exits 1 (git will not
# delete a branch a worktree has checked out), so the worktree goes first. And
# the whole run ends with one registered worktree: the main checkout.
begin "cleanup: removes worktree, then deletes branch"
new_feature
land_feature
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 0 "$RC"
assert_eq "REMOVED_WORKTREE" "$WT" "$(kv REMOVED_WORKTREE)"
assert_eq "DELETED_BRANCH" feat/w "$(kv DELETED_BRANCH)"
assert_eq "keys, in order" "REMOVED_WORKTREE,DELETED_BRANCH" \
  "$(sed 's/=.*//' <<<"$OUT" | paste -sd, -)"
assert_eq "worktree directory gone" no "$(exists "$WT")"
assert_eq "branch gone" no "$(has_branch feat/w)"
assert_eq "one worktree left" 1 "$(g -C "$REPO" worktree list | wc -l | tr -d ' ')"
assert_eq "the work is still on main" yes "$(exists "$REPO/feature.txt")"
finish

# Removing a worktree with an untracked file needs git's force flag, and force
# deletes the file. The script must stop first and name every file in the way,
# one by one (-uall), so the user can decide.
begin "cleanup: untracked file refuses and names it"
new_feature
land_feature
printf 'note\n' >"$WT/notes.md"
mkdir "$WT/dir"
printf 'inner\n' >"$WT/dir/a.txt"
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 3 "$RC"
assert_eq "BLOCKING names each file" "?? dir/a.txt"$'\n'"?? notes.md" "$(kv BLOCKING)"
assert_contains "REFUSED" "uncommitted" "$(kv REFUSED)"
assert_eq "nothing reported removed" no "$(has REMOVED_WORKTREE)"
assert_eq "file survives" note "$(cat "$WT/notes.md")"
assert_eq "nested file survives" inner "$(cat "$WT/dir/a.txt")"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

begin "cleanup: modified tracked file refuses"
new_feature
land_feature
printf 'edit\n' >"$WT/feature.txt"
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 3 "$RC"
assert_eq "BLOCKING" " M feature.txt" "$(kv BLOCKING)"
assert_eq "nothing reported removed" no "$(has REMOVED_WORKTREE)"
assert_eq "edit survives" edit "$(cat "$WT/feature.txt")"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

# --discard decides what happens to the branch, never to uncommitted work.
begin "cleanup: --discard does not override uncommitted files"
new_feature
printf 'note\n' >"$WT/notes.md"
cleanup_in "$REPO" "$WT" feat/w --discard --confirm discard
assert_eq "exit" 3 "$RC"
assert_eq "BLOCKING" "?? notes.md" "$(kv BLOCKING)"
assert_eq "file survives" note "$(cat "$WT/notes.md")"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

# Removing the directory a shell stands in deletes that shell's cwd. The agent
# must be told where to stand first.
begin "cleanup: refuses from inside the worktree"
new_feature
land_feature
mkdir "$WT/sub"
cleanup_in "$WT" "$WT" feat/w
assert_eq "at the root: exit" 2 "$RC"
assert_eq "at the root: REFUSED" "cd $REPO first" "$(kv REFUSED)"
cleanup_in "$WT/sub" "$WT" feat/w
assert_eq "in a subdirectory: exit" 2 "$RC"
assert_eq "in a subdirectory: REFUSED" "cd $REPO first" "$(kv REFUSED)"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

# A host (IDE, harness) that placed the worktree removes it itself. Nothing about
# the worktree is inspected, so even a dirty, unmerged one is left alone.
# Git can refuse a removal the status check let through: a worktree with an
# initialized submodule reads clean, yet git will not remove it without its
# force flag. The script reports the refusal and stops with everything in place;
# it does not take the force flag on the user's behalf.
begin "cleanup: git refusing the removal stops with everything in place"
new_repo
g init -q "$SB/libsrc" || die "git init libsrc"
commit "$SB/libsrc" "lib init"
g -c protocol.file.allow=always -C "$REPO" submodule add -q "$SB/libsrc" libs/sub \
  >/dev/null 2>&1 || die "submodule add"
g -C "$REPO" commit -q -m "add submodule" || die "commit submodule"
add_wt repo/.worktrees/w feat/w
g -c protocol.file.allow=always -C "$WT" submodule update --init -q \
  >/dev/null 2>&1 || die "submodule update"
assert_eq "setup: status reads clean" "" "$(g -C "$WT" status --porcelain -uall)"
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 1 "$RC"
assert_contains "REFUSED" "refused to remove" "$(kv REFUSED)"
assert_contains "git's reason reaches stderr" "submodules" "$ERR"
assert_eq "nothing reported removed" no "$(has REMOVED_WORKTREE)"
assert_eq "nothing reported deleted" no "$(has DELETED_BRANCH)"
assert_eq "worktree survives" yes "$(exists "$WT/libs/sub")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

begin "cleanup: host-owned worktree left in place"
new_repo
add_wt wt-sibling feat/s
commit_file "$WT" s.txt s "add s"
printf 'note\n' >"$WT/notes.md"
cleanup_in "$REPO" "$WT" feat/s
assert_eq "exit" 0 "$RC"
assert_eq "LEFT_IN_PLACE" "$WT" "$(kv LEFT_IN_PLACE)"
assert_eq "nothing reported removed" no "$(has REMOVED_WORKTREE)"
assert_eq "nothing reported deleted" no "$(has DELETED_BRANCH)"
assert_eq "worktree survives" yes "$(exists "$WT/notes.md")"
assert_eq "branch survives" yes "$(has_branch feat/s)"
finish

# The merged check runs before anything is touched, so the refusal leaves the
# worktree whole instead of half-cleaned. It judges against what the main
# checkout has checked out, which is where merge-local leaves the base.
begin "cleanup: unmerged branch refuses before removing"
new_feature
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 1 "$RC"
assert_contains "REFUSED" "not merged" "$(kv REFUSED)"
assert_eq "nothing reported removed" no "$(has REMOVED_WORKTREE)"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
new_feature
park_main
g -C "$REPO" branch -f main feat/w || die "advance main to feat/w"
cleanup_in "$REPO" "$WT" feat/w
assert_eq "merged into main but main checkout is elsewhere: exit" 1 "$RC"
assert_contains "merged elsewhere: REFUSED" "not merged" "$(kv REFUSED)"
assert_eq "merged elsewhere: worktree survives" yes "$(exists "$WT")"
assert_eq "merged elsewhere: branch survives" yes "$(has_branch feat/w)"
finish

begin "cleanup --discard --confirm discard: force-deletes unmerged branch"
new_feature
cleanup_in "$REPO" "$WT" feat/w --discard --confirm discard
assert_eq "exit" 0 "$RC"
assert_eq "REMOVED_WORKTREE" "$WT" "$(kv REMOVED_WORKTREE)"
assert_eq "DELETED_BRANCH" feat/w "$(kv DELETED_BRANCH)"
assert_eq "worktree directory gone" no "$(exists "$WT")"
assert_eq "branch gone" no "$(has_branch feat/w)"
assert_eq "the work never reached main" no "$(exists "$REPO/feature.txt")"
finish

# The ritual is the typed word, not the flag.
begin "cleanup --discard without confirm refuses"
new_feature
cleanup_in "$REPO" "$WT" feat/w --discard
assert_eq "no --confirm: exit" 2 "$RC"
assert_contains "no --confirm: REFUSED" "--confirm discard" "$(kv REFUSED)"
cleanup_in "$REPO" "$WT" feat/w --discard --confirm yes
assert_eq "wrong word: exit" 2 "$RC"
assert_contains "wrong word: REFUSED" "--confirm discard" "$(kv REFUSED)"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

begin "cleanup: branch mismatch refuses"
new_feature
land_feature
g -C "$REPO" branch feat/other || die "branch feat/other"
cleanup_in "$REPO" "$WT" feat/other
assert_eq "wrong branch: exit" 2 "$RC"
assert_contains "wrong branch: REFUSED" "feat/w" "$(kv REFUSED)"
assert_eq "wrong branch: worktree survives" yes "$(exists "$WT")"
assert_eq "wrong branch: feat/w survives" yes "$(has_branch feat/w)"
assert_eq "wrong branch: feat/other survives" yes "$(has_branch feat/other)"
add_wt repo/.worktrees/d --detach
cleanup_in "$REPO" "$WT" feat/w
assert_eq "detached worktree: exit" 2 "$RC"
assert_contains "detached worktree: REFUSED" "detached" "$(kv REFUSED)"
assert_eq "detached worktree: survives" yes "$(exists "$WT")"
finish

# Removal deletes ignored files (.env, node_modules/) without a word. The script
# lists them before it removes anything, so the report names what is now gone.
begin "cleanup: ignored files are reported"
new_feature
commit_file "$WT" .gitignore $'.env\nnode_modules/' "ignore local files"
land_feature
printf 'SECRET=1\n' >"$WT/.env"
mkdir "$WT/node_modules"
printf 'x\n' >"$WT/node_modules/pkg.js"
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 0 "$RC"
assert_eq "IGNORED, one per entry" ".env"$'\n'"node_modules/" "$(kv IGNORED)"
assert_eq "IGNORED precedes REMOVED_WORKTREE" "IGNORED,IGNORED,REMOVED_WORKTREE,DELETED_BRANCH" \
  "$(sed 's/=.*//' <<<"$OUT" | paste -sd, -)"
assert_eq "worktree directory gone" no "$(exists "$WT")"
assert_eq "branch gone" no "$(has_branch feat/w)"
finish

# Without ignored files, no IGNORED line.
begin "cleanup: clean worktree reports nothing ignored"
new_feature
land_feature
cleanup_in "$REPO" "$WT" feat/w
assert_eq "exit" 0 "$RC"
assert_eq "DELETED_BRANCH" feat/w "$(kv DELETED_BRANCH)"
assert_eq "IGNORED absent" no "$(has IGNORED)"
finish

# No worktree to remove: the main checkout stays, only the branch goes.
begin "cleanup: main checkout path deletes only the branch"
new_repo
commit_file "$REPO" tracked.txt base "add tracked"
g -C "$REPO" checkout -q -b feat/x || die "checkout feat/x"
commit_file "$REPO" feature.txt feature "add feature"
g -C "$REPO" checkout -q main || die "checkout main"
cleanup_in "$REPO" "$REPO" feat/x
assert_eq "unmerged: exit" 1 "$RC"
assert_contains "unmerged: REFUSED" "not merged" "$(kv REFUSED)"
assert_eq "unmerged: branch survives" yes "$(has_branch feat/x)"
g -C "$REPO" merge -q --ff-only feat/x || die "merge feat/x"
printf 'scratch\n' >"$REPO/scratch.txt"
cleanup_in "$REPO" "$REPO" feat/x
assert_eq "merged: exit" 0 "$RC"
assert_eq "merged: DELETED_BRANCH" feat/x "$(kv DELETED_BRANCH)"
assert_eq "merged: no REMOVED_WORKTREE" no "$(has REMOVED_WORKTREE)"
assert_eq "merged: branch gone" no "$(has_branch feat/x)"
assert_eq "merged: main checkout intact" yes "$(exists "$REPO/tracked.txt")"
assert_eq "merged: untracked file there is not touched" yes "$(exists "$REPO/scratch.txt")"
finish

# git will not delete the branch a checkout holds. The refusal says the branch
# was kept.
begin "cleanup: branch checked out in the main checkout refuses"
new_repo
g -C "$REPO" checkout -q -b feat/x || die "checkout feat/x"
cleanup_in "$REPO" "$REPO" feat/x
assert_eq "exit" 1 "$RC"
assert_eq "KEPT_BRANCH" feat/x "$(kv KEPT_BRANCH)"
assert_eq "no DELETED_BRANCH" no "$(has DELETED_BRANCH)"
assert_eq "branch survives" yes "$(has_branch feat/x)"
finish

begin "cleanup --discard --confirm discard: force-deletes in the main checkout too"
new_repo
g -C "$REPO" checkout -q -b feat/x || die "checkout feat/x"
commit_file "$REPO" feature.txt feature "add feature"
g -C "$REPO" checkout -q main || die "checkout main"
cleanup_in "$REPO" "$REPO" feat/x --discard --confirm discard
assert_eq "exit" 0 "$RC"
assert_eq "DELETED_BRANCH" feat/x "$(kv DELETED_BRANCH)"
assert_eq "branch gone" no "$(has_branch feat/x)"
finish

# The path has to be a worktree of the repository the caller stands in. A plain
# directory, a missing one, another repository's worktree, or a subdirectory of
# a worktree is not.
begin "cleanup: path must be a worktree of this repository"
new_feature
land_feature
mkdir -p "$SB/plain" "$WT/sub"
cleanup_in "$REPO" "$SB/plain" feat/w
assert_eq "plain directory: exit" 2 "$RC"
assert_contains "plain directory: REFUSED" "not a worktree" "$(kv REFUSED)"
cleanup_in "$REPO" "$SB/missing" feat/w
assert_eq "missing path: exit" 2 "$RC"
assert_contains "missing path: REFUSED" "not a worktree" "$(kv REFUSED)"
cleanup_in "$REPO" "$WT/sub" feat/w
assert_eq "subdirectory of a worktree: exit" 2 "$RC"
assert_contains "subdirectory: REFUSED" "not a worktree" "$(kv REFUSED)"
g init -q "$SB/other" || die "git init other"
commit "$SB/other" "other init"
cleanup_in "$REPO" "$SB/other" main
assert_eq "other repository: exit" 2 "$RC"
assert_contains "other repository: REFUSED" "not a worktree" "$(kv REFUSED)"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
assert_eq "other repository intact" yes "$(exists "$SB/other/.git")"
finish

begin "cleanup: usage errors exit 2"
new_feature
land_feature
cleanup_usage() { # <label> <args...> — expect exit 2, usage on stderr, nothing on stdout
  local label="$1"
  shift
  cleanup_in "$REPO" "$@"
  assert_eq "$label: exit" 2 "$RC"
  assert_eq "$label: stdout" "" "$OUT"
  assert_contains "$label: stderr" "cleanup <worktree-path> <branch>" "$ERR"
}
cleanup_usage "no args"
cleanup_usage "no branch" "$WT"
cleanup_usage "option-like path" -x feat/w
cleanup_usage "option-like branch" "$WT" -x
cleanup_usage "unknown flag" "$WT" feat/w --bogus
cleanup_usage "--confirm without a value" "$WT" feat/w --discard --confirm
cleanup_usage "--confirm without --discard" "$WT" feat/w --confirm discard
mkdir -p "$TMP/notrepo"
cleanup_in "$TMP/notrepo" "$WT" feat/w
assert_eq "outside a repo: exit" 2 "$RC"
assert_contains "outside a repo: stderr" "inside a git repository" "$ERR"
assert_eq "worktree survives" yes "$(exists "$WT")"
assert_eq "branch survives" yes "$(has_branch feat/w)"
finish

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ]
