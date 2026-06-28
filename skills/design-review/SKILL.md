---
name: design-review
description: "Use when reviewing front-end or UI/UX changes before merge -- visual hierarchy, accessibility, responsive design, and interaction patterns, with live Playwright browser testing."
context: fork
agent: design-review
model: sonnet
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status), Bash(git branch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Grep, Glob, LS, Read, WebFetch, TodoWrite, mcp__playwright__browser_close, mcp__playwright__browser_resize, mcp__playwright__browser_console_messages, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_install, mcp__playwright__browser_press_key, mcp__playwright__browser_type, mcp__playwright__browser_navigate, mcp__playwright__browser_navigate_back, mcp__playwright__browser_network_requests, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_drag, mcp__playwright__browser_hover, mcp__playwright__browser_select_option, mcp__playwright__browser_tabs, mcp__playwright__browser_wait_for
tags: [review]
---

# Design Review

Review the pending front-end changes for design quality.

## Context

GIT STATUS:

```
!`git status`
```

PR METADATA:

```
!`gh pr view --json title,body,author,files,additions,deletions,headRefName,state 2>/dev/null || echo "No PR context - reviewing local branch"`
```

FILES MODIFIED:

```
!`gh pr diff --name-only 2>/dev/null || git diff --name-only origin/HEAD...`
```

DIFF CONTENT:

```
!`gh pr diff 2>/dev/null || git diff --merge-base origin/HEAD`
```

## Prerequisites

- Playwright MCP server connected
- Live preview environment running (provide URL to agent)

## Objective

Use the design-review agent to review the UI/UX changes above. Execute the 8-phase review process (including AI slop check) with live browser testing. Your final reply must contain the markdown report with screenshots.

## References

- `references/DESIGN_PRINCIPLES.md` — Design philosophy and quick review checklist
- `references/ai-slop-test.md` — AI generation fingerprint checklist
- `references/typography.md` — Modular scales, font selection, loading
- `references/color-and-contrast.md` — OKLCH, tinted neutrals, dark mode, contrast
- `references/spatial-design.md` — Spacing systems, grids, hierarchy, container queries
- `references/motion-design.md` — Duration ladder, easing curves, reduced motion
- `references/CLAUDE_MD_SNIPPET.md` — CLAUDE.md integration guide

## Extending with Impeccable

For finer-grained design commands (audit, normalize, polish, bolder, harden, and 15 more), consider installing the [impeccable](https://github.com/pbakaus/impeccable) plugin alongside FOTW. Impeccable provides actionable design steering commands and a persistent project design context file (`.impeccable.md`).
