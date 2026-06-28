---
name: aws-iac
description: "Use when authoring, reviewing, deploying, or migrating AWS infrastructure-as-code with CloudFormation, CDK, or SAM."
context: fork
agent: aws-iac-specialist
allowed-tools: Bash, Read, Glob, Grep, Write
model: sonnet
argument-hint: "[generate|review|diff|security|migrate]"
user-invocable: true
tags: [aws, infrastructure]
---

# AWS IaC

Author, review, and deploy AWS infrastructure using CloudFormation, CDK, or SAM.

---

## When to Use

- Writing or reviewing CloudFormation templates (YAML/JSON)
- Building AWS CDK stacks or constructs in TypeScript/Python/Go/Java
- Creating SAM templates for serverless applications
- Auditing existing IaC for security issues (`cdk-nag`, `cfn-lint`, `cfn-guard`)
- Migrating raw CloudFormation to CDK
- Previewing changes before deployment (`cdk diff`, change sets)

**Out of scope:** CI/CD pipeline definition (use `/cicd-pipeline`), Terraform/Pulumi (use `/terraform` or `/pulumi`), Azure/GCP IaC (use `/azure-iac`).

---

## Quick Start

```
/aws-iac generate    # Scaffold new IaC from detected or specified resource set
/aws-iac review      # Review existing templates for correctness and anti-patterns
/aws-iac diff        # Preview changes (cdk diff or CFN change set)
/aws-iac security    # Run cdk-nag / cfn-lint / cfn-guard security scan
/aws-iac migrate     # Convert raw CloudFormation to CDK (TypeScript)
```

No argument? Detects project type and defaults to `review` if IaC exists, `generate` if not.

---

## Context

IaC FILES DETECTED:
```
!`ls cdk.json Pulumi.yaml *.tf template.yaml template.json samconfig.toml 2>/dev/null; find . -maxdepth 3 \( -name "*.cfn.yaml" -o -name "*.cfn.json" -o -name "cdk.json" -o -name "template.yaml" -o -name "samconfig.toml" \) 2>/dev/null | head -20`
```

CDK CONFIG:
```
!`cat cdk.json 2>/dev/null || echo "No cdk.json found"`
```

SAM CONFIG:
```
!`cat samconfig.toml 2>/dev/null || echo "No samconfig.toml found"`
```

PACKAGE INFO:
```
!`cat package.json 2>/dev/null | grep -E '"name"|"version"|"aws-cdk|"@aws-cdk' | head -10; cat pyproject.toml 2>/dev/null | grep -E 'name|aws-cdk' | head -10`
```

---

## Mode: generate

Scaffold new IaC for a specified set of AWS resources.

**Steps:**
1. Detect tool preference from context (cdk.json = CDK, template.yaml without cdk.json = CFN/SAM, none = ask)
2. Gather resource requirements: VPC, compute (ECS/Lambda/EC2), storage (S3/RDS/DynamoDB), IAM roles
3. For **CDK**: scaffold `bin/app.ts` + `lib/<name>-stack.ts` using L2 constructs; add Stage if multi-env
4. For **CloudFormation**: scaffold template with Parameters, Conditions, Resources, Outputs sections
5. For **SAM**: scaffold `template.yaml` with `Transform: AWS::Serverless-2016-10-31` and event sources
6. Apply least-privilege IAM: no `*` actions or resources without explicit justification
7. Write files and provide next steps (`cdk synth`, `cdk deploy`, `sam build && sam deploy`)

**Asset templates:**
- `assets/cfn-skeleton.yaml` — CloudFormation starter
- `assets/cdk-stack-template.ts` — CDK TypeScript stack
- `assets/sam-template.yaml` — SAM function + API Gateway

---

## Mode: review

Analyze existing IaC for correctness, security, and anti-patterns.

