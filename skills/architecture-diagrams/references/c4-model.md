# The C4 Model, Distilled

Condensed from [c4model.com/diagrams](https://c4model.com/diagrams) and its
per-diagram pages. C4 = four levels of zoom over one static model — (system)
**C**ontext, **C**ontainers, **C**omponents, **C**ode — plus three supporting
diagram types. Different zoom levels tell different stories to different
audiences; you rarely need all four. **Context + container diagrams are
sufficient for most software development teams.**

## Abstractions

- **Software system** — the highest level; something that delivers value to
  its users. Your system, and the external systems it talks to.
- **Container** — an application or data store: a deployable/runnable unit
  (server-side app, SPA, mobile app, database schema, file bucket, serverless
  function). *Not* a Docker container specifically.
- **Component** — a grouping of related functionality inside a container,
  behind a well-defined interface. Not separately deployable — if it deploys
  on its own, it's a container.
- **Code** — classes/functions. Rarely diagrammed by hand; generate if needed.

## Level 1 — System context

- **Shows:** your system as a box in the center, surrounded by its users and
  the systems it interacts with. Big picture; detail deliberately absent —
  people and systems, not technologies or protocols.
- **Scope:** a single software system.
- **Primary elements:** the system in scope. **Supporting:** directly
  connected people (actors/roles/personas) and external systems (things you
  don't own or operate).
- **Audience:** everybody, technical and non-technical.
- **Recommended:** always.

## Level 2 — Container

- **Shows:** the high-level shape of the architecture: how responsibilities
  are distributed, the major technology choices, and how containers
  communicate.
- **Scope:** a single software system. **Primary:** containers inside it.
  **Supporting:** people and external systems directly connected to those
  containers.
- **Audience:** technical people in and around the team, incl. ops/support.
- **Recommended:** always.
- **Note (from the official page):** the container diagram says nothing about
  clustering, load balancing, replication, or failover — that varies per
  environment and belongs in **deployment diagrams, one per environment**.

## Level 3 — Component

- **Shows:** the components inside one container, their responsibilities, and
  technology/implementation details.
- **Scope:** a single container. **Primary:** its components. **Supporting:**
  the container's siblings plus directly connected people/systems.
- **Audience:** architects and developers.
- **Recommended:** **no — only when it adds value**; consider generating it
  for long-lived documentation. It earns its place when a container holds a
  load-bearing internal structure worth showing (e.g. an authz middleware
  chain and a serialization choke point on a request path).

## Supporting — Dynamic

- **Shows:** how static-model elements collaborate at runtime for one
  feature/story/use case. Two equivalent styles: **collaboration** (free-form
  boxes with numbered interactions, from UML communication diagrams) and
  **sequence** (UML-sequence-style lanes). Pick either; sequence renders best
  in Mermaid.
- **Scope:** one feature/story/use case. **Elements:** your choice — systems,
  containers, or components interacting at runtime.
- **Audience:** technical and non-technical.
- **Recommended:** sparingly — for interesting or recurring patterns and
  flows with complicated interactions. Number the steps to show ordering.

## Supporting — Deployment

- **Shows:** how instances of systems/containers map onto infrastructure in
  **one deployment environment** (production, staging, local dev, ...). Based
  on UML deployment diagrams.
- **Deployment node:** where an instance runs — physical, virtual,
  containerized, or an execution environment. **Nodes nest** (account →
  service → runtime). Add **infrastructure nodes** (DNS, load balancers, CDN)
  where relevant.
- **Elements:** deployment nodes, system/container instances, infrastructure
  nodes.
- **Audience:** technical, incl. ops/infra.
- **Recommended:** yes, for production systems.
- Vendor icons (AWS/Azure/GCP) are fine — include them in the diagram key.

## Notation (any level)

C4 is notation-independent; whatever you draw must satisfy:

- Every element: **name, type, technology (where applicable), description**.
  Don't strip type labels to "simplify" — they carry the level semantics.
- Every relationship: **unidirectional**, labeled with an action verb phrase
  and technology ("Reads from [JDBC]", not "uses"). Bidirectional arrows hide
  who initiates.
- A **title** on every diagram; a **key/legend** whenever shapes, colors, or
  shorthand titles carry meaning.
- Keep each diagram under ~20 elements; split rather than cram.

## Common modeling mistakes

- **Container vs component confusion** — if it deploys independently, it's a
  container; if it's a code-level grouping, it's a component. No in-between
  "subcomponent" levels.
- **Shared libraries as containers** — they aren't; they deploy inside one.
- **One big "Kafka" box** — model individual topics/queues as containers so
  publish/subscribe relationships are visible.
- **SPA misplacement in deployment diagrams** — the SPA executes **in the
  user's browser** (a deployment node on the user's device); S3/CDN nodes
  only serve its static build artifacts.
- **Multi-environment deployment diagrams** — one environment per diagram,
  always. A local dev harness (e.g. Docker Compose + emulators) is its own
  environment and deserves its own diagram, including notes on what is
  deliberately absent versus production.
- **Microservice ownership** — a microservice owned by your team is a
  container (or container group); one owned by another team is better
  modeled as an external software system.
