# False Positive Guide

This guide defines what the accessibility audit should NOT report as violations. Apply these exclusions before adding any finding to the report. When in doubt, investigate further rather than reporting speculatively.

**Confidence threshold:** Only report findings with >= 0.7 confidence of an actual access barrier. Automated signals require manual verification before inclusion.

---

## Hard Exclusions

Do not report the following under any circumstances:

### 1. Framework-Correct ARIA Implementations

Many UI component libraries generate correct ARIA patterns by default. Before flagging an ARIA issue in a component from these libraries, verify that the component is actually misconfigured or used incorrectly — not that it simply uses a non-obvious but valid pattern.

**Libraries with correct ARIA defaults (when used as documented):**
- **Radix UI** — Generates correct `aria-expanded`, `aria-controls`, `aria-selected`, focus management, and keyboard interactions for all primitives
- **HeadlessUI** (Tailwind Labs) — Correct ARIA for Dialog, Combobox, Listbox, Menu, Popover, Tabs, Transition
- **Reach UI** — Correct ARIA for Dialog, Menu, Tabs, Combobox, Slider, Tooltip
- **MUI (Material UI)** — Correct ARIA when using the component API (not when using raw HTML inside MUI wrappers incorrectly)
- **Chakra UI** — Correct ARIA for all composed components
- **shadcn/ui** — Built on Radix primitives; correct ARIA when used as generated
- **React Aria (Adobe)** — Designed explicitly for accessibility; correct by construction
- **Ariakit** — Correct ARIA by design

**How to verify:** If an ARIA attribute looks unusual, check the library's documentation. If the library documents that behavior, it is not a violation.

**What IS reportable from these libraries:**
- Incorrect usage of the component API (e.g., providing wrong props that disable built-in accessibility)
- Overriding ARIA attributes in ways that break the component's accessibility contract
- Using raw HTML instead of the accessible component primitive

---

### 2. Test Files, Storybook Stories, and Dev-Only Components

Code that never ships to users is out of scope for accessibility review.

**Exclusion patterns:**
- `*.test.tsx`, `*.spec.tsx`, `*.test.ts`, `*.spec.ts`
- `*.stories.tsx`, `*.stories.ts`, `*.stories.mdx`
- `__tests__/` directories
- Files gated by `process.env.NODE_ENV === 'development'`
- Files gated by `process.env.NODE_ENV === 'test'`
- Cypress/Playwright/E2E test fixture files

**Note:** Storybook stories themselves may be worth making accessible as developer tooling, but they are not production UI and violations there do not block merge.

---

### 3. Third-Party Embedded Iframes

Content inside a cross-origin iframe is controlled by the third party and is outside the scope of a PR-level audit.

**How to handle:** Note the presence of embedded third-party content in the report with a recommendation:

> "The `<iframe>` at [selector] embeds content from [domain]. Accessibility of this embedded content is outside the scope of this audit. If this widget is essential to the user workflow, request an accessibility statement or conformance report from the vendor."

**Do not:** Count iframe content violations against the overall audit result, or report specific iframe issues as team findings.

**Examples:** Stripe payment iframe, Google Maps embed, YouTube embed, Intercom chat widget, HubSpot form embed.

---

### 4. Content Behind Disabled Feature Flags

Code paths that are not reachable in the tested environment are out of scope.

**Exclusion criteria:**
- Feature flag is confirmed disabled in the preview environment
- Component is conditionally rendered by a flag and the condition evaluates to false
- Route is behind a permission check not granted in the test account

**What IS reportable:** The accessibility of the flag-gated UI in a development environment if the flag can be enabled for testing.

---

### 5. Decorative Images with Explicit `alt=""`

An image with `alt=""` is correctly marked as decorative. Screen readers will skip it. This is correct WCAG 1.1.1 implementation.

**Not a violation:** `<img src="divider.png" alt="">` or `<img src="background.png" role="presentation">`

**What IS a violation:** An image that conveys information but has `alt=""` (e.g., a product photo with no text description, a chart with only `alt=""`)

**How to distinguish:** Ask — does the user need the image's content to understand or use the page? If yes, it needs a description.

---

### 6. Redundant ARIA on Native HTML Elements

ARIA roles that duplicate native HTML semantics are harmless noise, not violations.

**Examples (informational, not reportable):**
- `<button role="button">` — redundant but not harmful
- `<a role="link">` — redundant but not harmful
- `<input type="checkbox" role="checkbox">` — redundant but not harmful
- `<h2 role="heading" aria-level="2">` — redundant but not harmful

**Report as a note (not a severity finding) only if:** The redundancy suggests confusion about ARIA that might lead to actual errors elsewhere in the component.

**What IS reportable:** Conflicting roles, e.g., `<a role="button">` (link semantics vs button behavior creates keyboard and AT inconsistency), or `<nav role="menu">` (changes landmark to application widget).

---

### 7. Color Contrast in Syntax-Highlighted Code Blocks

Code blocks using syntax highlighting (e.g., Prism.js, highlight.js, Shiki) use color conventions from programming language ecosystems. WCAG does not require these to meet contrast thresholds.

**Rationale:** Syntax highlighting is not relied upon for critical information; the code text itself conveys the meaning. This is analogous to WCAG's exception for "incidental" text and decorative text.

**What IS reportable:** The overall code block background vs text contrast (the base readability of the code), not the specific token colors.

---

