#!/usr/bin/env bash
# workspace.sh — Tell an agent exactly which git workspace it is standing in
#
# Why this exists: finishing a branch depends on facts that prose rules get
# wrong when an agent re-derives them from memory: whether this is a linked
# worktree, which checkout is the main one, who owns cleanup of the directory,
# and whether the repo ships through pull requests. Guessing wrong deletes a
# directory the host still owns, or merges locally into a repo that delivers by
# PR. The answers live here so one tested script gives them the same way every
# time.
#
# Usage:
#   workspace.sh detect [<base>]
#
# detect
#   Run it inside the workspace, before any `cd`. Prints these lines, always all
#   of them and always in this order (a value may be empty):
#     ISOLATION=none|worktree  worktree = a linked worktree. A submodule is not
#                              one, even though its git-dir differs from the
#                              superproject's.
#     HEAD=branch|detached
#     BRANCH=                  current branch; empty when detached
#     BASE=                    <base> if given, else local main, else local
#                              master, else empty
#     GIT_DIR=                 this workspace's git dir (canonical path)
#     GIT_COMMON=              the git dir shared by all worktrees of the repo
#     WORKTREE_PATH=           top of this workspace (canonical path)
#     MAIN_ROOT=               the main checkout that owns GIT_COMMON; empty if
#                              it cannot be proven (bare repo, --separate-git-dir)
#     CLEANUP=none|git|host    none = not a worktree. git = the agent may remove
#                              it: a worktree on a branch under MAIN_ROOT/
#                              .worktrees/, worktrees/ or .claude/worktrees/.
#                              host = anything else (sibling directory, detached
#                              HEAD, unknown MAIN_ROOT): the host owns it, leave
#                              it in place.
#     REMOTE=                  origin if present, else the first remote, else empty
#     DELIVERY=pr|local        pr when the repo has a remote, or a recent subject
#                              on HEAD or BASE looks like a merged pull request
#                              ("... (#12)" or "Merge pull request #12 ...")
#
# Output goes to stdout as KEY=value lines; problems go to stderr.
#
# Exit codes:
#   0  - Done
#   2  - Usage error, or detect run outside a git work tree
#
# Pipefail rule: never end a pipe in an early-exiting reader such as `grep -q`.
# It can close the pipe before the writer finishes; under pipefail the SIGPIPE
# turns a match into "no match". Capture the text in a variable, then match a
# here-string. A false "local" here would permit a local merge into a PR repo.
set -uo pipefail

usage() {
  echo "Usage: workspace.sh detect [<base>]"
}

# canon <dir> — print the physical absolute path of <dir>; fail if it is empty
# or not enterable. (`cd ""` succeeds in bash and would silently yield $PWD.)
canon() {
  [ -n "${1:-}" ] || return 1
  (cd "$1" 2>/dev/null && pwd -P)
}

cmd_detect() {
  if [ $# -gt 1 ]; then
    usage >&2
    exit 2
  fi
  local base_arg="${1:-}"
  case "$base_arg" in
    -*)
      usage >&2
      exit 2
      ;;
  esac

  local toplevel
  if ! toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    echo "workspace.sh: detect must run inside a git work tree" >&2
    exit 2
  fi

  # Canonical paths: from a subdirectory --git-dir is absolute while
  # --git-common-dir is relative, so only canonical forms compare reliably.
  local git_dir git_common wt_path
  git_dir="$(canon "$(git rev-parse --absolute-git-dir 2>/dev/null)")" \
    && git_common="$(canon "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")" \
    && wt_path="$(canon "$toplevel")" \
    || {
      echo "workspace.sh: cannot resolve the git directories" >&2
      exit 2
    }

  # git-dir differs from common-dir in a submodule too; the superproject check
  # keeps a submodule reading as a normal repo.
  local superproject isolation=none
  superproject="$(git rev-parse --show-superproject-working-tree 2>/dev/null)"
  if [ "$git_dir" != "$git_common" ] && [ -z "$superproject" ]; then
    isolation=worktree
  fi

  local head=branch branch
  if ! branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
    head=detached
    branch=""
  fi

  local base=""
  if [ -n "$base_arg" ]; then
    base="$base_arg"
  elif git show-ref --verify --quiet refs/heads/main; then
    base=main
  elif git show-ref --verify --quiet refs/heads/master; then
    base=master
  fi

  # The main checkout sits above the common dir. --show-toplevel here would name
  # the worktree itself. Accept the directory above GIT_COMMON only if it owns
  # that same common dir; otherwise (bare repo, --separate-git-dir, an unrelated
  # repo further up) there is no provable main checkout.
  local main_root="" candidate candidate_common
  if [ "$isolation" = none ]; then
    main_root="$wt_path"
  else
    candidate="$(git -C "$git_common/.." rev-parse --show-toplevel 2>/dev/null)"
    if candidate="$(canon "$candidate")"; then
      candidate_common="$(canon "$(git -C "$candidate" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")"
      if [ "$candidate_common" = "$git_common" ]; then
        main_root="$candidate"
      fi
    fi
  fi

  local cleanup=host
  if [ "$isolation" = none ]; then
    cleanup=none
  elif [ "$head" = branch ] && [ -n "$main_root" ]; then
    case "$wt_path" in
      "$main_root"/.worktrees/* | "$main_root"/worktrees/* | "$main_root"/.claude/worktrees/*)
        cleanup=git
        ;;
    esac
  fi

  local remotes remote="" name
  remotes="$(git remote 2>/dev/null)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ -n "$remote" ] || remote="$name"
    if [ "$name" = origin ]; then
      remote=origin
      break
    fi
  done <<<"$remotes"

  # A remote settles it. Without one, five subjects of BASE plus five of HEAD
  # are the evidence: a branch with five or more own commits has pushed the
  # base's PR subjects out of HEAD's window. The trailing -- keeps a base name
  # from being read as a path.
  local delivery=local subjects
  if [ -n "$remote" ]; then
    delivery=pr
  else
    subjects="$(
      if [ -n "$base" ]; then
        git log -5 --format=%s "$base" -- 2>/dev/null
      fi
      git log -5 --format=%s HEAD -- 2>/dev/null
    )"
    if grep -qE '\(#[0-9]+\)|^Merge pull request #[0-9]+' <<<"$subjects"; then
      delivery=pr
    fi
  fi

  printf '%s\n' \
    "ISOLATION=$isolation" \
    "HEAD=$head" \
    "BRANCH=$branch" \
    "BASE=$base" \
    "GIT_DIR=$git_dir" \
    "GIT_COMMON=$git_common" \
    "WORKTREE_PATH=$wt_path" \
    "MAIN_ROOT=$main_root" \
    "CLEANUP=$cleanup" \
    "REMOTE=$remote" \
    "DELIVERY=$delivery"
}

case "${1:-}" in
  detect)
    shift
    cmd_detect "$@"
    ;;
  "")
    usage >&2
    exit 2
    ;;
  *)
    echo "workspace.sh: unknown subcommand: $1" >&2
    usage >&2
    exit 2
    ;;
esac
