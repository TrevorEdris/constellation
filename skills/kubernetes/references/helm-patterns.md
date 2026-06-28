# Helm Patterns

## Chart Structure

```
my-chart/
├── Chart.yaml              # Chart metadata
├── values.yaml             # Default values (documented with comments)
├── values.schema.json      # JSON Schema for values validation (recommended)
├── templates/
│   ├── _helpers.tpl        # Named templates (not rendered directly)
│   ├── NOTES.txt           # Post-install notes (rendered to stdout)
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── serviceaccount.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── networkpolicy.yaml
│   └── tests/
│       └── test-connection.yaml
└── charts/                 # Subchart dependencies
```

---

## Chart.yaml

```yaml
apiVersion: v2
name: my-service
description: API server for the order pipeline
type: application          # application or library
version: 1.2.3             # Chart version (semver) — bump on any template change
appVersion: "2.0.1"        # App version (string) — bump when app version changes

# Dependencies (pulled into charts/ by helm dependency update)
dependencies:
  - name: postgresql
    version: "15.5.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled    # Toggle in values.yaml
```

---

## _helpers.tpl Standard Templates

```
{{/*
Expand the name of the chart.
*/}}
{{- define "mychart.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncate at 63 chars (Kubernetes label limit).
*/}}
{{- define "mychart.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels — include in all resources.
*/}}
{{- define "mychart.labels" -}}
helm.sh/chart: {{ include "mychart.chart" . }}
{{ include "mychart.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in matchLabels and Service selectors.
*/}}
{{- define "mychart.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "mychart.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mychart.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
```

---

## values.yaml Structure

```yaml
# -- Number of replicas
replicaCount: 2

image:
  # -- Container image repository
  repository: my-org/my-service
  # -- Image pull policy
  pullPolicy: IfNotPresent
  # -- Overrides the image tag (defaults to Chart.AppVersion)
  tag: ""

serviceAccount:
  # -- Create a ServiceAccount
  create: true
  # -- Annotations to add to the ServiceAccount
  annotations: {}
  # -- Name override (defaults to fullname)
  name: ""

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

ingress:
  enabled: false
  className: nginx
  annotations: {}
  hosts:
    - host: chart-example.local
      paths:
        - path: /
          pathType: Prefix
  tls: []

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 1

networkPolicy:
  enabled: true

# -- Extra environment variables
extraEnv: []
# - name: MY_VAR
#   value: "my-value"

# -- Secret references for environment
extraEnvFrom: []
# - secretRef:
#     name: my-secret
```

---

## Conditional Resources

```yaml
{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
...
{{- end }}
```

```yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
...
{{- end }}
```

---

## Validation

```bash
# Lint (syntax and best practices)
helm lint ./my-chart

# Render templates locally (check output without deploying)
helm template my-release ./my-chart --values values-staging.yaml

# Dry-run against cluster (validates against API server)
helm install my-release ./my-chart --dry-run --debug

# Test an installed release
helm test my-release
```

---

## Chart Versioning

| Change Type | Bump |
|------------|------|
| Template bugfix, label correction | Patch: 1.2.3 → 1.2.4 |
| New optional feature, new value | Minor: 1.2.3 → 1.3.0 |
| Breaking values rename, required field | Major: 1.2.3 → 2.0.0 |
| Application version change only | `appVersion` only — no version bump if templates unchanged |

---

## Subchart Patterns

```yaml
# Chart.yaml
dependencies:
  - name: redis
    version: "19.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
    alias: redis    # Optional alias for values key
```

```yaml
# values.yaml — configure subchart under its name key
redis:
  enabled: true
  auth:
    enabled: false
  master:
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
```

Fetch subcharts: `helm dependency update ./my-chart`

---

## Post-Upgrade Hooks

For database migrations or pre-upgrade validation:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "mychart.fullname" . }}-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: ["./migrate", "--up"]
```
