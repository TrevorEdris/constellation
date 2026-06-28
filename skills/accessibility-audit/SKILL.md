---
name: accessibility-audit
description: "Use when reviewing UI changes for accessibility, running an a11y audit, or doing a pre-release accessibility check -- WCAG 2.1/2.2, keyboard navigation, screen readers, color contrast, ARIA, semantic HTML, accessible, aria labels."
context: fork
agent: accessibility-audit
model: sonnet
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status), Bash(git branch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Grep, Glob, LS, Read, WebFetch, TodoWrite, mcp__playwright__browser_close, mcp__playwright__browser_resize, mcp__playwright__browser_console_messages, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_evaluate, mcp__playwright__browser_file_upload, mcp__playwright__browser_install, mcp__playwright__browser_press_key, mcp__playwright__browser_type, mcp__playwright__browser_navigate, mcp__playwright__browser_navigate_back, mcp__playwright__browser_network_requests, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_drag, mcp__playwright__browser_hover, mcp__playwright__browser_select_option, mcp__playwright__browser_tabs, mcp__playwright__browser_wait_for
tags: [review]
---

# Accessibility Audit

Audit the pending UI changes against WCAG 2.1/2.2.

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

Use the accessibility-audit agent to audit the UI changes above. Execute the 6-phase POUR review process with live browser testing. Your final reply must contain the complete markdown accessibility audit report with screenshots for visual findings.

The audit baseline is **WCAG 2.1 Level AA**. WCAG 2.2 criteria are assessed and labeled as enhancements where applicable. Severity levels follow the project taxonomy:

- **Critical** — WCAG Level A failures (complete access barriers)
- **High** — WCAG Level AA failures (significant barriers, fix before merge)
- **Medium** — WCAG Level AAA or edge-case AA (fix in follow-up)
- **Low** — Best practice enhancements (no WCAG criterion violated)

## References

- `references/WCAG_CHECKLIST.md` — Full WCAG 2.1/2.2 checklist organized by POUR principles
- `references/ARIA_PATTERNS.md` — WAI-ARIA Authoring Practices 1.2 widget patterns and keyboard interactions
- `references/FALSE_POSITIVE_GUIDE.md` — Exclusion list and confidence thresholds for avoiding false positives
