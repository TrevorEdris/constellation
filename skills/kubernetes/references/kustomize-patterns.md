# Kustomize Patterns

## When to Use Kustomize vs Helm

| Factor | Kustomize | Helm |
|--------|-----------|------|
| You own all the manifests | Ideal | Works but heavier |
| Distributing to external users | Not designed for this | Ideal |
| Environments differ by a few fields | Ideal (patches) | Possible (values files) |
| Many configurable parameters | Awkward | Ideal (values.yaml) |
| No template language learning curve | Yes (pure YAML) | No (Go templates) |
| CI/CD native support | kubectl, ArgoCD, Flux | Helm CLI required |

Use Kustomize when you control the base manifests and need environment-specific overrides. Use Helm when distributing reusable charts or managing complex parameterization.

---

## Directory Structure

```
k8s/
├── base/
│   ├── kustomization.yaml    # Lists all base resources
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── serviceaccount.yaml
│   └── configmap.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── patch-replicas.yaml
    ├── staging/
    │   ├── kustomization.yaml
    │   └── patch-resources.yaml
    └── production/
        ├── kustomization.yaml
        ├── patch-replicas.yaml
        ├── patch-resources.yaml
        └── patch-ingress.yaml
```

---

## Base kustomization.yaml

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - serviceaccount.yaml
  - configmap.yaml

# Common labels applied to all resources
commonLabels:
  app.kubernetes.io/name: my-service
  app.kubernetes.io/managed-by: kustomize
```

---

## Overlay kustomization.yaml

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base            # Reference to base
  - pdb.yaml              # Production-only resources
  - networkpolicy.yaml

# Image tag replacement — primary use in CI/CD
images:
  - name: my-org/my-service
    newTag: "1.2.3"       # Set by CI: kustomize edit set image my-org/my-service:$SHA

# Namespace override
namespace: production

# Add name prefix/suffix
# namePrefix: prod-

patches:
  - path: patch-replicas.yaml
  - path: patch-resources.yaml
```

---

## Strategic Merge Patches

Best for modifying top-level fields or adding/replacing values in maps.

```yaml
# overlays/production/patch-replicas.yaml
# Matches by: apiVersion + kind + metadata.name
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service    # Must match base resource name exactly
spec:
  replicas: 5         # Override base replica count
```

```yaml
# overlays/staging/patch-resources.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  template:
    spec:
      containers:
        - name: app          # Must match container name
          resources:
            requests:
              cpu: "200m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
```

---

## JSON 6902 Patches

Best for targeting array elements by index, or when strategic merge doesn't work correctly.

```yaml
# overlays/production/patch-ingress-tls.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-service

# Inline JSON patch in kustomization.yaml:
```

```yaml
# In overlays/production/kustomization.yaml
patches:
  - target:
      kind: Ingress
      name: my-service
    patch: |-
      - op: add
        path: /spec/tls
        value:
          - hosts:
              - my-service.example.com
            secretName: my-service-tls
      - op: replace
        path: /spec/rules/0/host
        value: my-service.example.com
```

JSON patch operations:
- `add` — add a new field or array element
- `remove` — remove a field or array element
- `replace` — replace an existing value
- `move` — move a value from one path to another
- `copy` — copy a value from one path to another

---

## Image Tag Replacement in CI

```bash
# In CI pipeline — replace the image tag before applying
cd k8s/overlays/production

# Option 1: kustomize CLI
kustomize edit set image my-org/my-service=my-org/my-service:${GIT_SHA}

# Option 2: kubectl kustomize (built-in)
# Commit the kustomization.yaml change, then:
kubectl apply -k k8s/overlays/production
```

```yaml
# After CI edits, overlays/production/kustomization.yaml contains:
images:
  - name: my-org/my-service
    newTag: "abc1234"    # The SHA from CI
```

---

## ConfigMap and Secret Generators

```yaml
# base/kustomization.yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
      - MAX_CONNECTIONS=100
    # Or from files:
    # files:
    #   - config.properties

secretGenerator:
  - name: app-secrets
    literals:
      - DB_PASSWORD=changeme    # Use envs file or external secrets in production
    # From .env file:
    # envs:
    #   - secret.env
```

Kustomize appends a content hash to the name (`app-config-k7bh9t`). Deployments referencing `app-config` auto-get the hashed name. Hash changes when content changes → Deployment rollout triggered automatically.

To opt out of hash suffix:
```yaml
generatorOptions:
  disableNameSuffixHash: true
```

---

## Build and Apply

```bash
# Preview rendered output (no apply)
kubectl kustomize k8s/overlays/production

# Apply to cluster
kubectl apply -k k8s/overlays/production

# Dry-run
kubectl apply -k k8s/overlays/production --dry-run=client

# Diff against live cluster
kubectl diff -k k8s/overlays/production
```

---

## Flux and ArgoCD Integration

Both support Kustomize natively:

**Flux:**
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: my-service
spec:
  path: ./k8s/overlays/production
  sourceRef:
    kind: GitRepository
    name: my-repo
```

**ArgoCD:**
```yaml
spec:
  source:
    repoURL: https://github.com/org/repo
    path: k8s/overlays/production
    kustomize:
      images:
        - my-org/my-service:latest    # Overridden by image updater
```
