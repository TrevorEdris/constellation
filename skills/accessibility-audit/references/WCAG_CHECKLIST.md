# WCAG 2.1/2.2 Checklist

Organized by the POUR principles. Baseline: **WCAG 2.1 Level AA**. WCAG 2.2 additions are labeled.

Use this checklist to track coverage during the audit. Mark each criterion as:
- `[x]` Passed — criterion met
- `[!]` Failed — finding raised in report
- `[-]` N/A — criterion not applicable to this content
- `[?]` Needs manual verification — automated check inconclusive

---

## P — Perceivable

Content must be presentable in ways users can perceive.

### Non-text Content

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 1.1.1 Non-text Content | A | `[ ]` All informative images have descriptive `alt` text |
| 1.1.1 Non-text Content | A | `[ ]` Decorative images use `alt=""` or `aria-hidden="true"` |
| 1.1.1 Non-text Content | A | `[ ]` Icon-only buttons have accessible name via `aria-label` or visually-hidden text |
| 1.1.1 Non-text Content | A | `[ ]` Complex images (charts, diagrams) have long descriptions or equivalent data |
| 1.1.1 Non-text Content | A | `[ ]` `<input type="image">` has `alt` attribute |
| 1.1.1 Non-text Content | A | `[ ]` CAPTCHA provides text alternative or audio alternative |

**Testing method:** Use `browser_snapshot` to inspect accessibility tree. Verify `alt` attributes and accessible names for all non-text elements.

---

### Time-based Media

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 1.2.1 Audio-only and Video-only | A | `[ ]` Pre-recorded audio-only has transcript |
| 1.2.1 Audio-only and Video-only | A | `[ ]` Pre-recorded video-only has audio description or text alternative |
| 1.2.2 Captions (Pre-recorded) | A | `[ ]` Pre-recorded video has synchronized captions |
| 1.2.3 Audio Description / Media Alternative | A | `[ ]` Pre-recorded video has audio description or text alternative |
| 1.2.4 Captions (Live) | AA | `[ ]` Live video has captions |
| 1.2.5 Audio Description (Pre-recorded) | AA | `[ ]` Pre-recorded video has audio description |

**Testing method:** Visual inspection of video/audio elements. Verify caption tracks and transcript links.

---

### Adaptable

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 1.3.1 Info and Relationships | A | `[ ]` Heading hierarchy is logical (no skipped levels) |
| 1.3.1 Info and Relationships | A | `[ ]` Lists use `<ul>`, `<ol>`, or `<dl>` — not styled `<div>` elements |
| 1.3.1 Info and Relationships | A | `[ ]` Data tables use `<th>` with `scope` attributes |
| 1.3.1 Info and Relationships | A | `[ ]` Form inputs are associated with labels |
| 1.3.1 Info and Relationships | A | `[ ]` Grouped controls use `<fieldset>` and `<legend>` |
| 1.3.2 Meaningful Sequence | A | `[ ]` DOM reading order matches meaningful visual sequence |
| 1.3.2 Meaningful Sequence | A | `[ ]` CSS reordering (flexbox `order`, grid placement) does not create confusing reading order |
| 1.3.3 Sensory Characteristics | A | `[ ]` Instructions do not rely solely on shape, color, size, or position |
| 1.3.4 Orientation | AA | `[ ]` Content not restricted to single orientation unless essential |
| 1.3.5 Identify Input Purpose | AA | `[ ]` Personal data fields have correct `autocomplete` attribute |

**Autocomplete values for common fields:**
- Name: `name`, `given-name`, `family-name`
- Email: `email`
- Phone: `tel`
- Address: `street-address`, `postal-code`, `country`
- Credit card: `cc-number`, `cc-exp`, `cc-csc`
- Username: `username`
- Password: `current-password`, `new-password`

**Testing method:** `browser_snapshot` for heading structure and ARIA roles. Code review for semantic HTML and autocomplete attributes.

---

