# AI Slop Test

The fingerprints of AI-generated interfaces from 2024-2025. If an interface triggers multiple items on this list, it looks machine-generated — and users notice.

**The test:** If you showed this interface to someone and said "AI made this," would they believe you immediately? If yes, it needs more work.

## Typography Tells

- [ ] Inter, Roboto, Open Sans, or system defaults used without deliberate reason
- [ ] Monospace typography as lazy shorthand for "technical/developer" vibes
- [ ] Large rounded-corner icons above every heading
- [ ] Tiny size jumps between heading levels (1.5x instead of 3x+)
- [ ] Font weight contrast of 400 vs 600 (instead of 200 vs 800+)

## Color Tells

- [ ] Purple-to-blue gradient (the universal AI slop signal)
- [ ] Cyan-on-dark or neon accents on dark backgrounds
- [ ] Gray text on colored backgrounds (washed out, dead)
- [ ] Pure black (#000) or pure white (#fff) without tinting
- [ ] Gradient text on headings or metrics (decorative, not meaningful)
- [ ] Oversaturated primary blue (#0066FF)
- [ ] Dark mode with glowing accents as default (avoids actual design decisions)

## Layout Tells

- [ ] Three-column feature grid with identical cards
- [ ] Hero with centered text (+ optional image right)
- [ ] Alternating image-left, text-right sections
- [ ] Cards nested inside cards
- [ ] Everything centered — no left-alignment or asymmetry
- [ ] Same spacing everywhere (no rhythm or variation)
- [ ] Hero metric layout: big number, small label, supporting stats, gradient accent

## Visual Detail Tells

- [ ] Glassmorphism (blur effects, glass cards, glow borders) used decoratively
- [ ] Rounded rectangles with generic drop shadows
- [ ] Rounded element with thick colored border on one side
- [ ] Sparklines as decoration (tiny charts that convey nothing)
- [ ] Generic abstract blob shapes as backgrounds

## Motion Tells

- [ ] Bounce or elastic easing (feels dated, tacky)
- [ ] `ease` as default timing function
- [ ] Animating layout properties (width, height, padding) instead of transform/opacity
- [ ] No `prefers-reduced-motion` support

## Interaction Tells

- [ ] Every button is primary (no ghost buttons, text links, or secondary styles)
- [ ] Modals for everything (modals are lazy)
- [ ] Redundant headers and intros that restate the heading
- [ ] Empty states that just say "nothing here" (no guidance or next action)

## How to Use This in Review

1. **Run the checklist first** — before any other design assessment
2. **Count the hits** — 0-1 is fine, 2-3 is concerning, 4+ is AI slop
3. **Call it out directly** — "This triggers N items on the AI slop test"
4. **Recommend specific fixes** — point to the domain references (typography, color, spatial, motion) for alternatives
5. **Re-check after changes** — the goal is zero tells

A distinctive interface makes someone ask "how was this made?" not "which AI made this?"
