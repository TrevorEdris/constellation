# Dockerfile Security Checklist

Severity levels: [CRITICAL] = block PR / [HIGH] = strong fix / [MEDIUM] = should fix / [LOW] = minor

---

## Identity and Privileges

- [ ] **[CRITICAL]** Non-root user defined with `USER` instruction
  - Use named user, not only numeric UID: `USER appuser:appuser`
  - Numeric fallback acceptable in distroless: `USER 65534:65534`
  - Root in container + writable filesystem + host path mount = container escape vector

- [ ] **[HIGH]** No `privileged: true` or `--privileged` in build args
  - Privileged flag grants full host capabilities — never needed for application containers

- [ ] **[HIGH]** `COPY --chown=user:group` used to set file ownership
  - Prevents files from being owned by root even when `USER` is set later

---

## Secrets Handling

- [ ] **[CRITICAL]** No credentials, tokens, or API keys in `ENV` or `ARG`
  - `ENV SECRET=mysecret` is visible in `docker inspect` and image layers
  - `ARG SECRET` is visible in build history (`docker history --no-trunc`)

- [ ] **[CRITICAL]** No `.env` files `COPY`ed without explicit `.dockerignore` exclusion
  - `.env` files containing secrets must be listed in `.dockerignore`

- [ ] **[HIGH]** Build-time secrets use `--mount=type=secret` (BuildKit)
  - Correct: `RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci`
  - Incorrect: `COPY .npmrc /root/.npmrc` (persists secret in layer)

- [ ] **[HIGH]** No `RUN curl ... | sh` or piped install scripts
  - Fetches arbitrary code at build time; not reproducible; can be compromised

---

## Base Image

- [ ] **[HIGH]** Base image is not pinned to `:latest`
  - `:latest` changes silently; pin to specific version: `node:22.11.0-alpine`
  - For maximum reproducibility, pin to digest: `FROM node:22-alpine@sha256:abc123...`

- [ ] **[HIGH]** Multi-stage build used — runtime image contains no build tools
  - No compiler, no package manager (apk/apt), no shell in production where possible
  - Prefer distroless for Go and Rust; slim for Python and Node

- [ ] **[MEDIUM]** Base image is from a trusted, actively maintained source
  - Official Docker Hub images (with `library/` prefix), Google Distroless, or your org's golden images
  - Avoid unverified community images for production

---

## Build Context

- [ ] **[HIGH]** `.dockerignore` exists and excludes sensitive paths
  - Must exclude: `.git`, `.env`, `.env.*`, `node_modules`, `target/`, `__pycache__`
  - Must exclude: any file containing credentials, SSH keys, or tokens
  - Large directories (node_modules, target/) also speed up `docker build`

---

## Package Installation

- [ ] **[MEDIUM]** Package cache is cleared in same `RUN` layer
  - Alpine: `apk add --no-cache ...`
  - Debian: `apt-get install -y ... && rm -rf /var/lib/apt/lists/*`
  - Clearing in a separate `RUN` does not reduce image size (layer already committed)

- [ ] **[MEDIUM]** Package versions are pinned where possible
  - Alpine: `apk add --no-cache curl=8.11.1-r0`
  - Prevents silent upgrades breaking reproducibility

---

## Filesystem

- [ ] **[MEDIUM]** Application files copied to a non-root directory
  - Avoid copying to `/` or `/etc` — use `/app` or `/srv`

- [ ] **[LOW]** `WORKDIR` is set explicitly before `COPY` and `RUN`
  - `WORKDIR /app` is clearer than relying on Docker's default working directory

---

## Network

- [ ] **[MEDIUM]** Only required ports are exposed via `EXPOSE`
  - `EXPOSE` is documentation — it does not bind the port; `docker run -p` does
  - Expose only application ports, not debug/admin ports

---

## Supply Chain

- [ ] **[HIGH]** Third-party `COPY --from=` references use pinned digests for external images
  - `COPY --from=gcr.io/distroless/static@sha256:abc123 ...` is reproducible
  - `COPY --from=gcr.io/distroless/static:latest ...` can change silently

---

## Hadolint Alignment

These checks align with the most commonly violated Hadolint rules:

| Rule | Description |
|------|-------------|
| DL3002 | Last USER should not be root |
| DL3003 | `cd` inside RUN — use WORKDIR instead |
| DL3006 | Always tag the version of the image |
| DL3007 | Using `latest` is prone to errors |
| DL3008 | Pin versions in apt-get install |
| DL3009 | Delete apt-get lists after installing |
| DL3013 | Pin versions in pip install |
| DL3018 | Pin versions in apk add |
| DL3025 | Use JSON notation for CMD and ENTRYPOINT |
| DL4006 | Set `SHELL` option when using pipe in RUN |
| SC2086 | Double-quote variable references in shell |

Run locally: `hadolint Dockerfile` or `docker run --rm -i hadolint/hadolint < Dockerfile`
