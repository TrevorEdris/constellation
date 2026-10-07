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
# merge-local exists for the same reason. Its steps are order-sensitive
# (checkout the base where the base is free, merge, test the merged result, keep
# a way back) and a repo that ships by pull request must never be merged into
# locally without the user's approval, so the script both runs the steps and
# checks the approval.
#
# cleanup exists because removal goes wrong in order-sensitive ways too: git
# will not delete a branch while a worktree holds it, removing the directory
# the shell stands in strands the shell, git's own force flag deletes files the
# user never committed, and a plain removal silently deletes ignored files
# (.env, node_modules/). The script checks each of these before it removes
# anything and never forces.
#
# Usage:
#   workspace.sh detect [<base>]
#   workspace.sh merge-local <base> <branch> [--plan <PLAN.md>] -- <test command...>
#   workspace.sh cleanup <worktree-path> <branch> [--discard --confirm discard]
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
# merge-local
#   Merge <branch> into <base> in the main checkout, then run the test command
#   there against the merged result. Run it from anywhere in the repo, a linked
#   worktree included: the checkout and merge always run in MAIN_ROOT, because
#   <base> is usually checked out there and a checkout in a worktree would exit
#   128. <base> and <branch> must be local branches. Steps, in order:
#     1. Detect the workspace (as detect does); no provable MAIN_ROOT -> exit 2.
#     2. A PR-based repo (DELIVERY=pr) refuses with exit 4, unless --plan names
#        a PLAN.md the user approved for local-only delivery of this repo:
#          - frontmatter `status` is approved or in-progress (an inline
#            `# comment` and quotes are ignored), and
#          - the block-form `delivery:` list has an item with `mode: local-only`
#            whose `repo` is an absolute path that resolves to MAIN_ROOT or
#            WORKTREE_PATH. An item with no `repo`, or an empty one, does not
#            qualify: every delivery item names its repo, and in a plan that
#            covers several repos a repo-less item would approve all of them.
#        A missing file, a legacy plan without `delivery:`, flow form or
#        anything unreadable does not qualify: it fails closed to exit 4.
#     3. Uncommitted changes to tracked files in MAIN_ROOT -> BLOCKING= lines,
#        exit 3. Untracked files do not block.
#     4. Print PREVIOUS_BRANCH= (empty when detached), then check out <base> in
#        MAIN_ROOT. MAIN_ROOT stays on <base> afterwards; the caller reports it.
#     5. `pull --ff-only` only if <base> has an upstream.
#     6. Remember <base>'s tip, then `merge --no-edit <branch>`. A failed merge
#        is aborted (<base> unchanged) and exits 1.
#     7. Run the test command in MAIN_ROOT. Failure -> exit 5, with the merge
#        left in place, UNDO= (the command that restores <base>) and
#        KEPT_BRANCH=. Success -> MERGED=<new tip of base>, exit 0.
#   The branch and any worktree are never touched. Git's own output and the test
#   command's output go to stderr so stdout stays KEY=value lines.
#
# cleanup
#   Remove a finished worktree, then delete its branch. Run it from the main
#   checkout (or anywhere outside <worktree-path>), after merge-local or after
#   the pull request merged. Steps, in order:
#     1. <worktree-path> must be a worktree of the repository you stand in
#        (the top of one, not a subdirectory), else exit 2. Detect the workspace
#        from inside it, as detect does.
#     2. A linked worktree must be on <branch>, else exit 2. If detect says
#        CLEANUP=host (a harness or IDE owns it) print LEFT_IN_PLACE= and exit
#        0 without inspecting or touching anything.
#     3. <path> that is the main checkout skips the worktree steps; only the
#        branch is deleted. Any other path must not contain the current
#        directory: REFUSED=cd <MAIN_ROOT> first, exit 2.
#     4. --discard needs --confirm discard; the typed word is the ritual that
#        permits force-deleting an unmerged branch. Without --discard the
#        branch must already be an ancestor of the main checkout's HEAD, else
#        exit 1 before anything is touched.
#     5. Uncommitted files in the worktree (tracked changes and every untracked
#        file) -> BLOCKING= lines, exit 3, nothing removed. --discard does not
#        override this: it concerns the branch, not the files.
#     6. Print IGNORED= for each ignored path (.env, node_modules/): removing the
#        worktree deletes them, so the report must name them first.
#     7. `worktree remove` (never forced), `worktree prune`, then `branch -d`
#        (`-D` with --discard --confirm discard). The worktree goes first
#        because git refuses to delete a branch a worktree has checked out.
#   Git's own output goes to stderr so stdout stays KEY=value lines.
#
# Other keys printed by merge-local and cleanup, one per line:
#     PREVIOUS_BRANCH=  branch MAIN_ROOT was on before the checkout
#     BLOCKING=         one porcelain status line per file that blocks: changed
#                       tracked files (merge-local); those plus every untracked
#                       file (cleanup)
#     REFUSED=          why it stopped
#     UNDO=             `git -C <MAIN_ROOT> reset --merge <sha>`
#     KEPT_BRANCH=      <branch>, kept because the merged result failed
#                       (merge-local) or git would not delete it (cleanup)
#     MERGED=           the sha <base> points at after a good merge
#     IGNORED=          one ignored path in the worktree about to be removed
#     REMOVED_WORKTREE= the worktree path, once git has removed it
#     DELETED_BRANCH=   <branch>, once deleted
#     LEFT_IN_PLACE=    the worktree path, when the host owns it
#
# Output goes to stdout as KEY=value lines; problems go to stderr.
#
# Exit codes:
#   0  - Done
#   1  - A git step failed or was refused (checkout, pull, merge, worktree
#        remove, branch delete), or cleanup's branch is not merged
#   2  - Usage error, or a precondition failed: outside a git work tree, no
#        provable main checkout, <base> or <branch> not a local branch,
#        cleanup's path not a worktree of this repository or on another branch,
#        run from inside the worktree to remove, --discard without its
#        confirmation
#   3  - Uncommitted files block: tracked changes block the merge; any
#        uncommitted file, untracked ones included, blocks the removal
#   4  - PR-based repo and no approved local-only plan: push and open a PR instead
#   5  - The merged result fails its tests (the merge stays; run UNDO= to undo it)
#
# Pipefail rule: never end a pipe in an early-exiting reader such as `grep -q`.
# It can close the pipe before the writer finishes; under pipefail the SIGPIPE
# turns a match into "no match". Capture the text in a variable, then match a
# here-string. A false "local" here would permit a local merge into a PR repo.
set -uo pipefail

