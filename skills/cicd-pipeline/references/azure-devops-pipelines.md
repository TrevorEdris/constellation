# Azure DevOps Pipelines

Azure DevOps (ADO) YAML pipeline patterns: service connections, OIDC federation, environment gates, and CI/CD conventions.

---

## Pipeline Basics

### YAML Structure

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - main
  paths:
    exclude:
      - docs/**
      - "*.md"

pr:
  branches:
    include:
      - main

variables:
  - group: my-variable-group   # Pipeline variable group (Library)
  - name: nodeVersion
    value: "20.x"

stages:
  - stage: Build
    jobs:
      - job: BuildAndTest
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: $(nodeVersion)

          - script: npm ci
            displayName: Install dependencies

          - script: npm run build
            displayName: Build

          - script: npm test
            displayName: Test

  - stage: Deploy
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployToStaging
        environment: staging
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploy to staging"
```

---

## Service Connections

Service connections are ADO's mechanism for authenticating to external services. For Azure, use **Workload Identity Federation** — no secrets to store or rotate.

### Creating an Azure Service Connection (Workload Identity Federation)

1. Project Settings → Service connections → New service connection → Azure Resource Manager
2. Select **Workload Identity Federation (automatic)** — ADO creates the Entra ID federated credential automatically.
3. Select the target subscription and resource group.
4. Name the connection (e.g., `azure-dev`, `azure-prod`).

```yaml
# Using a service connection in a pipeline
- task: AzureCLI@2
  displayName: Deploy to Azure
  inputs:
    azureSubscription: azure-prod       # Service connection name
    scriptType: bash
    scriptLocation: inlineScript
    inlineScript: |
      az functionapp deployment source config-zip \
        --resource-group $(resourceGroup) \
        --name $(functionAppName) \
        --src $(Pipeline.Workspace)/build/build.zip
```

### Manual Workload Identity Federation Setup

If automatic creation is not available (enterprise restrictions):

```bash
# 1. Create federated credential on an existing managed identity or app registration
az identity federated-credential create \
  --name ado-pipeline-<project> \
  --identity-name <managed-identity> \
  --resource-group <rg> \
  --issuer "https://vstoken.dev.azure.com/<ado-org-id>" \
  --subject "sc://<ado-org>/<ado-project>/<service-connection-name>" \
  --audience api://AzureADTokenExchange

# 2. Create the ADO service connection using the managed identity
# (via ADO UI — select "Workload Identity Federation (manual)")
```

---

## Environments and Deployment Gates

ADO Environments provide deployment tracking, approval gates, and branch policies.

```yaml
# Create an environment named "production" and require manual approval
jobs:
  - deployment: DeployToProduction
    environment: production     # Must be created in ADO Project → Environments
    strategy:
      runOnce:
        deploy:
          steps:
            - script: echo "Deploying to production"
```

**Configure approval in ADO UI:**
Project → Environments → production → Approvals and checks → Add → Approvals → add required approvers.

---

## OIDC for Azure Resources from ADO

ADO pipelines can authenticate to Azure using OIDC without service connection overhead — useful when AZURE_CLIENT_ID / TENANT_ID / SUBSCRIPTION_ID are available.

```yaml
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: $(serviceConnectionName)
      scriptType: bash
      scriptLocation: inlineScript
      addSpnToEnvironment: true       # Injects $servicePrincipalId, $idToken
      inlineScript: |
        # Use the OIDC token directly (e.g., for Terraform OIDC auth)
        export ARM_CLIENT_ID=$servicePrincipalId
        export ARM_OIDC_TOKEN=$idToken
        export ARM_USE_OIDC=true
        export ARM_TENANT_ID=$(tenantId)
        export ARM_SUBSCRIPTION_ID=$(subscriptionId)
        terraform init
        terraform plan
        terraform apply -auto-approve
```

---

## Caching

```yaml
steps:
  - task: Cache@2
    inputs:
      key: 'npm | "$(Agent.OS)" | package-lock.json'
      restoreKeys: |
        npm | "$(Agent.OS)"
      path: $(npm_config_cache)
    displayName: Cache npm packages

  - script: npm ci
    displayName: Install (cache-backed)
```

---

## Matrix Testing

```yaml
strategy:
  matrix:
    Node18:
      nodeVersion: "18.x"
    Node20:
      nodeVersion: "20.x"
    Node22:
      nodeVersion: "22.x"
  maxParallel: 3

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: $(nodeVersion)
  - script: npm test
```

---

## Pipeline Templates (Reusable)

```yaml
# templates/build-node.yml
parameters:
  - name: nodeVersion
    type: string
    default: "20.x"

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: ${{ parameters.nodeVersion }}
  - script: npm ci && npm run build && npm test

# azure-pipelines.yml
stages:
  - stage: Build
    jobs:
      - job: Build
        steps:
          - template: templates/build-node.yml
            parameters:
              nodeVersion: "20.x"
```

---

## Security Checklist

- [ ] Use Workload Identity Federation service connections — no secrets or PATs in pipeline YAML.
- [ ] Scope service connections to the minimum resource group or subscription needed.
- [ ] Store non-secret config in Pipeline variable groups; store secrets in Azure Key Vault linked variable groups.
- [ ] Require branch policies (PR + build validation) on `main` — no direct pushes.
- [ ] Set environment approval gates on `production` deployments.
- [ ] Use `resources.repositories` to pin external template repos to a specific commit SHA.
- [ ] Enable `audit` logging in ADO Organization Settings → Policies → Enable auditing.
- [ ] Rotate PATs quarterly if any exist; prefer OIDC for machine-to-machine auth.

---

## ADO MCP Server (Local Use)

The Azure DevOps MCP Server exposes ADO work items, PRs, repos, wikis, and builds as MCP tools.

**Security:** Run in-network only — do not expose as a remote endpoint.

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["@microsoft/azure-devops-mcp"],
      "env": {
        "AZURE_DEVOPS_ORG": "https://dev.azure.com/<org>",
        "AZURE_DEVOPS_PAT": "<pat-token>"
      }
    }
  }
}
```
