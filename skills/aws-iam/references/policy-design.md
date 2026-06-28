# IAM Policy Design — Reference

Least-privilege policy construction, resource ARNs, conditions, SCPs, and permission boundaries.

---

## Least-Privilege Process

1. Start with **zero permissions** — add only what is demonstrably needed
2. Use **specific resource ARNs** — never `*` unless the action requires it
3. Add **conditions** to restrict scope further (region, IP, MFA, tags)
4. Validate with **IAM Access Analyzer** before attaching
5. **Monitor** with CloudTrail + Access Advisor; remove unused permissions after 90 days

---

## Resource ARN Patterns

| Service | ARN Format |
|---------|-----------|
| S3 bucket | `arn:aws:s3:::bucket-name` |
| S3 objects | `arn:aws:s3:::bucket-name/*` |
| S3 prefix | `arn:aws:s3:::bucket-name/prefix/*` |
| Lambda | `arn:aws:lambda:REGION:ACCOUNT:function:function-name` |
| DynamoDB table | `arn:aws:dynamodb:REGION:ACCOUNT:table/table-name` |
| DynamoDB GSI | `arn:aws:dynamodb:REGION:ACCOUNT:table/table-name/index/index-name` |
| Secrets Manager | `arn:aws:secretsmanager:REGION:ACCOUNT:secret:secret-name-*` |
| KMS CMK | `arn:aws:kms:REGION:ACCOUNT:key/key-id` |
| SQS queue | `arn:aws:sqs:REGION:ACCOUNT:queue-name` |
| SNS topic | `arn:aws:sns:REGION:ACCOUNT:topic-name` |
| CloudWatch Logs group | `arn:aws:logs:REGION:ACCOUNT:log-group:group-name:*` |
| IAM role | `arn:aws:iam::ACCOUNT:role/role-name` |

Note: S3 ARNs do not include region or account — they are globally scoped.

---

## Policy Evaluation Logic

IAM evaluates policies in this order (deny wins):

```
1. Explicit Deny (any policy)     → DENY — cannot be overridden
2. SCP (Service Control Policy)   → Must Allow; doesn't grant permissions
3. Resource-based policy          → Cross-account: both identity + resource must Allow
4. Permission Boundary            → Caps maximum permissions for a principal
5. Identity-based policy (IAM)    → What the principal is allowed to do
6. Session Policy                 → Further restricts assumed-role sessions
```

**Key points:**
- An explicit `Deny` in ANY policy overrides any `Allow` — even from a more permissive policy
- SCPs do not grant permissions — they only restrict what identity policies can grant
- Cross-account: both the identity policy and the resource policy must Allow the action

---

## Condition Keys Reference

### Global Conditions

```json
{
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": ["us-east-1", "eu-west-1"]
    },
    "IpAddress": {
      "aws:SourceIp": "203.0.113.0/24"
    },
    "Bool": {
      "aws:MultiFactorAuthPresent": "true",
      "aws:SecureTransport": "true"     // Enforce HTTPS
    },
    "DateLessThan": {
      "aws:CurrentTime": "2026-12-31T23:59:59Z"  // Time-limited access
    }
  }
}
```

### ABAC (Attribute-Based Access Control)

```json
{
  "Condition": {
    "StringEquals": {
      "aws:PrincipalTag/team": "${aws:ResourceTag/team}",
      "aws:PrincipalTag/env": "${aws:ResourceTag/env}"
    }
  }
}
```

ABAC matches principal tags to resource tags, allowing one policy to scale across many resources without listing ARNs.

### S3 Conditions

```json
{
  "StringLike": {"s3:prefix": ["home/${aws:username}/*"]},
  "StringEquals": {"s3:delimiter": "/"}
}
```

---

## Permission Boundaries

Prevent privilege escalation when delegating IAM administration to developers:

```json
// Developer boundary — caps what devs can grant to new roles they create
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:*", "dynamodb:*", "lambda:*",
        "logs:*", "cloudwatch:*", "xray:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Action": [
        "iam:CreateUser",
        "iam:AttachUserPolicy",
        "organizations:*",
        "account:*"
      ],
      "Resource": "*"
    }
  ]
}
```

Admin policy requiring boundary on new roles:

```json
{
  "Effect": "Allow",
  "Action": "iam:CreateRole",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "iam:PermissionsBoundary": "arn:aws:iam::ACCOUNT:policy/DeveloperBoundary"
    }
  }
}
```

---

## Service Control Policies (SCPs)

SCPs apply at the AWS Organization level and cap permissions across all accounts in an OU.

```json
// Prevent disabling CloudTrail — applies to all accounts in OU
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": [
        "cloudtrail:StopLogging",
        "cloudtrail:DeleteTrail",
        "cloudtrail:UpdateTrail"
      ],
      "Resource": "*"
    }
  ]
}
```

```json
// Restrict to approved regions only
{
  "Effect": "Deny",
  "NotAction": [
    "iam:*", "sts:*", "support:*", "route53:*"  // Global services — exempt from region check
  ],
  "Resource": "*",
  "Condition": {
    "StringNotIn": {
      "aws:RequestedRegion": ["us-east-1", "eu-west-1"]
    }
  }
}
```

---

## IAM Access Analyzer

```bash
# Find externally accessible resources (S3, Lambda, SQS, etc.)
aws accessanalyzer create-analyzer \
  --analyzer-name account-analyzer \
  --type ACCOUNT   # or ORGANIZATION for org-wide

aws accessanalyzer list-findings \
  --analyzer-name account-analyzer \
  --filter '{"status": {"eq": ["ACTIVE"]}}'

# Validate a policy document before attaching
aws accessanalyzer validate-policy \
  --policy-type IDENTITY_POLICY \
  --policy-document file://my-policy.json
```

---

## IAM Access Advisor

Review last-accessed data to identify unused permissions:

```bash
# Generate access report for a role
aws iam generate-service-last-accessed-details \
  --arn arn:aws:iam::ACCOUNT:role/MyRole

# Get the report (may take 30–60s to generate)
aws iam get-service-last-accessed-details \
  --job-id JOB_ID \
  --query 'ServicesLastAccessed[?LastAuthenticated==`null`].ServiceName'
```

Any service not accessed in 90+ days is a candidate for removal.
