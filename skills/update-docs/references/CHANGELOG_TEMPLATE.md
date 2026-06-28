# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- New features and capabilities.

### Changed

- Changes to existing functionality.
- Breaking changes must include a **Migration** subsection below the entry.

### Deprecated

- Features that will be removed in a future release. Include the planned removal version if known.

### Removed

- Features removed in this release.

### Fixed

- Bug fixes. Reference the issue number where applicable: `Fixes #123`.

### Security

- Vulnerability fixes. Reference CVE identifiers where applicable.

---

<!-- RELEASE TEMPLATE — copy this block when cutting a release, fill in version and date -->

## [X.Y.Z] - YYYY-MM-DD

### Added

-

### Changed

-

### Fixed

-

---

## Classification Rules (for the documentation-sync agent)

The agent maps commits to changelog sections using these rules:

| Signal | Section |
|--------|---------|
| `feat:` prefix or new exported symbols | Added |
| `fix:` prefix | Fixed |
| `refactor:` prefix with no API surface change | Changed |
| `deprecate:` prefix or `@deprecated` annotation in source | Deprecated |
| `security:` prefix or CVE reference in commit body | Security |
| `BREAKING CHANGE:` in commit body | Changed (with Migration subsection) |
| `chore:`, `style:`, `test:`, `ci:` | Omit unless user-visible |
| No conventional prefix — diff-based classification | Agent uses file paths and diff content as fallback |

### Breaking Change Entry Format

When a breaking change is detected, the agent generates entries in this format:

```markdown
### Changed

- **BREAKING:** Renamed `oldFunctionName` to `newFunctionName`. All callers must update references.

  **Migration:** Replace `oldFunctionName(args)` with `newFunctionName(args)`.
  See [migration guide](docs/migrations/vX-to-vY.md) for full details.
```

### Grouping Commits

The agent groups related commits to avoid one-to-one commit-to-entry mapping. Commits touching the same feature or subsystem are collapsed into a single changelog entry summarizing the overall change.