**Steps:**
1. Detect tool from context files
2. For **CDK**: check L1 vs L2 usage, missing encryption, public access, construct naming, test coverage
3. For **CloudFormation**: validate intrinsic function usage, check `DeletionPolicy` on stateful resources, verify `NoEcho` on sensitive params, scan for hardcoded account IDs/regions
4. For **SAM**: verify event source auth, function timeouts, memory sizing, environment variable secrets
5. Report findings using triage levels:
   - **[CRITICAL]**: Must fix before deploy (hardcoded secrets, missing `DeletionPolicy: Retain` on prod databases, public S3)
   - **[HIGH]**: Strong recommendation (missing encryption, L1 when L2 exists, no change set discipline)
   - **[LOW]**: Minor polish (naming conventions, unused outputs, verbose `!Sub`)
6. Provide concrete remediation for each finding

---

## Mode: diff

Preview infrastructure changes before deployment.

**Steps:**
1. For **CDK**: run `cdk synth` then `cdk diff`; summarize additions, modifications, and destructions
2. For **CloudFormation**: generate a change set against the deployed stack; parse and explain each change
3. Flag **replacement** changes (destroy + recreate) — these require explicit acknowledgment
4. Flag **stateful resource** changes (RDS, DynamoDB, S3) — always high-risk
5. Recommend manual approval gate for any replacement or stateful change

---

## Mode: security

Run security scanning tools and interpret results.

**Tool Matrix:**

| Tool | Applies To | Command |
|------|-----------|---------|
| `cfn-lint` | CloudFormation, SAM | `cfn-lint template.yaml` |
| `cfn-guard` | CloudFormation | `cfn-guard validate -r rules/ -d template.yaml` |
| `cdk-nag` | CDK | Add `Aspects.of(app).add(new AwsSolutionsChecks())` |
| `checkov` | CFN, CDK synth output | `checkov -d . --framework cloudformation` |

**Steps:**
1. Detect applicable tools from project type
2. Run available scanners (or synthesize CDK first if needed)
3. Categorize findings by severity and provide suppression guidance for intentional deviations
4. Generate suppressions list (`NagSuppressions.addStackSuppressions`) for CDK nag findings with documented rationale

---

## Mode: migrate

Convert CloudFormation templates to CDK (TypeScript).

**Steps:**
1. Parse source CloudFormation template
2. Map each `Type: AWS::*` resource to its L2 CDK construct (prefer L2; use L1 only when no L2 exists)
3. Convert `Parameters` to CDK `CfnParameter` or Stack props with TypeScript types
4. Convert `Conditions` to TypeScript `if` statements or ternary props
5. Replace `!Sub`, `!Ref`, `!GetAtt` with CDK token references
6. Convert `Outputs` and `Fn::ImportValue` to CDK `CfnOutput` and stack references
7. Generate `bin/app.ts` entry point and `lib/<name>-stack.ts`
8. Provide test scaffold using `aws-cdk-lib/assertions` Template matchers

Reference: `references/cdk-constructs.md` for L2 mapping guide

---

## Key References

| Reference | Contents |
|-----------|----------|
| `references/cloudformation-patterns.md` | Intrinsic functions, nested stacks, change sets, cross-stack refs |
| `references/cdk-constructs.md` | L1/L2/L3 guide, CDK Pipelines, assertions testing, projen |
| `references/sam-patterns.md` | SAM resource types, event sources, local testing with `sam local` |
| `references/cfn-anti-patterns.md` | DeletionPolicy, circular exports, hardcoded values, NoEcho |
| `references/iam-least-privilege.md` | IAM policy crafting for CFN/CDK roles, OIDC, service roles |

## Asset Templates

| Asset | Purpose |
|-------|---------|
| `assets/cfn-skeleton.yaml` | Starter CloudFormation template with all sections |
| `assets/cdk-stack-template.ts` | TypeScript CDK stack with L2 constructs |
| `assets/sam-template.yaml` | SAM function + API Gateway + DynamoDB |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/detect-iac-type.sh` | Detect CFN vs CDK vs SAM from project files |
