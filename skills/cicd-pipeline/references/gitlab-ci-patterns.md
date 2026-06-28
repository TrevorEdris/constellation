# GitLab CI Patterns

Practical patterns for production-grade GitLab CI/CD pipelines.

---

## Pipeline Structure

A `.gitlab-ci.yml` file defines stages and jobs. Jobs in the same stage run in parallel; stages run sequentially.

```yaml
stages:
  - lint
  - test
  - build
  - deploy

lint:
  stage: lint
  script:
    - golangci-lint run ./...

test:
  stage: test
  script:
    - go test -race -coverprofile=coverage.out ./...

build:
  stage: build
  script:
    - go build -o dist/app ./cmd/app
```

---

## `include` for Shared Templates

Split large pipelines into composable files using `include`.

```yaml
# .gitlab-ci.yml
include:
  - local: '.gitlab/ci/lint.yml'           # Same repo, different file
  - project: 'org/shared-ci'              # Another project in the same GitLab instance
    ref: main
    file: '/templates/go.yml'
  - remote: 'https://example.com/ci.yml'  # External URL (pinned to commit is safer)
  - template: 'Security/SAST.gitlab-ci.yml'  # GitLab built-in template
```

**Best practice:** Keep job templates in `.gitlab/ci/` and include them from `.gitlab-ci.yml`. This keeps the root file readable.

---

## `extends` and YAML Anchors for DRY Config

### `extends`

```yaml
.go-job:
  image: golang:1.23
  before_script:
    - go version

lint:
  extends: .go-job
  script:
    - golangci-lint run ./...

test:
  extends: .go-job
  script:
    - go test ./...
```

Jobs starting with `.` are hidden -- they are templates and do not run on their own.

### YAML Anchors

```yaml
.cache-config: &cache-config
  paths:
    - .cache/go/
  key:
    files:
      - go.sum

test:
  cache:
    <<: *cache-config
  script:
    - go test ./...
```

**Prefer `extends`** over YAML anchors -- it merges more predictably and is easier to debug with `gitlab-ci-lint`.

---

## `rules` vs `only`/`except`

`only`/`except` are deprecated in favor of `rules`. Use `rules` for all new pipelines.

### `rules` syntax

```yaml
deploy-production:
  script: ./deploy.sh production
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'        # Push to main
      when: manual                              # Requires manual trigger
    - if: '$CI_PIPELINE_SOURCE == "schedule"'  # Scheduled pipeline
      when: always
    - when: never                              # Don't run in any other case
```

### Common rule patterns

```yaml
# Only on MR pipelines
rules:
  - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

# Only on tag push (for releases)
rules:
  - if: '$CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/'

# Skip if commit message contains [skip ci]
rules:
  - if: '$CI_COMMIT_MESSAGE =~ /\[skip ci\]/'
    when: never
  - when: always

# Run always but allow failure on scheduled pipelines
rules:
  - if: '$CI_PIPELINE_SOURCE == "schedule"'
    allow_failure: true
  - when: on_success
```

---

## DAG Pipelines with `needs`

By default, all jobs in a stage wait for all jobs in the previous stage. Use `needs` to express direct dependencies and enable parallel execution across stages.

```yaml
stages:
  - lint
  - test
  - build
  - deploy

lint:
  stage: lint
  script: golangci-lint run ./...

unit-test:
  stage: test
  script: go test ./...

integration-test:
  stage: test
  needs: []          # Start immediately, don't wait for lint stage
  script: go test -tags integration ./...

build:
  stage: build
  needs: [lint, unit-test]   # Only wait for these two, not integration-test
  script: go build -o dist/app ./cmd/app

deploy:
  stage: deploy
  needs: [build]
  script: ./deploy.sh
```

This creates a Directed Acyclic Graph (DAG) where `integration-test` runs in parallel with `lint` rather than waiting for it.

---

## `cache` vs `artifacts`

| | `cache` | `artifacts` |
|--|---------|-------------|
| **Purpose** | Speed up jobs by reusing downloaded dependencies | Pass build outputs between jobs |
| **Scope** | Shared across runs (same cache key) | Per-pipeline |
| **Storage** | GitLab Runner cache backend (S3 or local) | GitLab server |
| **Expiry** | Based on runner config | `expire_in` field |
| **Use for** | `node_modules`, Go module cache, pip cache | Binary outputs, test reports, coverage |

