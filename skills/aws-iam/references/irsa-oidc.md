# IRSA and OIDC — Reference

IAM Roles for Service Accounts (EKS), OIDC provider setup, and GitHub Actions OIDC trust.

---

## IRSA Overview

IRSA (IAM Roles for Service Accounts) allows Kubernetes pods to assume IAM roles without node-level credentials. Each pod gets short-lived, automatically-rotated credentials scoped to the role.

**How it works:**
1. EKS cluster has an OIDC provider endpoint
2. Kubernetes ServiceAccount is annotated with a role ARN
3. EKS injects a projected service account token (JWT) into the pod
4. AWS SDK exchanges the JWT with STS via `AssumeRoleWithWebIdentity`
5. Pod receives short-lived IAM credentials scoped to the annotated role

---

## Setup Steps

### 1. Create OIDC Provider for the Cluster

```bash
# Using eksctl (recommended)
eksctl utils associate-iam-oidc-provider \
  --cluster my-cluster \
  --region us-east-1 \
  --approve

# Manual: get the OIDC issuer URL
OIDC_URL=$(aws eks describe-cluster \
  --name my-cluster \
  --query "cluster.identity.oidc.issuer" \
  --output text)
echo $OIDC_URL
# e.g., https://oidc.eks.us-east-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B716D3041E

# Get the certificate thumbprint
THUMBPRINT=$(openssl s_client -connect oidc.eks.us-east-1.amazonaws.com:443 \
  -servername oidc.eks.us-east-1.amazonaws.com 2>/dev/null \
  | openssl x509 -fingerprint -sha1 -noout \
  | sed 's/://g' | awk -F= '{print $2}' | tr '[:upper:]' '[:lower:]')

# Create OIDC provider
aws iam create-open-id-connect-provider \
  --url $OIDC_URL \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list $THUMBPRINT
```

### 2. Create IAM Role with OIDC Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/oidc.eks.REGION.amazonaws.com/id/CLUSTER_ID"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "oidc.eks.REGION.amazonaws.com/id/CLUSTER_ID:sub":
          "system:serviceaccount:NAMESPACE:SERVICE_ACCOUNT_NAME",
        "oidc.eks.REGION.amazonaws.com/id/CLUSTER_ID:aud":
          "sts.amazonaws.com"
      }
    }
  }]
}
```

```bash
aws iam create-role \
  --role-name my-pod-role \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy \
  --role-name my-pod-role \
  --policy-arn arn:aws:iam::ACCOUNT:policy/MyPodPolicy
```

See: `assets/policy-templates/irsa-role-trust-policy.json` for a parameterized template.

### 3. Annotate the Kubernetes ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
  namespace: my-namespace
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/my-pod-role
    # Optional: customize token expiration (default: 86400s = 24h)
    eks.amazonaws.com/token-expiration: "3600"
```

### 4. Use the ServiceAccount in Pods

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      serviceAccountName: my-service-account  # <-- attach the annotated SA
      containers:
        - name: myapp
          image: myapp:latest
          # AWS SDK automatically picks up credentials via projected token volume
          # No AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY needed
```

### 5. Verify (from inside the pod)

```bash
aws sts get-caller-identity
# Should show the IRSA role ARN, not the node instance role
```

---

## eksctl Shortcut

```bash
eksctl create iamserviceaccount \
  --name my-service-account \
  --namespace my-namespace \
  --cluster my-cluster \
  --attach-policy-arn arn:aws:iam::ACCOUNT:policy/MyPodPolicy \
  --approve \
  --override-existing-serviceaccounts
```

This creates the IAM role, trust policy, and Kubernetes ServiceAccount annotation in one command.

---

## GitHub Actions OIDC

Eliminate long-lived AWS credentials from GitHub Actions — use the ephemeral OIDC token instead.

### IAM Role Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": [
          "repo:ORG/REPO:ref:refs/heads/main",    // Main branch only
          "repo:ORG/REPO:environment:production"   // Production environment
        ]
      }
    }
  }]
}
```

Scope the `sub` condition as tightly as possible — `repo:ORG/*` is too broad for production access.

### GitHub Actions Workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write    # Required for OIDC token generation
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production   # Triggers environment protection rules
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/GitHubActionsDeployRole
          role-session-name: GitHubActions-${{ github.run_id }}
          aws-region: us-east-1
          role-duration-seconds: 900   # 15 minutes (minimum)

      - name: Deploy
        run: aws s3 sync ./dist s3://my-bucket/
```

### Setup: Create OIDC Provider for GitHub

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

This is a one-time setup per AWS account. The thumbprint is GitHub's certificate fingerprint — verify it against GitHub's documentation.

---

## OIDC for Other CI Systems

| CI System | OIDC Issuer URL | Sub claim format |
|-----------|----------------|-----------------|
| GitHub Actions | `token.actions.githubusercontent.com` | `repo:ORG/REPO:ref:refs/heads/BRANCH` |
| GitLab CI | `https://gitlab.com` | `project_path:GROUP/PROJECT:ref_type:branch:ref:main` |
| CircleCI | `https://oidc.circleci.com/org/ORG_ID` | `org/ORG_ID/project/PROJECT_ID/user/USER_ID` |
| Buildkite | `https://agent.buildkite.com` | `organization:ORG:pipeline:PIPELINE:ref:refs/heads/BRANCH:commit:SHA:step:STEP` |

For setup: create the OIDC provider with the issuer URL; adjust the `sub` condition to match the CI system's token format.

---

## Related

- IRSA for EKS setup: `aws-iam` skill → `/aws-iam irsa`
- GitHub Actions pipeline with OIDC: `cicd-pipeline` skill
- IAM role policies for IRSA: `assets/policy-templates/irsa-role-trust-policy.json`
