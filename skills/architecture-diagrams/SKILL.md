---
name: architecture-diagrams
description: Use when creating, editing, reviewing, or rendering software architecture or flow diagrams — C4 diagrams (system context, container, component, deployment, dynamic), sequence diagrams, request-flow visuals, or any Mermaid authoring where the rendered output must be readable. Also use when a Mermaid diagram renders with overlapping labels, parse errors, or a single-column layout, or when the user asks to "diagram the architecture", "draw the request flow", "map the sequences", or wants LucidChart-quality output from Mermaid.
---

# Architecture Diagrams (C4 + Mermaid)

Produce architecture and flow diagrams that are **accurate against the source
of truth** and **render cleanly** — then prove both before shipping. A diagram
that parses is not a diagram that reads; a diagram that reads is not a diagram
that's true.

Two failure classes account for nearly every bad diagram, and each has its own
countermeasure baked into this workflow:

1. **Content drift** — labels invented from memory instead of copied from the
   source: fabricated response fields, wrong error codes, routes that don't
   exist, phase/version attribution that contradicts the docs.
2. **Render failure** — syntactically valid Mermaid that renders unreadably:
   colliding labels, single-column spaghetti, cropped text, entry points
   ranked to the bottom of the page.

## Workflow

### 1. Pick the diagram set

Choose levels by audience — don't default to "all of them". Full selection
guidance and per-level element rules: `references/c4-model.md`.

| Diagram | Shows | Audience | Recommended? |
|---|---|---|---|
| System context | The system + users + external systems | Everyone, incl. non-technical | Always |
| Container | Deployable units, tech choices, comms | Technical | Always |
| Component | Inside one container | Architects, developers | Only when it adds value |
| Dynamic | One feature's runtime collaboration | Technical + non-technical | Sparingly — interesting/complex flows |
| Deployment | Containers mapped to infrastructure, one diagram **per environment** | DevOps, architects | For production systems |

Context + container are sufficient for most teams. A catalog of sequence
diagrams (dynamic, sequence-style) earns its place when the system has an
invariant or authz model worth proving flow-by-flow.

### 2. Anchor every label to a canonical source

Copy, don't recall. Every route, field name, table name, error code, and
technology label must be traceable to the architecture doc, spec, or code —
paraphrasing from memory is where fabricated `displayName` fields and wrong
409 codes come from. If no canonical doc exists, read the code first and cite
file paths in the diagram's surrounding prose. When the diagram set is large
or the content is invariant-critical, dispatch an adversarial reviewer per
diagram against the source docs — it will find real drift.

### 3. Author in Mermaid — but not Mermaid's C4 syntax

- **Static levels (context/container/component/deployment):** use `flowchart`
  with C4 conventions — `classDef` colors (dark blue person/instance, blue
  container, lighter blue component/infra, gray external), `[Type: technology]`
  bracket labels, subgraphs as boundaries/deployment nodes, and a prose key.
  Do **not** use Mermaid's native `C4Context`/`C4Container` diagram types:
  the layout engine stacks elements single-column with colliding relationship
  labels regardless of `UpdateLayoutConfig`, and no amount of styling rescues
  it.
- **Dynamic/request flows:** use `sequenceDiagram` with `autonumber` — the
  sequence presentation is one of C4's two official dynamic styles and
  Mermaid's sequence layout is excellent.

Read `references/mermaid-pitfalls.md` **before writing** — it lists the syntax
landmines (semicolons in message text, actor mirroring, rank cycles, subgraph
title collisions) that otherwise surface one render-failure at a time.

### 4. Render, then look

Parse success is not the bar. Render every diagram and inspect the image:

```bash
# extract each ```mermaid block to .mmd, then:
mmdc -i diagram.mmd -o diagram.png -w 1600 -s 2 -b white --quiet
```

Setup, the puppeteer/Chrome fallback for Homebrew installs, and an
extract-render loop script are in `references/mermaid-pitfalls.md`. Inspect
each PNG for: overlapping or garbled labels, the entry element rendered at
the bottom, cropped text at image edges, boundary titles colliding, and
anything a reader would have to squint at. Fix and re-render until clean.
Commit or deliver the rendered PNGs alongside the Mermaid source — reviewers
shouldn't need a renderer.

### 5. Final accuracy pass

Re-check every literal (paths, fields, codes, table/key names, phase or
version attributions) against the source one more time after layout fixes —
polish edits have a way of reintroducing drift. Cross-diagram consistency
matters too: the same participant/element must carry the same name and
technology label in every diagram of the set.

## Quality bar (every diagram)

- Every element has a name, a type, a technology (where applicable), and a
  one-line description.
- Arrows are unidirectional, labeled with a verb phrase plus technology
  ("Proxies request + verified claims [Lambda proxy event]"), never bare
  "uses".
- Under ~20 elements; split rather than cram.
- Request-flow diagrams number their steps.
- Deployment diagrams: one environment per diagram, and a browser-executed
  SPA is a container instance **in the browser node** — the CDN/bucket only
  serves its static assets.
- Every diagram has a title; shorthand titles get a key in surrounding prose.

## References

| File | Read when |
|---|---|
| `references/c4-model.md` | Choosing diagram levels, element/scope rules per level, deployment & dynamic specifics, common C4 modeling mistakes |
| `references/mermaid-pitfalls.md` | Before authoring any Mermaid; when a diagram fails to parse or renders badly; setting up mermaid-cli |