### Distinguishable

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 1.4.1 Use of Color | A | `[ ]` Color is not the sole means of conveying information |
| 1.4.1 Use of Color | A | `[ ]` Error states use text or icons in addition to red color |
| 1.4.1 Use of Color | A | `[ ]` Required field indicators are not color-only |
| 1.4.2 Audio Control | A | `[ ]` Auto-playing audio can be paused, stopped, or volume-reduced |
| 1.4.3 Contrast (Minimum) | AA | `[ ]` Normal text meets 4.5:1 contrast ratio |
| 1.4.3 Contrast (Minimum) | AA | `[ ]` Large text (18pt+ or 14pt+ bold) meets 3:1 contrast ratio |
| 1.4.4 Resize Text | AA | `[ ]` Text scales to 200% without loss of content or functionality |
| 1.4.5 Images of Text | AA | `[ ]` Real text is used instead of images of text (exception: logotypes) |
| 1.4.10 Reflow | AA | `[ ]` Content reflows at 320px width without horizontal scroll |
| 1.4.11 Non-text Contrast | AA | `[ ]` UI component boundaries meet 3:1 contrast against adjacent color |
| 1.4.11 Non-text Contrast | AA | `[ ]` Graphical objects required for understanding meet 3:1 contrast |
| 1.4.12 Text Spacing | AA | `[ ]` No content lost with: line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em |
| 1.4.13 Content on Hover or Focus | AA | `[ ]` Tooltip/popover is dismissible (Escape), hoverable, and persistent |

**Contrast ratio calculation:**
```
Relative luminance: L = 0.2126*R + 0.7152*G + 0.0722*B
(Linearize: C <= 0.04045 → C/12.92; C > 0.04045 → ((C+0.055)/1.055)^2.4)
Contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05)
```

**Exemptions from contrast requirements:**
- Inactive (disabled) UI components
- Decorative elements with no informational value
- Logotypes and brand names
- Placeholder text (not relied upon for critical information)
- Syntax-highlighted code blocks

**Testing method:** `browser_evaluate` to extract computed colors. Manual calculation or contrast tool verification.

---

## O — Operable

UI components and navigation must be operable.

### Keyboard Accessible

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 2.1.1 Keyboard | A | `[ ]` All functionality operable via keyboard |
| 2.1.1 Keyboard | A | `[ ]` All interactive elements reachable via Tab |
| 2.1.2 No Keyboard Trap | A | `[ ]` Focus can always be moved away from any component |
| 2.1.2 No Keyboard Trap | A | `[ ]` Modal dialogs trap focus internally but not permanently |
| 2.1.4 Character Key Shortcuts | A | `[ ]` Single-character keyboard shortcuts can be remapped, disabled, or are only active on focus |

**Testing method:** Manual keyboard navigation (Tab, Shift+Tab, Enter, Space, Escape, Arrow keys). Use `browser_press_key` and `browser_snapshot` to trace focus path.

---

### Enough Time

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 2.2.1 Timing Adjustable | A | `[ ]` Time limits can be turned off, extended, or adjusted (exception: real-time events) |
| 2.2.2 Pause, Stop, Hide | A | `[ ]` Moving/blinking/scrolling content can be paused (if > 5 seconds) |
| 2.2.2 Pause, Stop, Hide | A | `[ ]` Auto-updating content can be paused or controlled |

---

### Seizures and Physical Reactions

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 2.3.1 Three Flashes or Below Threshold | A | `[ ]` No content flashes more than 3 times per second |

---

### Navigable

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 2.4.1 Bypass Blocks | A | `[ ]` Skip-to-main-content link is present and functional |
| 2.4.2 Page Titled | A | `[ ]` Page has descriptive `<title>` element |
| 2.4.3 Focus Order | A | `[ ]` Focus order is logical and meaningful |
| 2.4.3 Focus Order | A | `[ ]` No `tabindex` values greater than 0 |
| 2.4.4 Link Purpose (In Context) | A | `[ ]` Link purpose determinable from text or context |
| 2.4.4 Link Purpose (In Context) | A | `[ ]` No "click here", "read more" without surrounding context |
| 2.4.5 Multiple Ways | AA | `[ ]` Multiple ways to find pages exist (search, sitemap, etc.) |
| 2.4.6 Headings and Labels | AA | `[ ]` Headings and labels are descriptive |
| 2.4.7 Focus Visible | AA | `[ ]` Keyboard focus indicator is visible on all interactive elements |
| 2.4.11 Focus Not Obscured (Minimum) | AA (WCAG 2.2) | `[ ]` Focused element not fully hidden by sticky UI (header, banners, overlays) |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA (WCAG 2.2) | `[ ]` Focused element not partially hidden |
| 2.4.13 Focus Appearance | AAA (WCAG 2.2) | `[ ]` Focus indicator: area >= 2 CSS px perimeter, 3:1 contrast change |

---

