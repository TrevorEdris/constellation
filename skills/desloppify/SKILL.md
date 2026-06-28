---
name: desloppify
description: "Use when cleaning up AI-generated output, reviewing text for AI tells, or improving signal-to-noise ratio in code comments, documentation, or prose."
context: fork
agent: desloppify
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status), Grep, Glob, LS, Read, Write, Edit
user-invocable: true
argument-hint: "[code|docs|prose|review]"
tags: [documentation]
tier: core
---

# Desloppify

Identify and remove AI-generated noise from code and text. Every comment, sentence, and code pattern must earn its place. If removing it loses no information, it is slop.

## Output Format

For EVERY finding, you MUST include ALL of these:
1. **File location** — filename and line number(s)
2. **Quoted text** — the exact slop text
3. **Pattern match** — which slop pattern it matches (e.g., "Narrator comment", "Filler opener", "Unnecessary try-catch")
4. **Severity** — CRITICAL, HIGH, MEDIUM, or LOW
5. **Suggested fix** — concrete rewrite OR "Delete entirely"

**CLEAN INPUT RULE:** If the code/text has no slop, report ONLY: "No slop patterns detected. The code/documentation is clean." Do NOT invent problems. Comments that explain WHY (business logic, performance decisions, external system behavior, security rationale, non-obvious implementation details) are NOT slop — leave them alone. It is better to report zero findings on clean code than to flag a legitimate comment.

## Severity Levels

| Severity | Meaning | Examples | Action |
|----------|---------|----------|--------|
| CRITICAL | Pure noise, zero information | `# Increment counter` on `counter += 1`; `# Return the result` on `return result`; section dividers `# ===== MAIN =====` | Delete entirely |
| HIGH | Restates what code/types already say | Docstrings that restate function name with buzzwords; narrator comments like "Now we initialize..." | Delete or reduce to essential |
| MEDIUM | Verbose but has buried signal | Apologetic "This shouldn't happen but just in case" around unnecessary try-catch; filler-heavy prose with some real content | Rewrite concisely |
| LOW | Borderline, stylistic | Single-use constants; minor hedging | Flag for human decision |

## Code Slop Patterns

### Comment Slop (detect these in comments/docstrings)

1. **Narrator comments** — restate function name: "This function processes the user request" above `processUserRequest()`. Severity: CRITICAL.
2. **Obvious comments** — restate the code: `counter += 1 # Increment counter`, `return result # Return the result`. Severity: CRITICAL.
3. **Section dividers** — decorative separators: `# ===== MAIN LOGIC =====`. Severity: HIGH.
4. **Step comments** — procedural narration: "Step 1: Validate", "First, we...", "Next, we...". Severity: HIGH.
5. **Over-documented trivials** — multi-line docstring on a one-liner where the type signature says everything. Severity: HIGH.
6. **Language tutorial comments** — explain what a for-loop or dictionary is. Severity: CRITICAL.
7. **Redundant type docs** — `@param {string} name` when TypeScript signature already has `name: string`. Severity: HIGH.
8. **Apologetic comments** — "This shouldn't happen but just in case", "This might not be the best approach". Severity: MEDIUM.
9. **Placeholder comments** — "TODO: implement", "Add your logic here", "Replace with actual". Severity: CRITICAL.

### Code Pattern Slop (detect these in the code itself)

1. **Unnecessary try-catch** — wrapping code that cannot throw (dict access on known keys, arithmetic, string ops) with defensive error handling. Look for: apologetic catch comments ("shouldn't happen", "just in case", "being extra cautious"), try-catch around infallible operations. Severity: HIGH.
2. **Defensive impossible-case handling** — null checks on non-optional params, type guards on already-typed values. Severity: HIGH.
3. **Single-use constants** — `MAGIC_OFFSET = 1` used exactly once, name restates the value. Severity: LOW.
4. **Empty/silent catch blocks** — catch errors and do nothing or just log. Severity: HIGH.

### CRITICAL: Distinguishing Justified vs. Unjustified Defensive Code

**Unjustified (SLOP):**
- Try-catch around `dict["known_key"]` when the dict structure is controlled
- Try-catch around `Path.read_text()` when the path is pre-validated
- Comments like "shouldn't happen", "just in case", "being extra cautious"

**Justified (NOT SLOP — leave these alone):**
- Try-catch around external API calls (HTTP requests, database queries)
- Try-catch around file I/O with user-provided paths
- Try-catch around deserialization of external data (JSON.parse of API response)
- Comments explaining specific failure modes: "API has 99.9% uptime but we've seen transient failures"

## Prose Slop Patterns

### Filler Phrases (always delete — the sentence after them is the real content)
- "It's worth noting that..."
- "It's important to consider..."
- "Interestingly, ..."
- "As mentioned previously..."
- "In order to..." (use "To")
- "Let's dive in" / "Let's explore"

### AI Vocabulary (replace with simpler words)
- robust -> strong, reliable, solid
- leverage -> use
- seamless -> smooth, easy
- comprehensive -> thorough, complete
- cutting-edge -> modern, current
- streamlined -> simple, efficient
- performant -> fast, efficient

### Promotional Adjectives (delete or replace with specifics)
- "groundbreaking", "revolutionary", "state-of-the-art"
- "powerful", "elegant", "innovative"

### Content Patterns
- **Idea repetition** — same concept restated in different words across paragraphs. Severity: HIGH.
- **Buzzword-stuffed docstrings** — function docs full of "robust", "comprehensive", "leverages". Severity: HIGH.

## Process

1. **Scan** — check every comment, docstring, and prose paragraph against the patterns above.
2. **Classify** — assign severity per the table. Group by severity.
3. **Report** — list all findings with location, quoted text, pattern, severity, and fix. End with a summary count.
