# Design Principles

## Philosophy

- **Users First:** Prioritize user needs, workflows, and ease of use in every decision
- **Distinctive Over Generic:** Fight against "AI slop" aesthetics — every design choice should be intentional
- **Meticulous Craft:** Precision, polish, and high quality in every element and interaction
- **Speed & Performance:** Design for fast load times and snappy, responsive interactions
- **Simplicity & Clarity:** Clean, uncluttered interface with unambiguous labels and instructions
- **Accessibility (WCAG AA+):** Inclusivity is non-negotiable — contrast, keyboard nav, screen reader compatibility

## Domain References

For deep guidance on specific domains, consult:

| Domain | Reference | Key Topics |
|--------|-----------|------------|
| Typography | [typography.md](typography.md) | Modular scales, font selection, loading, OpenType |
| Color | [color-and-contrast.md](color-and-contrast.md) | OKLCH, tinted neutrals, dark mode, contrast ratios |
| Layout | [spatial-design.md](spatial-design.md) | Spacing systems, grids, hierarchy, container queries |
| Motion | [motion-design.md](motion-design.md) | Duration ladder, easing curves, reduced motion |
| Anti-Patterns | [ai-slop-test.md](ai-slop-test.md) | AI generation fingerprints, the slop test checklist |

## Quick Review Checklist

### Design System
- [ ] Color palette uses semantic tokens (not hard-coded values)
- [ ] Typography uses a modular scale with clear hierarchy
- [ ] Spacing follows a consistent system (4pt base recommended)
- [ ] Components have all states: default, hover, active, focus, disabled

### Layout & Hierarchy
- [ ] Visual hierarchy passes the squint test
- [ ] Responsive at 375px, 768px, 1440px
- [ ] Touch targets >= 44x44px on mobile
- [ ] No horizontal scroll at any viewport

### Accessibility (WCAG 2.1 AA)
- [ ] Color contrast >= 4.5:1 for text, >= 3:1 for UI components
- [ ] All interactive elements keyboard accessible with visible focus
- [ ] Semantic HTML structure (proper headings, landmarks, labels)
- [ ] Images have alt text; no reliance on color alone for information
- [ ] `prefers-reduced-motion` respected

### Performance
- [ ] Images lazy-loaded below fold
- [ ] Animations use transform/opacity only
- [ ] Core Web Vitals targets met
- [ ] No layout thrashing in animation loops
