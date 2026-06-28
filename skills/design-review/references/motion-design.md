# Motion Design

## Duration Ladder

| Duration | Use Case | Examples |
|----------|----------|---------|
| 100-150ms | Instant feedback | Button press, toggle, color change |
| 200-300ms | State changes | Menu open, tooltip, hover states |
| 300-500ms | Layout changes | Accordion, modal, drawer |
| 500-800ms | Entrance animations | Page load, hero reveals |

Exit animations should be ~75% of entrance duration.

## Easing Curves

**Don't use `ease`.** It's a compromise that's rarely optimal.

| Curve | Use For | CSS |
|-------|---------|-----|
| ease-out | Elements entering | `cubic-bezier(0.16, 1, 0.3, 1)` |
| ease-in | Elements leaving | `cubic-bezier(0.7, 0, 0.84, 0)` |
| ease-in-out | State toggles | `cubic-bezier(0.65, 0, 0.35, 1)` |

**For micro-interactions, use exponential curves** — they mimic real physics:

```css
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);    /* Smooth, refined */
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);    /* Slightly dramatic */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);      /* Snappy, confident */
```

**Never use bounce or elastic easing.** They feel dated and amateurish. Real objects decelerate smoothly.

## Only Animate Transform and Opacity

Everything else causes layout recalculation. For height animations:

```css
/* Use grid-template-rows instead of animating height */
.accordion {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms ease-out;
}
.accordion.open {
  grid-template-rows: 1fr;
}
.accordion > div {
  overflow: hidden;
}
```

## Staggered Animations

```css
.item {
  animation: slide-up 500ms var(--ease-out-quart) forwards;
  animation-delay: calc(var(--i, 0) * 50ms);
  opacity: 0;
}
```

Set `style="--i: 0"`, `--i: 1`, etc. on each item. **Cap total stagger time** — 10 items at 50ms = 500ms. For many items, reduce per-item delay or cap the staggered count.

## Reduced Motion

This is not optional. Vestibular disorders affect ~35% of adults over 40.

```css
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: fade-in 200ms ease-out;  /* Crossfade instead of spatial motion */
  }
}
```

Preserve functional animations (progress bars, loading spinners, focus indicators) — just without spatial movement.

## The 80ms Threshold

Our brains buffer sensory input for ~80ms. Anything under 80ms feels instant. This is the target for micro-interactions.

## Perceived Performance

- **Optimistic UI**: Update immediately, sync later (good for low-stakes actions)
- **Skeleton screens**: Show structure immediately, fill in data
- **Progressive rendering**: Don't wait for everything to load
- **Ease-in toward completion**: Makes tasks feel shorter (peak-end effect)

**Caution**: Too-fast responses can decrease perceived value for complex operations.

## Performance Rules

- Don't use `will-change` preemptively — only when animation is imminent
- Use Intersection Observer for scroll-triggered animations; unobserve after animating once
- Create motion tokens for consistency (durations, easings, common transitions)

## Anti-Patterns

- Animating everything (animation fatigue)
- Durations >500ms for UI feedback
- Movement without purpose
- Using animation to hide slow loading
- Bounce/elastic easing (dated, tacky)
