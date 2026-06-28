# Spatial Design

## Spacing Systems

### Use 4pt Base, Not 8pt

8pt systems are too coarse — you frequently need 12px (between 8 and 16). Use 4pt for granularity: 4, 8, 12, 16, 24, 32, 48, 64, 96px.

Name tokens by relationship (`--space-sm`, `--space-lg`), not value (`--spacing-8`). Use `gap` instead of margins for sibling spacing — eliminates margin collapse.

## Grid Systems

### The Self-Adjusting Grid

```css
/* Responsive grid without breakpoints */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-md);
}
```

Columns are at least 280px, as many as fit per row, leftovers stretch. For complex layouts, use named grid areas and redefine at breakpoints.

## Visual Hierarchy

### The Squint Test

Blur your eyes (or screenshot and blur). Can you identify:
- The most important element?
- The second most important?
- Clear groupings?

If everything looks the same weight, you have a hierarchy problem.

### Hierarchy Through Multiple Dimensions

Don't rely on size alone. Combine:

| Tool | Strong Hierarchy | Weak Hierarchy |
|------|-----------------|----------------|
| Size | 3:1 ratio+ | <2:1 ratio |
| Weight | Bold vs Regular | Medium vs Regular |
| Color | High contrast | Similar tones |
| Position | Top/left (primary) | Bottom/right |
| Space | Surrounded by whitespace | Crowded |

The best hierarchy uses 2-3 dimensions at once.

### Cards Are Not Required

Cards are overused. Spacing and alignment create grouping naturally. Use cards only when:
- Content is truly distinct and actionable
- Items need visual comparison in a grid
- Content needs clear interaction boundaries

**Never nest cards inside cards** — use spacing, typography, and subtle dividers instead.

## Container Queries

Viewport queries are for page layouts. **Container queries are for components**:

```css
.card-container { container-type: inline-size; }

@container (min-width: 400px) {
  .card { grid-template-columns: 120px 1fr; }
}
```

A card in a narrow sidebar stays compact; the same card in main content expands — automatically.

## Optical Adjustments

- Text at `margin-left: 0` looks indented due to letterform whitespace — use negative margin (`-0.05em`)
- Geometrically centered icons look off-center; play icons shift right, arrows shift toward their direction

### Touch Targets vs Visual Size

Buttons can look small but need large touch targets (44px minimum):

```css
.icon-button {
  width: 24px; height: 24px;
  position: relative;
}
.icon-button::before {
  content: '';
  position: absolute;
  inset: -10px;  /* Expand tap target to 44px */
}
```

## Depth & Elevation

Create semantic z-index scales (dropdown → sticky → modal-backdrop → modal → toast → tooltip). Shadows should be subtle — if you can clearly see it, it's probably too strong.

## Layout Anti-Patterns

- Three-column feature sections (every SaaS site)
- Hero with centered text + image right
- Alternating image-left, text-right sections
- Same spacing everywhere (without rhythm, layouts feel monotonous)
- Centering everything — left-aligned text with asymmetric layouts feels more designed

**Instead:** Asymmetric layouts, overlapping elements, generous whitespace, large typography as layout element.