```yaml
test:
  cache:
    key:
      files:
        - go.sum
    paths:
      - .cache/go/
    policy: pull-push    # Default: pull cache at start, push at end

  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
    expire_in: 1 week
    paths:
      - dist/
```

**Cache policy optimization:** Use `policy: pull` for jobs that should only read the cache (avoids unnecessary push), and `policy: push` for the job that populates it.

---

## Environment-Scoped Variables

Define variables at different scopes to control what's available where.

```yaml
variables:
  # Project-wide defaults
  GO_VERSION: "1.23"
  LOG_LEVEL: "info"

deploy-staging:
  environment:
    name: staging
    url: https://staging.example.com
  variables:
    DEPLOY_ENV: staging
    LOG_LEVEL: debug      # Override project-wide default
  script: ./deploy.sh

deploy-production:
  environment:
    name: production
    url: https://example.com
  variables:
    DEPLOY_ENV: production
  script: ./deploy.sh
```

**Protected variables:** In GitLab settings, mark sensitive variables as "Protected" (only available in protected branches/tags) and "Masked" (not shown in logs).

---

## Review Apps (Per-MR Preview Environments)

Deploy ephemeral environments for each merge request, automatically cleaned up on MR close.

```yaml
deploy-review:
  stage: deploy
  script:
    - ./deploy.sh review-$CI_MERGE_REQUEST_IID
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    url: https://review-$CI_MERGE_REQUEST_IID.example.com
    on_stop: stop-review     # Job to run on MR close
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

stop-review:
  stage: deploy
  script:
    - ./teardown.sh review-$CI_MERGE_REQUEST_IID
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    action: stop
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      when: manual
```

---

## `interruptible` for Cancelling Redundant Pipelines

Mark jobs as safe to cancel when a newer pipeline starts for the same ref.

```yaml
# Global setting
default:
  interruptible: true

# Per-job override (disable for deployment jobs)
deploy-production:
  interruptible: false
  script: ./deploy.sh
```

Auto-cancel redundant pipelines in GitLab project settings: **Settings > CI/CD > General pipelines > Auto-cancel redundant pipelines**.

---

## Protected Environments

Configure environment access control in GitLab project settings:

- **Allowed to deploy**: Specific users, groups, or roles (e.g., Maintainers only for production)
- **Required approvals**: Number of approvals before deployment proceeds
- **Deployment freeze**: Block deployments during defined time windows

```yaml
deploy-production:
  environment:
    name: production
  script: ./deploy.sh
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual          # Requires manual trigger + environment approval
```

---

## Docker-in-Docker (DinD) and Kaniko

**Docker-in-Docker** (risky -- requires privileged runner):
```yaml
build-image:
  image: docker:24
  services:
    - docker:24-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

**Kaniko** (safer -- rootless image building):
```yaml
build-image:
  image:
    name: gcr.io/kaniko-project/executor:v1.23.0-debug
    entrypoint: [""]
  script:
    - /kaniko/executor
      --context $CI_PROJECT_DIR
      --dockerfile $CI_PROJECT_DIR/Dockerfile
      --destination $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

Kaniko builds images without the Docker daemon, making it safe to run in unprivileged containers.

---

## Common Pitfalls

| Pitfall | Problem | Fix |
|---------|---------|-----|
| Using `only/except` | Deprecated, confusing behavior | Migrate to `rules` |
| No `interruptible: true` | Redundant pipelines waste runner time | Add to default or jobs |
| Caching without lockfile key | Stale cache with wrong dependency version | Use `key.files` with lockfile |
| Privileged runners for Docker builds | Security risk | Use Kaniko or Buildah |
| No `expire_in` on artifacts | Artifacts accumulate indefinitely | Always set `expire_in` |
| Secrets in `variables:` | Exposed in job log | Use GitLab masked/protected variables |
| No environment protection | Anyone can deploy to production | Configure required approvals |