### Input Modalities

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 2.5.1 Pointer Gestures | A | `[ ]` Multipoint/path-based gestures have single-pointer alternative |
| 2.5.2 Pointer Cancellation | A | `[ ]` Down-event not used to execute function (or up-event reverses/aborts) |
| 2.5.3 Label in Name | A | `[ ]` Accessible name contains visible label text |
| 2.5.4 Motion Actuation | A | `[ ]` Device-motion functions have UI alternative; motion response can be disabled |
| 2.5.7 Dragging Movements | AA (WCAG 2.2) | `[ ]` All drag-and-drop operations have a single-pointer alternative |
| 2.5.8 Target Size (Minimum) | AA (WCAG 2.2) | `[ ]` Interactive targets are at least 24x24 CSS pixels |

**Recommended target size:** 44x44px (WCAG 2.5.5 AAA). Targets between 24px and 44px should be noted as Medium issues.

**Testing method:** Resize to 375px viewport, use `browser_evaluate` with `getBoundingClientRect()` to measure touch targets.

---

## U — Understandable

Content and operation must be understandable.

### Readable

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 3.1.1 Language of Page | A | `[ ]` `<html>` element has `lang` attribute with valid language tag |
| 3.1.2 Language of Parts | AA | `[ ]` Content in a different language uses `lang` attribute on containing element |

---

### Predictable

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 3.2.1 On Focus | A | `[ ]` Focusing an element does not cause context change |
| 3.2.2 On Input | A | `[ ]` Changing a field value does not cause unexpected context change |
| 3.2.3 Consistent Navigation | AA | `[ ]` Navigation appears in same relative order across pages |
| 3.2.4 Consistent Identification | AA | `[ ]` Same functionality identified consistently across pages |
| 3.2.6 Consistent Help | A (WCAG 2.2) | `[ ]` Help mechanisms appear in same relative order across pages |

---

### Input Assistance

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 3.3.1 Error Identification | A | `[ ]` Input errors identified and described in text |
| 3.3.1 Error Identification | A | `[ ]` Error message programmatically associated with field (`aria-describedby` or `aria-errormessage`) |
| 3.3.2 Labels or Instructions | A | `[ ]` All form inputs have visible labels |
| 3.3.2 Labels or Instructions | A | `[ ]` Complex inputs include format instructions |
| 3.3.3 Error Suggestion | AA | `[ ]` Error messages include actionable correction suggestions |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | `[ ]` Submissions are reversible, verifiable, or confirmable |
| 3.3.7 Redundant Entry | A (WCAG 2.2) | `[ ]` Previously entered info is auto-populated or selectable |
| 3.3.8 Accessible Authentication (Minimum) | AA (WCAG 2.2) | `[ ]` Auth does not require cognitive function test without alternative |
| 3.3.9 Accessible Authentication (Enhanced) | AAA (WCAG 2.2) | `[ ]` Auth requires no cognitive function test at all |

---

## R — Robust

Content must be robust enough to be interpreted by assistive technologies.

### Compatible

| Criterion | Level | Checklist Item |
|-----------|-------|---------------|
| 4.1.2 Name, Role, Value | A | `[ ]` All interactive components expose name, role, and value |
| 4.1.2 Name, Role, Value | A | `[ ]` Custom widgets have appropriate ARIA roles |
| 4.1.2 Name, Role, Value | A | `[ ]` ARIA states and properties update to reflect current state |
| 4.1.2 Name, Role, Value | A | `[ ]` No `aria-hidden="true"` on focusable elements |
| 4.1.2 Name, Role, Value | A | `[ ]` No duplicate `id` attributes (breaks labelledby/describedby associations) |
| 4.1.3 Status Messages | AA | `[ ]` Success/error/loading messages announced without focus via live region |
| 4.1.3 Status Messages | AA | `[ ]` `role="alert"` or `aria-live="assertive"` used only for urgent updates |
| 4.1.3 Status Messages | AA | `[ ]` `role="status"` or `aria-live="polite"` used for non-urgent updates |

**Testing method:** `browser_snapshot` for accessibility tree inspection. `browser_evaluate` to trigger state changes and verify ARIA attribute updates.

---

## Quick Reference: Severity Mapping

| WCAG Level | Typical Severity | Rationale |
|------------|-----------------|-----------|
| Level A failure | Critical | Complete barrier for affected disability category |
| Level AA failure | High | Significant usability barrier |
| Level AAA opportunity | Medium | Enhancement, not required |
| Best practice (no criterion) | Low | No WCAG violation |
| WCAG 2.2 new criteria (AA) | High | Required for 2.2 compliance |
| WCAG 2.2 new criteria (AAA) | Medium | Enhancement |
