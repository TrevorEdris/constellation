# ARIA Patterns Reference

Based on WAI-ARIA Authoring Practices 1.2 (https://www.w3.org/WAI/ARIA/apg/patterns/).

---

## Rule Zero: Use Native HTML First

> "No ARIA is better than bad ARIA."

Before applying ARIA, ask: **Is there a native HTML element that provides this semantics?**

| Need | Native HTML | Do Not Use |
|------|------------|-----------|
| Button | `<button>` | `<div role="button">` |
| Link | `<a href="...">` | `<span role="link">` |
| Checkbox | `<input type="checkbox">` | `<div role="checkbox">` |
| Radio group | `<fieldset>` + `<input type="radio">` | `<div role="radiogroup">` |
| Select | `<select>` | Custom combobox (unless native `<select>` is insufficient) |
| Text input | `<input type="text">` or `<textarea>` | `<div contenteditable>` without ARIA |
| Heading | `<h1>`–`<h6>` | `<div role="heading" aria-level="2">` |

Native HTML elements have built-in keyboard interaction, accessible name computation, and browser/AT interoperability. Use ARIA only when native HTML cannot fulfill the requirement.

---

## Landmark Roles

Landmarks divide the page into navigable regions. Screen reader users rely on landmarks for efficient navigation.

| Role | HTML Element | Use |
|------|-------------|-----|
| `banner` | `<header>` (top-level) | Site header with logo and primary navigation |
| `navigation` | `<nav>` | Primary or secondary navigation links |
| `main` | `<main>` | Primary page content |
| `complementary` | `<aside>` | Supporting content (sidebars) |
| `contentinfo` | `<footer>` (top-level) | Footer with copyright, legal links |
| `form` | `<form>` with accessible name | A form region |
| `search` | `<search>` (HTML 5.2) or `role="search"` | Search functionality |
| `region` | `<section>` with accessible name | Generic landmark, use sparingly |

**Rules:**
- Every page should have exactly one `main` landmark
- Multiple `navigation` landmarks must have unique accessible names (`aria-label` or `aria-labelledby`)
- Do not nest `banner` or `contentinfo` landmarks inside other landmarks
- Avoid over-use of `region`; it creates landmark noise

---

## Widget Patterns

### Accordion

An accordion is a set of vertically stacked interactive headings that reveal/hide associated panels.

**Required roles:**
- Container: No specific role required (use semantic heading + button structure)
- Each trigger: `<button>` element (or `role="button"`)
- Each panel: No specific role; controlled by the trigger

**Required ARIA states:**
- `aria-expanded="true|false"` on the trigger button
- `aria-controls="panel-id"` on the trigger (optional but helpful)

**Keyboard interaction:**
- `Tab` — Moves focus to next accordion trigger
- `Enter` or `Space` — Toggles the focused panel open/closed
- `Arrow Down/Up` — Optionally moves focus between triggers (if implementing roving tabindex)

**Example:**
```html
<h3>
  <button aria-expanded="false" aria-controls="panel1">
    Section 1
  </button>
</h3>
<div id="panel1" hidden>
  Panel content...
</div>
```

**Common mistakes:**
- Missing `aria-expanded` on the trigger
- Applying `aria-expanded` to the panel instead of the trigger
- Using `display: none` on panel without toggling `hidden` attribute or `aria-hidden`

---

### Alert

A live region for important, time-sensitive messages. Screen readers announce immediately on insert.

**Required roles:**
- `role="alert"` — Implies `aria-live="assertive"` and `aria-atomic="true"`

**ARIA live alternative:**
- `aria-live="assertive"` — Same behavior as `role="alert"` without semantic role

**When to use `role="alert"` vs `role="status"`:**
- `role="alert"` (assertive): Errors, critical warnings — announces immediately and interrupts
- `role="status"` (polite): Success messages, non-critical updates — announces when AT is idle

**Keyboard interaction:** None — alerts receive no focus; they are announced passively.

**Example:**
```html
<div role="alert">
  Error: The email address is not valid.
</div>
```

**Common mistakes:**
- Pre-populating the alert container with content on page load (AT may not announce content present before the element is rendered)
- Injecting content via CSS `::before`/`::after` (not announced by all AT)
- Using `role="alert"` for non-urgent status updates (creates unnecessary interruption)

---

### Alert Dialog

A modal dialog that requires user acknowledgment before proceeding.

**Required roles:**
- `role="alertdialog"` on the dialog container
- `aria-modal="true"` on the dialog container
- `aria-labelledby` pointing to the dialog title
- `aria-describedby` pointing to the alert message

**Keyboard interaction:**
- `Tab` / `Shift+Tab` — Cycles focus within the dialog
- `Escape` — Closes the dialog and returns focus to trigger (if cancellable)
- Focus must be trapped within the dialog while open

**Example:**
```html
<div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc">
  <h2 id="dlg-title">Confirm Deletion</h2>
  <p id="dlg-desc">Are you sure you want to delete this item? This action cannot be undone.</p>
  <button>Cancel</button>
  <button>Delete</button>
</div>
```

---

### Button (Toggle)

A button that maintains an on/off state.

**Required roles:**
- Native `<button>` element (preferred) or `role="button"`
- `aria-pressed="true|false"` for toggle state

**Keyboard interaction:**
- `Enter` or `Space` — Activates the button and toggles state
- `Tab` — Moves focus to button

**Example:**
```html
<button aria-pressed="false">Mute</button>
```

**Common mistakes:**
- Using `aria-checked` instead of `aria-pressed` on a button (aria-checked is for checkboxes and switches)
- Forgetting to update `aria-pressed` value when state changes

---

### Combobox (Autocomplete)

An input with a popup listbox for suggestions.

**Required roles:**
- Input: `role="combobox"`, `aria-expanded="true|false"`, `aria-controls="listbox-id"`, `aria-autocomplete="list|both|none"`
- Popup: `role="listbox"` with `id` matching `aria-controls`
- Options: `role="option"`, `aria-selected="true|false"`

**Keyboard interaction:**
- `Down Arrow` — Opens popup (if closed); moves focus to first/next option
- `Up Arrow` — Moves focus to previous option
- `Enter` — Selects focused option, closes popup
- `Escape` — Closes popup without selection, restores typed value
- `Alt + Down Arrow` — Opens popup without moving focus to options
- `Alt + Up Arrow` — Selects focused option and closes popup

**Active descendant pattern (preferred for combobox):**
- Keep focus on the input (`role="combobox"`)
- Use `aria-activedescendant="option-id"` to point to the currently highlighted option
- This avoids removing focus from the text input while navigating options

**Example:**
```html
<input role="combobox" aria-expanded="true" aria-controls="suggestions" aria-autocomplete="list" aria-activedescendant="opt2">
<ul id="suggestions" role="listbox">
  <li id="opt1" role="option" aria-selected="false">Apple</li>
  <li id="opt2" role="option" aria-selected="true">Apricot</li>
</ul>
```

---

### Dialog (Modal)

A window requiring user interaction before the user can return to the rest of the application.

**Required roles:**
- `role="dialog"` on the dialog container
- `aria-modal="true"` on the dialog container
- `aria-labelledby` pointing to the dialog title
- Optionally `aria-describedby` for dialog description

**Keyboard interaction:**
- `Tab` / `Shift+Tab` — Cycles focus within the dialog (focus trap)
- `Escape` — Closes dialog, restores focus to trigger element
- On open: Focus moves to first focusable element or to dialog container

**Example:**
```html
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <h2 id="modal-title">Settings</h2>
  <button aria-label="Close">×</button>
  <!-- modal content -->
</div>
```

**Common mistakes:**
- Not implementing focus trap (users can Tab out of the modal)
- Not returning focus to the trigger element on close
- Using `aria-modal="true"` without actually trapping focus (aria-modal is a hint, not a mechanism)
- Opening a dialog and sending focus to the close button instead of the first actionable item

---

### Disclosure (Show/Hide)

A button that shows or hides a section of content.

**Required roles:**
- Trigger: Native `<button>` (preferred)
- `aria-expanded="true|false"` on the trigger
- Optionally `aria-controls="content-id"` on the trigger

**Keyboard interaction:**
- `Enter` or `Space` — Toggles the disclosure
- `Tab` — Moves focus to trigger

**Example:**
```html
<button aria-expanded="false" aria-controls="details">Show details</button>
<div id="details" hidden>
  More detailed content here.
</div>
```

---

### Menu / Menubar

A menu presents a set of actions or functions. A menubar is a horizontal row of menus.

**Required roles:**
- Container: `role="menu"` or `role="menubar"`
- Items: `role="menuitem"`, `role="menuitemcheckbox"`, `role="menuitemradio"`
- Sub-menu container: `role="menu"`
- Trigger for sub-menu: `role="menuitem"` with `aria-haspopup="menu"` and `aria-expanded="true|false"`

**Keyboard interaction (menu):**
- `Down Arrow` — Moves focus to next menuitem
- `Up Arrow` — Moves focus to previous menuitem
- `Enter` or `Space` — Activates focused menuitem
- `Escape` — Closes menu, returns focus to trigger
- `Home` / `End` — Moves focus to first/last menuitem

**Keyboard interaction (menubar):**
- `Left Arrow` / `Right Arrow` — Moves focus between top-level menu triggers
- `Down Arrow` — Opens focused menu's submenu, moves focus to first item
- `Escape` — Closes open submenu

**Pattern: Roving tabindex**
- Only one item in the menu has `tabindex="0"` at a time
- All others have `tabindex="-1"`
- Arrow keys move focus and update which item has `tabindex="0"`

**Important:** `role="menu"` is for application menus (like a toolbar), NOT for navigation. Use `<nav>` with links for site navigation.

---

### Tabs

A tab set presents multiple panels where only one panel is visible at a time.

**Required roles:**
- Tab container: `role="tablist"`
- Individual tabs: `role="tab"`, `aria-selected="true|false"`, `aria-controls="panel-id"`
- Panels: `role="tabpanel"`, `aria-labelledby="tab-id"`, `tabindex="0"` (to make panel focusable)

**Keyboard interaction:**
- `Left Arrow` / `Right Arrow` — Moves focus between tabs (automatic activation or manual activation)
- `Home` / `End` — Moves focus to first/last tab
- `Tab` — Moves focus from tab to associated panel
- `Shift+Tab` — Moves focus from panel back to selected tab

**Automatic vs manual activation:**
- **Automatic:** Arrow key moves focus AND activates the tab immediately. Simpler, but can cause issues if panel loading is expensive.
- **Manual:** Arrow key moves focus only; `Enter` or `Space` activates the tab. Required when panel content has side effects.

**Example:**
```html
<div role="tablist" aria-label="Settings sections">
  <button role="tab" aria-selected="true" aria-controls="panel-general" id="tab-general">General</button>
  <button role="tab" aria-selected="false" aria-controls="panel-security" id="tab-security" tabindex="-1">Security</button>
</div>
<div role="tabpanel" id="panel-general" aria-labelledby="tab-general" tabindex="0">
  General settings content...
</div>
<div role="tabpanel" id="panel-security" aria-labelledby="tab-security" tabindex="0" hidden>
  Security settings content...
</div>
```

---

### Tooltip

A popup that displays information related to an element on hover or focus.

**Required roles:**
- Tooltip container: `role="tooltip"`
- Trigger: `aria-describedby` pointing to the tooltip `id`

**Keyboard interaction:**
- `Escape` — Dismisses the tooltip
- Tooltip appears on focus (keyboard) and hover (pointer)
- Tooltip is persistent while the trigger is focused

**Example:**
```html
<button aria-describedby="tooltip1">Save</button>
<div role="tooltip" id="tooltip1">Saves your work to the cloud</div>
```

**Common mistakes:**
- Using `aria-labelledby` instead of `aria-describedby` (tooltip supplements, not replaces, the button label)
- Not showing the tooltip on keyboard focus (only on hover)
- Tooltip disappearing before the user can read it

---

### Tree View

A hierarchical list of items that can be expanded and collapsed.

**Required roles:**
- Tree container: `role="tree"`
- Tree items: `role="treeitem"`, `aria-expanded="true|false"` (for parent items), `aria-level`, `aria-posinset`, `aria-setsize`
- Group (nested items): `role="group"`
- Selected state: `aria-selected="true|false"` (for selectable trees)

**Keyboard interaction:**
- `Down Arrow` — Moves focus to next visible treeitem
- `Up Arrow` — Moves focus to previous visible treeitem
- `Right Arrow` — If collapsed, expands; if expanded, moves to first child
- `Left Arrow` — If expanded, collapses; if collapsed, moves to parent
- `Enter` — Activates item (opens file, navigates, etc.)
- `Home` / `End` — Moves to first/last visible treeitem

---

## Live Regions

Live regions announce dynamic content changes to screen reader users without requiring focus movement.

| Attribute / Role | Behavior |
|-----------------|----------|
| `aria-live="polite"` | Announces when AT is idle. Use for non-urgent updates. |
| `aria-live="assertive"` | Announces immediately, interrupting current speech. Use only for critical, time-sensitive alerts. |
| `role="status"` | Implies `aria-live="polite"`. Use for success messages, status updates. |
| `role="alert"` | Implies `aria-live="assertive"` and `aria-atomic="true"`. Use for errors and critical warnings. |
| `role="log"` | Implies `aria-live="polite"`. Use for chat logs, audit logs. |
| `aria-atomic="true"` | Announces the entire region as a unit when any part changes. |
| `aria-atomic="false"` | Announces only the changed nodes. |
| `aria-relevant="additions"` | Only announce added nodes (default behavior). |
| `aria-relevant="removals"` | Announce removed nodes. |
| `aria-relevant="text"` | Announce text content changes. |
| `aria-relevant="all"` | Announce all changes. |

**Best practices:**
- Keep live region containers present in the DOM from page load; only inject content dynamically
- Avoid changing `aria-live` attribute value dynamically (set once at load time)
- Do not use `aria-live="assertive"` for anything other than genuine emergencies (errors that require immediate action)
- Test live regions with a real screen reader — automated tools often cannot verify announcement timing

---

## Common ARIA Mistakes

| Mistake | Why It's a Problem | Correct Approach |
|---------|-------------------|-----------------|
| `aria-label` on a `<div>` or `<p>` | Labels have no effect on non-interactive, non-landmark elements | Use a visible label or heading instead |
| `role="button"` on `<a href="...">` | Conflicts with link semantics; keyboard behavior differs | Use `<button>` for actions, `<a>` for navigation |
| `aria-hidden="true"` on a focusable element | Element still receives focus but is invisible to AT — creates ghost tab stops | Remove from tab order with `tabindex="-1"` or restructure |
| `role="presentation"` with focusable descendants | Strips semantics from children, making them opaque to AT | Do not use `role="presentation"` on elements containing interactive children |
| Missing `aria-expanded` on disclosure triggers | AT cannot announce collapsed/expanded state | Add `aria-expanded="true|false"` to the trigger, toggle on interaction |
| Duplicate `id` attributes | Breaks `aria-labelledby`, `aria-describedby`, and `aria-controls` associations | Ensure all `id` values are unique within the document |
| `aria-label` overriding visible text | Causes label-in-name failure (WCAG 2.5.3) when accessible name differs from visible label | Make `aria-label` include the visible text, or use `aria-labelledby` |
| Using `aria-required` instead of HTML `required` | Both work, but mixing can cause inconsistencies | Prefer native `required` attribute; browser handles validation announcement |
| `role="button"` on `<button>` | Redundant; not harmful but noisy | Remove redundant role |
| `aria-disabled="true"` without visual indication | Hides the disabled state from sighted users | Pair with visual disabled styling |
