# Documentation Style Guide

Standards for all documentation generated or updated by the `documentation-sync` agent.
Human authors should also follow these standards for consistency.

---

## Voice and Tense

- Use active voice. "The function returns a list" not "A list is returned by the function."
- Use present tense. "Accepts a string" not "Accepted a string" or "Will accept a string."
- Describe what the code does, not what it might do or what the developer intended.
- Do not editorialize. "The handler validates the input" not "The handler elegantly validates the input."

## Sentence and Line Structure

- One sentence per line in markdown source. This improves git diff readability.
- Keep sentences short (target: under 20 words).
- Use parallel structure within lists. If one item starts with a verb, all items start with a verb.

Example (correct):

```markdown
- Returns the user record on success.
- Returns `null` if the user does not exist.
- Throws `AuthError` if the caller is not authenticated.
```

Example (incorrect — mixed structure):

```markdown
- Returns the user record on success.
- null is returned when the user isn't found.
- An AuthError exception is thrown for unauthenticated callers.
```

## Code Examples

- All code examples in auto-generated sections must be runnable. No pseudo-code.
- Use fenced code blocks with a language identifier on every block.
- Code examples must match the current API signatures. The agent verifies this before writing.
- Include enough context to run the example (imports, initialization) when the block is the first usage example.

```python
# Correct: runnable, matches current signature
from mylib import compute_score

score = compute_score(user_id=42, metric="engagement")
print(score)  # Returns float
```

```python
# Incorrect: pseudo-code, not runnable
score = compute_score(user, metric)  # some metric
```

## File Paths and References

- Link to files using relative paths from the document's location, not from the repo root.
- Verify that all linked files exist before publishing. The agent performs this check automatically.
- Use backtick formatting for all file names, paths, command names, environment variable names, and code identifiers in prose.

Example: The configuration is loaded from `config/settings.yaml`.

## Auto-Generated Sections

- Auto-generated sections are bounded by `<!-- AUTO-GENERATED:START(name) -->` and `<!-- AUTO-GENERATED:END(name) -->`.
- Each section includes a `<!-- Generated: YYYY-MM-DD -->` timestamp.
- Never write manually inside an auto-generated section. Changes will be overwritten on the next sync.
- The `(name)` label in the marker identifies the section type: `badges`, `setup`, `api`, `config`, `contributing`, `usage-examples`.

## Version and Date Stamps

- Auto-generated sections include `<!-- Generated: YYYY-MM-DD -->` immediately after the `START` marker.
- Do not include timestamps in manually written sections.
- Version references in auto-generated content come from the project's version manifest (`package.json`, `pyproject.toml`, `go.mod`, etc.).

## What to Omit

- No marketing language. "Blazing-fast" and "battle-tested" are not documentation.
- No superlatives. "The best way to…" is an opinion, not a fact.
- No filler. "It's important to note that…" adds nothing. State the fact.
- No placeholders in final output. `TODO`, `TBD`, `FIXME`, and `<placeholder>` must not appear in generated sections. The agent flags these as validation failures.
- No redundant preamble. Do not restate the section heading in the first sentence.

## Factual Accuracy

- Document observable behavior only. Do not infer intent from variable names or comments alone.
- If a function's behavior is ambiguous (e.g., inconsistent error handling), document what the code actually does and note the ambiguity.
- Do not document future plans or roadmap items in reference documentation. Roadmap content belongs in a separate file (e.g., `ROADMAP.md`).

## Changelog Entries

- Changelog entries describe the impact on users, not the implementation detail.
  - Correct: "Added `--dry-run` flag to `deploy` command."
  - Incorrect: "Added early return condition in `deployHandler` function."
- Breaking changes include a `Migration` subsection with a concrete before/after example.
- Security entries include the CVE identifier if one exists.
- Group related changes into a single entry when they address the same user-visible feature or fix.

## Links

- Use descriptive link text. Avoid "click here" and bare URLs in prose.
- Internal cross-references use relative paths. External references use full URLs.
- The agent verifies internal links resolve before writing. External link validation is out of scope.

## Tables

- Use markdown tables for reference information (configuration options, API parameters, flag descriptions).
- Keep table columns to four or fewer for readability.
- Align pipe characters for readability in source, but do not rely on alignment for correctness.

## Headings

- Use sentence case for headings. "Getting started" not "Getting Started" (exception: proper nouns).
- Do not skip heading levels (e.g., jump from `##` to `####`).
- Auto-generated sections use the heading level that fits their position in the document.
