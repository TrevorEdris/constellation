# Color & Contrast

## Use OKLCH, Not HSL

OKLCH is perceptually uniform — equal steps in lightness *look* equal. HSL lies: 50% lightness in yellow looks bright, 50% in blue looks dark.

```css
/* OKLCH: lightness (0-100%), chroma (0-0.4+), hue (0-360) */
--color-primary: oklch(60% 0.15 250);
--color-primary-light: oklch(85% 0.08 250);  /* Reduce chroma at extremes */
--color-primary-dark: oklch(35% 0.12 250);
```

As you move toward white or black, reduce chroma. High chroma at extreme lightness looks garish.

## Tinted Neutrals

Pure gray has no personality. Add a subtle hint of your brand hue:

```css
/* Dead grays — no personality */
--gray-100: oklch(95% 0 0);

/* Warm-tinted (add brand warmth) */
--gray-100: oklch(95% 0.01 60);

/* Cool-tinted (tech, professional) */
--gray-100: oklch(95% 0.01 250);
```

Chroma of 0.005-0.01 is enough to feel natural without being obviously tinted.

## Palette Structure

| Role | Purpose |
|------|---------|
| **Primary** | Brand, CTAs, key actions — 1 color, 3-5 shades |
| **Neutral** | Text, backgrounds, borders — 9-11 shade scale |
| **Semantic** | Success, error, warning, info — 4 colors, 2-3 shades each |
| **Surface** | Cards, modals, overlays — 2-3 elevation levels |

Skip secondary/tertiary unless needed. Most apps work fine with one accent color.

## The 60-30-10 Rule

About **visual weight**, not pixel count:
- **60%**: Neutral backgrounds, white space, base surfaces
- **30%**: Secondary colors — text, borders, inactive states
- **10%**: Accent — CTAs, highlights, focus states

The common mistake: using the accent color everywhere. Accent colors work *because* they're rare.

## WCAG Contrast Requirements

| Content Type | AA Minimum | AAA Target |
|-------------|-----------|-----------|
| Body text | 4.5:1 | 7:1 |
| Large text (18px+ or 14px bold) | 3:1 | 4.5:1 |
| UI components, icons | 3:1 | 4.5:1 |
| Placeholder text | 4.5:1 | 4.5:1 |

**Placeholder text still needs 4.5:1.** Light gray placeholders almost always fail WCAG.

## Dangerous Combinations

- Light gray text on white (#1 accessibility fail)
- **Gray text on any colored background** — looks washed out; use a darker shade of the background color instead
- Red on green (8% of men can't distinguish)
- Blue on red (vibrates visually)
- Yellow on white (almost always fails)
- Thin light text on images (unpredictable contrast)

## Never Use Pure Black or Pure Gray

Pure black (#000) and pure gray don't exist in nature. Even chroma 0.005-0.01 feels natural without being obviously tinted. Always tint.

## Dark Mode

Dark mode is NOT inverted light mode. It requires different design decisions:

| Light Mode | Dark Mode |
|-----------|-----------|
| Shadows for depth | Lighter surfaces for depth (no shadows) |
| Dark text on light | Light text on dark (reduce font weight) |
| Vibrant accents | Desaturate accents slightly |
| White backgrounds | Never pure black — use dark gray (oklch 12-18%) |

```css
:root[data-theme="dark"] {
  --surface-1: oklch(15% 0.01 250);
  --surface-2: oklch(20% 0.01 250);  /* "Higher" = lighter */
  --surface-3: oklch(25% 0.01 250);
  --body-weight: 350;  /* Reduce text weight in dark mode */
}
```

## Token Hierarchy

Use two layers: primitive tokens (`--blue-500`) and semantic tokens (`--color-primary: var(--blue-500)`). For dark mode, only redefine the semantic layer.

## Alpha Is a Design Smell

Heavy use of transparency usually means an incomplete palette. Alpha creates unpredictable contrast and performance overhead. Define explicit overlay colors instead. Exception: focus rings and interactive states.