### 8. Placeholder Text Contrast

HTML input placeholder text does not need to meet 4.5:1 contrast ratio. WCAG criterion 1.4.3 applies to actual text content, not placeholder hints.

**Rationale:** Placeholder text is informational only and is not relied upon for critical information. The visible label (which must meet contrast requirements) is the primary accessor.

**What IS reportable:** The input label contrast, or if placeholder text is being used AS the label (with no visible label elsewhere) — that is a WCAG 3.3.2 (Labels or Instructions) violation.

---

### 9. Disabled Element Contrast

WCAG 1.4.3 explicitly exempts inactive UI components from contrast requirements:

> "Text or images of text that are part of an inactive user interface component... have no contrast requirement."

**Applies to:**
- `<button disabled>`
- `<input disabled>`
- Form fields with `aria-disabled="true"`
- Menu items with `aria-disabled="true"`

**What IS reportable:** Elements that appear disabled but are still interactive (the disabled styling is misleading, not an exemption).

---

### 10. PDF/Document Viewer Embedded Content

Accessibility of content rendered within a PDF viewer (PDF.js, Google Docs Viewer, etc.) or a document editor embedded as an iframe requires a separate, specialized audit.

**How to handle:** Note in the report:

> "The embedded document viewer at [selector] contains content beyond the scope of this HTML accessibility audit. PDF accessibility should be verified separately using Adobe Acrobat Pro, PAC 3, or equivalent PDF accessibility checker."

---

## Confidence Thresholds

Before adding a finding to the report, assess your confidence that this is a real access barrier.

| Confidence | Action |
|-----------|--------|
| >= 0.9 | Report with high confidence statement |
| 0.7 – 0.9 | Report with verification note |
| 0.5 – 0.7 | Investigate further; do not report until resolved |
| < 0.5 | Do not report |

**When to investigate further:**
- Contrast calculation involves CSS custom properties — resolve the actual computed value before reporting
- ARIA appears missing but the component uses a non-obvious but valid pattern — verify against library docs
- Focus order appears illogical — verify against visual layout before concluding it's a failure

---

## Context-Dependent Judgments

These situations require analysis before determining whether to report.

### Missing Alt Text

**Investigate before reporting:**
1. Is the image purely decorative (spacer, background texture, purely aesthetic illustration)?
2. Does the surrounding text already describe the image's content?
3. Is the image inside a link or button that already has an accessible name?

**Report:** Image conveys unique information not available in surrounding text and has no `alt` text.
**Do not report:** Decorative image with `alt=""`, or image inside a button where the button's accessible name is sufficient.

---

### Missing Form Labels

**Investigate before reporting:**
1. Check for `aria-label` on the input element
2. Check for `aria-labelledby` pointing to a visible label
3. Check for a visually-hidden label pattern (`sr-only`, `visually-hidden` utility class)
4. Check for `<label>` with matching `for` attribute referencing the input's `id`

**Report:** None of the above are present.
**Do not report:** Input is labeled via any valid mechanism, even if not a visible `<label>`.

---

### Tab Order Issues

**Investigate before reporting:**
1. Verify the visual layout — sometimes DOM order differs intentionally (CSS grid/flexbox reordering for visual presentation)
2. Verify the logical reading order — does the focus sequence make sense even if it differs from visual order?
3. Verify whether the DOM order (not visual order) is what a screen reader would follow

**Report:** Tab sequence is confusing, illogical, or actively misleading for a keyboard user.
**Do not report:** Visual reordering that is purely cosmetic and the DOM order still provides a sensible logical sequence.

---

### Focus Indicators

**Investigate before reporting:**
1. Check `outline` property in computed styles
2. Check `box-shadow` property — many design systems use inset box-shadow as focus rings
3. Check `outline-offset` — a large offset can move the ring outside the element bounds
4. Check the containing element — a parent may clip the focus ring with `overflow: hidden`

**Report:** No visible change occurs on focus by any of the above mechanisms, OR the focus ring is clipped and invisible.
**Do not report:** `outline: none` when an equivalent custom focus style (box-shadow, border change, background change) is present and meets 3:1 contrast against adjacent colors.

---

### ARIA States on Framework Components

**Investigate before reporting:**
1. Trigger the interaction (click, expand, select) and use `browser_snapshot` to verify the ARIA state updates
2. Check whether the framework manages state internally (e.g., Radix manages `aria-expanded` internally)
3. Inspect the accessibility tree after the interaction, not just in the static HTML

**Report:** ARIA state is present in the DOM but does not update when the user interacts with the widget.
**Do not report:** ARIA state appears absent in static HTML but the framework correctly injects and updates it at runtime.

---

## Summary Decision Tree

```
Finding identified
       │
       ▼
Is this in a test file or Storybook story?
  YES → Exclude
  NO  → Continue
       │
       ▼
Is this inside a third-party iframe?
  YES → Note (do not count as violation)
  NO  → Continue
       │
       ▼
Is this behind a disabled feature flag?
  YES → Exclude
  NO  → Continue
       │
       ▼
Is this a framework component used as documented?
  YES → Verify misconfiguration before reporting
  NO  → Continue
       │
       ▼
Is this in the Hard Exclusions list (disabled contrast, placeholder, etc.)?
  YES → Exclude
  NO  → Continue
       │
       ▼
Is confidence >= 0.7?
  NO  → Investigate further or exclude
  YES → Include in report with appropriate severity
```