usage() {
  echo "Usage: workspace.sh detect [<base>]"
  echo "       workspace.sh merge-local <base> <branch> [--plan <PLAN.md>] -- <test command...>"
  echo "       workspace.sh cleanup <worktree-path> <branch> [--discard --confirm discard]"
}

usage_exit() {
  usage >&2
  exit 2
}

# canon <dir> — print the physical absolute path of <dir>; fail if it is empty
# or not enterable. (`cd ""` succeeds in bash and would silently yield $PWD.)
canon() {
  [ -n "${1:-}" ] || return 1
  (cd "$1" 2>/dev/null && pwd -P)
}

# field <KEY> <text> — the value of KEY=value in <text> (detect's output).
field() {
  sed -n "s/^$1=//p" <<<"$2"
}

# Reads the frontmatter of a PLAN.md for approved_local_only. Prints nothing
# unless the file opens with a `---` line and closes it with another. Then:
#   S:<status>   once, the top-level `status` (inline # comment and quotes
#                stripped; empty if there is none)
#   R:<repo>     per delivery item whose `mode` is local-only; <repo> is empty
#                when the item has no `repo`
# Only the block form is read: `delivery:` with nothing after it, then a list
# of `- key: value` items. Flow form, or any other line inside the delivery
# block, yields no R: lines.
IFS= read -r -d '' PLAN_AWK <<'AWK' || true
function clean(v,   q) {
  sub(/\r$/, "", v)
  sub(/^#.*/, "", v)
  sub(/[ \t]+#.*/, "", v)
  sub(/[ \t]+$/, "", v)
  if (length(v) >= 2) {
    q = substr(v, 1, 1)
    if ((q == "\"" || q == "'") && substr(v, length(v), 1) == q) {
      v = substr(v, 2, length(v) - 2)
    }
  }
  return v
}

function endItem() {
  if (inItem && mode == "local-only") items = items "R:" repo "\n"
  inItem = 0
}

function setKey(s,   k, v) {
  k = s
  sub(/:.*/, "", k)
  v = s
  sub(/^[^:]*:[ \t]*/, "", v)
  v = clean(v)
  if (k == "mode") mode = v
  else if (k == "repo") repo = v
}

{ sub(/\r$/, "") }

NR == 1 {
  if ($0 ~ /^---[ \t]*$/) { inFront = 1; next }
  exit
}

inFront && /^---[ \t]*$/ { endItem(); closed = 1; exit }

inFront {
  line = $0
  if (line ~ /^[A-Za-z_][A-Za-z0-9_-]*:([ \t]|$)/) {
    endItem()
    inDelivery = 0
    key = line
    sub(/:.*/, "", key)
    val = line
    sub(/^[^:]*:[ \t]*/, "", val)
    val = clean(val)
    if (key == "status") status = val
    else if (key == "delivery" && val == "") inDelivery = 1
    next
  }
  if (!inDelivery) next
  if (line ~ /^[ \t]*(#.*)?$/) next
  if (line ~ /^[ \t]*-[ \t]+[A-Za-z_][A-Za-z0-9_-]*:([ \t]|$)/) {
    endItem()
    inItem = 1; mode = ""; repo = ""
    sub(/^[ \t]*-[ \t]+/, "", line)
    setKey(line)
    next
  }
  if (inItem && line ~ /^[ \t]+[A-Za-z_][A-Za-z0-9_-]*:([ \t]|$)/) {
    sub(/^[ \t]+/, "", line)
    setKey(line)
    next
  }
  broken = 1
}

END {
  if (closed && !broken) {
    print "S:" status
    printf "%s", items
  }
}
AWK

# approved_local_only <plan> <main_root> <worktree_path> — succeed only when the
# plan was approved for local-only delivery of this repo (see merge-local, step
# 2). Fails closed: a missing or unreadable plan is "no". The parse is read from
# a here-string, never a pipe, so `return` leaves this function.
approved_local_only() {
  local plan="$1" main_root="$2" wt_path="$3" parsed line status="" repo
  [ -f "$plan" ] || return 1
  parsed="$(awk "$PLAN_AWK" <"$plan" 2>/dev/null)" || return 1
  while IFS= read -r line; do
    case "$line" in
      S:*) status="${line#S:}" ;;
    esac
  done <<<"$parsed"
  case "$status" in
    approved | in-progress) ;;
    *) return 1 ;;
  esac
  while IFS= read -r line; do
    case "$line" in
      R:*)
        repo="${line#R:}"
        [ -n "$repo" ] || continue
        case "$repo" in
          /*) ;;
          *) continue ;;
        esac
        repo="$(canon "$repo")" || continue
        if [ "$repo" = "$main_root" ] || [ "$repo" = "$wt_path" ]; then
          return 0
        fi
        ;;
    esac
  done <<<"$parsed"
  return 1
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

cmd_merge_local() {
  [ $# -ge 2 ] || usage_exit
  local base="$1" branch="$2" plan=""
  shift 2
  case "$base" in
    "" | -*) usage_exit ;;
  esac
  case "$branch" in
    "" | -*) usage_exit ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --plan)
        [ $# -ge 2 ] || usage_exit
        plan="$2"
        shift 2
        ;;
      --)
        shift
        break
        ;;
      *) usage_exit ;;
    esac
  done
  [ $# -gt 0 ] || usage_exit

  # detect's own error already went to stderr; its exit 2 is ours.
  local detected main_root wt_path delivery remote
  detected="$(cmd_detect "$base")" || exit 2
  main_root="$(field MAIN_ROOT "$detected")"
  wt_path="$(field WORKTREE_PATH "$detected")"
  delivery="$(field DELIVERY "$detected")"
  remote="$(field REMOTE "$detected")"

  if [ -z "$main_root" ]; then
    echo "REFUSED=cannot locate the main checkout of this workspace"
    exit 2
  fi

  # A base that is not a local branch (a tag, origin/main) would leave the main
  # checkout on a detached HEAD and the merge on no branch. Check before moving
  # anything.
  local name
  for name in "$base" "$branch"; do
    if ! git -C "$main_root" show-ref --verify --quiet "refs/heads/$name"; then
      echo "REFUSED=$name is not a local branch"
      exit 2
    fi
  done

  if [ "$delivery" = pr ] && ! approved_local_only "$plan" "$main_root" "$wt_path"; then
    local why="merged-PR subjects in the history"
    [ -z "$remote" ] || why="remote $remote"
    echo "REFUSED=PR-based repo ($why); push and open a PR instead"
    exit 4
  fi

  local dirty line
  if ! dirty="$(git -C "$main_root" status --porcelain -uno)"; then
    echo "REFUSED=cannot read the status of $main_root"
    exit 1
  fi
  if [ -n "$dirty" ]; then
    while IFS= read -r line; do
      echo "BLOCKING=$line"
    done <<<"$dirty"
    echo "REFUSED=main checkout has uncommitted changes to tracked files"
    exit 3
  fi

  local previous=""
  previous="$(git -C "$main_root" symbolic-ref --quiet --short HEAD 2>/dev/null)" || previous=""
  echo "PREVIOUS_BRANCH=$previous"

  if ! git -C "$main_root" checkout -q "$base" -- >&2; then
    echo "REFUSED=cannot check out $base in $main_root"
    exit 1
  fi
  if git -C "$main_root" rev-parse --verify --quiet "$base@{upstream}" >/dev/null 2>&1; then
    if ! git -C "$main_root" pull -q --ff-only >&2; then
      echo "REFUSED=cannot fast-forward $base from its upstream; $base is unchanged"
      exit 1
    fi
  fi

  local pre
  if ! pre="$(git -C "$main_root" rev-parse HEAD)"; then
    echo "REFUSED=cannot read the tip of $base"
    exit 1
  fi
  if ! git -C "$main_root" merge --no-edit "$branch" >&2; then
    git -C "$main_root" merge --abort >/dev/null 2>&1
    echo "REFUSED=merging $branch into $base failed; merge aborted, $base unchanged"
    exit 1
  fi

  local rc=0
  (cd "$main_root" && "$@") >&2 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "REFUSED=merged result fails its tests (exit $rc); $base still holds the merge"
    printf 'UNDO=git -C %q reset --merge %s\n' "$main_root" "$pre"
    echo "KEPT_BRANCH=$branch"
    exit 5
  fi
  echo "MERGED=$(git -C "$main_root" rev-parse HEAD)"
}

cmd_cleanup() {
  [ $# -ge 2 ] || usage_exit
  local path="$1" branch="$2" discard=0 confirm=""
  shift 2
  case "$path" in
    "" | -*) usage_exit ;;
  esac
  case "$branch" in
    "" | -*) usage_exit ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --discard)
        discard=1
        shift
        ;;
      --confirm)
        [ $# -ge 2 ] || usage_exit
        confirm="$2"
        shift 2
        ;;
      *) usage_exit ;;
    esac
  done
  if [ "$discard" -eq 0 ] && [ -n "$confirm" ]; then
    usage_exit
  fi

  # The path must be a worktree of the repository the caller stands in. Asking
  # this repository for its worktree list settles that: another repository's
  # directory, a plain directory and a subdirectory of a worktree are not in it.
  local listed
  if ! listed="$(git worktree list --porcelain 2>/dev/null)"; then
    echo "workspace.sh: cleanup must run inside a git repository" >&2
    exit 2
  fi
  local wt line listed_path found=0
  if wt="$(canon "$path")"; then
    while IFS= read -r line; do
      case "$line" in
        "worktree "*)
          listed_path="$(canon "${line#worktree }")" || continue
          if [ "$listed_path" = "$wt" ]; then
            found=1
            break
          fi
          ;;
      esac
    done <<<"$listed"
  fi
  if [ "$found" -eq 0 ]; then
    echo "REFUSED=$path is not a worktree of this repository"
    exit 2
  fi

  local detected isolation wt_branch main_root cleanup_mode
  detected="$(cd "$wt" && cmd_detect)" || exit 2
  isolation="$(field ISOLATION "$detected")"
  wt_branch="$(field BRANCH "$detected")"
  main_root="$(field MAIN_ROOT "$detected")"
  cleanup_mode="$(field CLEANUP "$detected")"

  if [ "$isolation" = worktree ]; then
    if [ "$wt_branch" != "$branch" ]; then
      echo "REFUSED=$wt is on ${wt_branch:-a detached HEAD}, not $branch"
      exit 2
    fi
    # Whoever placed this worktree removes it. Leave it and its branch alone,
    # whatever state they are in.
    if [ "$cleanup_mode" = host ]; then
      echo "LEFT_IN_PLACE=$wt"
      exit 0
    fi
  fi

  if ! git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "REFUSED=$branch is not a local branch"
    exit 2
  fi

  # Deleting the directory the caller stands in strands the caller.
  local here
  if [ "$wt" != "$main_root" ]; then
    here="$(pwd -P)" || here=""
    case "$here/" in
      "$wt"/*)
        echo "REFUSED=cd $main_root first"
        exit 2
        ;;
    esac
  fi

  # The typed word is the ritual that permits force-deleting an unmerged branch.
  if [ "$discard" -eq 1 ] && [ "$confirm" != discard ]; then
    echo "REFUSED=--discard force-deletes the branch; it needs --confirm discard"
    exit 2
  fi

  # Judged before anything is removed, so a refusal leaves the worktree whole.
  if [ "$discard" -eq 0 ] \
    && ! git -C "$main_root" merge-base --is-ancestor "refs/heads/$branch" HEAD; then
    echo "REFUSED=$branch is not merged into the HEAD of $main_root; nothing was removed"
    exit 1
  fi

  if [ "$wt" != "$main_root" ]; then
    local dirty ignored
    if ! dirty="$(git -C "$wt" status --porcelain -uall)"; then
      echo "REFUSED=cannot read the status of $wt"
      exit 1
    fi
    if [ -n "$dirty" ]; then
      while IFS= read -r line; do
        echo "BLOCKING=$line"
      done <<<"$dirty"
      echo "REFUSED=$wt has uncommitted files; nothing was removed"
      exit 3
    fi

    # Removal deletes these without a word; name them while they still exist.
    if ! ignored="$(git -C "$wt" status --porcelain --ignored)"; then
      echo "REFUSED=cannot read the ignored files of $wt"
      exit 1
    fi
    while IFS= read -r line; do
      case "$line" in
        '!! '*) echo "IGNORED=${line#'!! '}" ;;
      esac
    done <<<"$ignored"

    # Never overridden: when git refuses, the user decides what happens next.
    if ! git -C "$main_root" worktree remove "$wt" >&2; then
      echo "REFUSED=git refused to remove $wt; leave it and tell the user"
      exit 1
    fi
    echo "REMOVED_WORKTREE=$wt"
    if ! git -C "$main_root" worktree prune >&2; then
      echo "REFUSED=git worktree prune failed; $wt is already removed"
      echo "KEPT_BRANCH=$branch"
      exit 1
    fi
  fi

  local delete_flag=-d
  [ "$discard" -eq 0 ] || delete_flag=-D
  if ! git -C "$main_root" branch "$delete_flag" -- "$branch" >&2; then
    echo "REFUSED=git refused to delete branch $branch"
    echo "KEPT_BRANCH=$branch"
    exit 1
  fi
  echo "DELETED_BRANCH=$branch"
}

case "${1:-}" in
  detect)
    shift
    cmd_detect "$@"
    ;;
  merge-local)
    shift
    cmd_merge_local "$@"
    ;;
  cleanup)
    shift
    cmd_cleanup "$@"
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
