# Typography

## Modular Scale & Hierarchy

The common mistake: too many font sizes that are too close together. This creates muddy hierarchy.

**Use fewer sizes with more contrast.** A 5-size system covers most needs:

| Role | Typical Size | Use Case |
|------|-------------|----------|
| xs | 0.75rem | Captions, legal |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body text |
| lg | 1.25-1.5rem | Subheadings, lead text |
| xl+ | 2-4rem | Headlines, hero text |

Size jumps should be dramatic (3x+, not 1.5x). Weight contrast: pair 100/200 with 800/900, not 400 with 600.

## Vertical Rhythm

Line-height should be the base unit for ALL vertical spacing. If body text has `line-height: 1.5` on `16px` type (= 24px), spacing values should be multiples of 24px.

## Readability

- Use `ch` units for measure: `max-width: 65ch`
- Line-height scales inversely with line length — narrow columns need tighter leading
- Increase line-height for light text on dark backgrounds (add 0.05-0.1)
- Minimum 16px body text — smaller strains eyes and fails WCAG on mobile

## Font Selection

### Fonts That Signal "I Didn't Think About This"

These are overused to the point of invisibility. Using them as a default choice signals generic, template-driven design:

- Inter, Roboto, Open Sans, Lato, Montserrat
- Arial, Helvetica, default system fonts

### Distinctive Alternatives

| Instead of | Try |
|-----------|-----|
| Inter | Instrument Sans, Plus Jakarta Sans, Outfit |
| Roboto | Onest, Figtree, Urbanist |
| Open Sans | Source Sans 3, Nunito Sans, DM Sans |

**By personality:**
- **Code aesthetic:** JetBrains Mono, Fira Code, Space Mono, IBM Plex Mono
- **Editorial:** Playfair Display, Crimson Pro, Fraunces, Newsreader, Lora
- **Modern:** Clash Display, Satoshi, Cabinet Grotesk, Bricolage Grotesque
- **Technical:** IBM Plex family, Source Sans 3, Space Grotesk

**System fonts are underrated** for apps where performance > personality: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`.

### Pairing

One well-chosen font family in multiple weights often beats two competing typefaces. Only add a second font when you need genuine contrast (display headlines + body serif). Never pair fonts that are similar but not identical.

When pairing, contrast on multiple axes: Serif + Sans, Geometric + Humanist, Condensed display + Wide body.

## Font Loading

```css
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* Match fallback metrics to minimize layout shift */
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;
  ascent-override: 90%;
  descent-override: 20%;
  line-gap-override: 10%;
}
```

## Fluid Type

Use `clamp(min, preferred, max)` for headings on marketing/content pages. Use fixed `rem` scales for app UIs and dashboards — no major design system uses fluid type in product UI.

```css
/* Headings on marketing pages */
.display { font-size: clamp(2rem, 5vw + 1rem, 4.5rem); }

/* App UI — fixed scale */
.heading { font-size: 1.5rem; }
```

## OpenType Features

```css
.data-table { font-variant-numeric: tabular-nums; }  /* Aligned numbers */
.recipe { font-variant-numeric: diagonal-fractions; }  /* Proper fractions */
abbr { font-variant-caps: all-small-caps; }            /* Abbreviations */
code { font-variant-ligatures: none; }                 /* No ligatures in code */
```

## Token Architecture

Name tokens semantically (`--text-body`, `--text-heading`), not by value (`--font-size-16`). Include font stacks, size scale, weights, line-heights, and letter-spacing.

## Accessibility

- Never disable zoom (`user-scalable=no`)
- Use `rem`/`em` for font sizes — respects user browser settings
- Minimum 16px body text
- Text links need padding or line-height that creates 44px+ tap targets
