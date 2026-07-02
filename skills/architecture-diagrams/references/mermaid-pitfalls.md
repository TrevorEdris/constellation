# Mermaid Pitfalls and the Render-Validation Loop

Field notes from producing a full C4 set (context, container, component,
deployment ×2) plus a 10-diagram sequence catalog for a real system. Every
pitfall below was hit, diagnosed from an actual parse error or bad render,
and fixed. Read this before authoring; return to it when a render looks wrong.

## Authoring pitfalls

### 1. Never use Mermaid's native C4 syntax

`C4Context` / `C4Container` / `C4Component` / `C4Dynamic` parse fine and
render badly: the layout engine stacks elements in a single column with
relationship labels colliding into boxes, and `UpdateLayoutConfig` /
`UpdateRelStyle` offsets cannot rescue it. Rebuild the same semantics as a
`flowchart`:

- `subgraph` = system boundary / container boundary / deployment node
  (style dashed: `style boundaryId fill:none,stroke:#444,stroke-dasharray:5 5`)
- Node labels carry the C4 element info:
  `api["<b>api Lambda</b><br/>[Container: Go]<br/><i>description</i>"]`
- `classDef` for the C4 palette — person `#08427b` (rounded), container/
  instance `#1168bd`, component/infra `#63a3d4`, external `#999999`; extra
  colors to highlight load-bearing elements.
- Databases: `ddb[("label")]` cylinder shape.
- For dynamic diagrams use `sequenceDiagram` instead — Mermaid's sequence
  layout is genuinely good.

### 2. Semicolons terminate Mermaid statements — even inside message text

`H->>DB: resolve DNS; deny private ranges` is a parse error: everything after
`;` is parsed as a new statement. This is the single most common sequence-
diagram parse failure. Use commas, em dashes, or line breaks (`<br/>`)
instead. Colons after the first are fine; `≠`, `→`, `·`, quotes, and
parentheses are fine inside message text.

### 3. Disable actor mirroring in sequence diagrams

Default `sequenceDiagram` repeats the actor/participant boxes at the bottom,
and multi-line actor labels crop against the image edge there. Kill the
mirror:

```
%%{init: {"sequence": {"mirrorActors": false}}}%%
sequenceDiagram
  autonumber
```

`autonumber` gives you C4-dynamic step numbering for free — but any prose
that says "after step N" must be re-checked against the rendered numbering.

### 4. Return edges create rank cycles that sink your entry point

In a `flowchart`, an edge from the last element back to the first
(`serializer -.-> apigw` when `apigw --> adapter` exists) forms a cycle, and
dagre may resolve it by ranking the **entry element at the bottom** of the
diagram. Fix: point the return edge at an element *inside* the boundary
(e.g. the adapter the response actually flows back through) — often more
truthful anyway — so the entry node keeps only outgoing rank pressure and
renders at the top.

### 5. Long titles on adjacent subgraphs collide

Sibling subgraphs at the same rank render their titles side by side; two long
titles overlap into garbage ("CDN Adge]on Cognito"). Keep subgraph titles
short (`"CloudFront [CDN]"`, not `"Amazon CloudFront [Infrastructure Node:
CDN edge]"`) and move the type detail into a prose key next to the diagram —
the C4 notation guidance explicitly blesses a key for shorthand.

### 6. Assorted label rules

- `<br/>`, `<b>`, `<i>` work in node labels and edge labels (htmlLabels).
- Quote flowchart edge labels: `A -- "verb [tech]" --> B`.
- Don't pass empty strings as trailing args to anything — omit the arg or
  write a real value.
- The word "end" lowercase inside flowchart labels can break parsing — cap it
  or rephrase if a block mysteriously fails.

## The render-validation loop

Parse success ≠ readable. Render every diagram and **look at the image**
before shipping. Repeat: author → extract → render → inspect → fix.

### Extract and render

```bash
python3 - <<'EOF'
import re
src = open('DIAGRAMS.md').read()
for i, b in enumerate(re.findall(r'```mermaid\n(.*?)```', src, re.S)):
    open(f'd{i}.mmd', 'w').write(b)
EOF
for f in d*.mmd; do
  mmdc -i "$f" -o "${f%.mmd}.png" -w 1600 -s 2 -b white --quiet \
    && echo "OK $f" || echo "FAIL $f"
done
```

`-s 2` for crisp PNGs; `-w 1600`–`1800` for wide sequence diagrams. Ship the
PNGs alongside the source so reviewers don't need a renderer.

### mermaid-cli setup gotcha (macOS/Homebrew)

Homebrew's `mmdc` ships without puppeteer's `chrome-headless-shell` and fails
with "Could not find chrome-headless-shell". Two fixes:

```bash
# Option A: point puppeteer at installed Chrome (no download)
cat > pptr.json <<'EOF'
{ "executablePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "headless": true }
EOF
mmdc -p pptr.json -i d.mmd -o d.png ...

# Option B: install the headless shell once
npx puppeteer browsers install chrome-headless-shell
```

`npx -y @mermaid-js/mermaid-cli@11` works without a local install (slower
first run).

### Visual inspection checklist

Scan every rendered PNG for:

- Overlapping or garbled text anywhere (edge labels into boxes, subgraph
  titles into each other).
- The flow's entry element rendered somewhere other than the top (rank cycle
  — see pitfall 4).
- Cropped text at image edges (actor mirroring — pitfall 3 — or width too
  small).
- Edge labels sitting far from their edges or ambiguous about which edge
  they belong to.
- Numbered steps: does the visual order match the numbering? Do surrounding
  prose references ("after step N") match the rendered numbers?

## Accuracy discipline (content, not syntax)

Layout fixes are where content drift sneaks back in. After the render loop:

- Re-verify every literal against the canonical source: routes, field names,
  table/key names, error codes, status codes, technology versions,
  phase/version attributions. Fabrication pattern to watch for: a plausible
  field (`displayName`) that appears in no schema, or an error code spelled
  three plausible ways across diagrams.
- Cross-diagram consistency: one name and technology label per element across
  the whole set; shapes returned to each actor class identical wherever the
  same call appears.
- For invariant-critical or large diagram sets, dispatch one adversarial
  reviewer per diagram with the source docs and instructions to refute every
  label — it finds drift the author cannot see.
