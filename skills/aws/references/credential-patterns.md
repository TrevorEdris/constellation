# AWS Credential Patterns — Reference

How credentials are resolved, which pattern to use for each context, and common mistakes.

---

## Credential Chain (All SDKs)

All AWS SDKs follow the same resolution order. The first match wins:

1. **Environment variables**
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
   - `AWS_PROFILE` to select a named profile

2. **Shared credentials file** (`~/.aws/credentials`)
   - `[default]` or named profile sections

3. **AWS SSO / OIDC token cache** (`~/.aws/sso/cache/`)
   - Active after `aws sso login --profile my-profile`

4. **Container credentials** (ECS task role)
   - `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` env var (set by ECS agent)

5. **Instance metadata** (EC2 / ECS on EC2 / Lambda execution role)
   - IMDSv2: token-gated; prefer over IMDSv1
   - Lambda: credentials injected via `AWS_ACCESS_KEY_ID` + `AWS_SESSION_TOKEN` env vars

---

## Patterns by Context

### Local Development — SSO (Recommended)

```bash
# One-time setup per profile
aws configure sso
# Prompts for: SSO start URL, region, account ID, permission set, profile name, output format

# Daily login
aws sso login --profile my-profile

# Set profile for the current shell session
export AWS_PROFILE=my-profile

# Or pass profile per command
aws s3 ls --profile my-profile
```

SSO tokens cache in `~/.aws/sso/cache/` and expire per your org's session duration (typically 8h).

### Local Development — Named Profile (Static Keys — Avoid in Favor of SSO)

```ini
# ~/.aws/credentials
[myproject-dev]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# ~/.aws/config
[profile myproject-dev]
region = us-east-1
output = json
```

If you must use static keys, rotate every 90 days and never commit to source control.

### CI/CD — OIDC (No Static Keys)

```yaml
# GitHub Actions
permissions:
  id-token: write
  contents: read

- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
    aws-region: us-east-1
```

Trust policy on the IAM role scopes access to specific repos/branches. For setup, see `/aws-iam` → `references/irsa-oidc.md`.

### CI/CD — Environment Secrets (Fallback When OIDC Is Not Available)

```yaml
# GitHub Actions — store secrets as environment-scoped secrets, not repo-wide
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_DEFAULT_REGION: us-east-1
```

For `cicd-pipeline` skill setup, see `cicd-pipeline` → `references/github-actions-patterns.md`.

### Lambda — Execution Role

Lambda functions receive credentials automatically via the execution role. No configuration needed in the function code — `config.LoadDefaultConfig(ctx)` (Go), `boto3.client('s3')` (Python), `new S3Client({})` (TS) all resolve the role automatically.

```bash
# Verify which role is in use from inside the function
aws sts get-caller-identity
```

### ECS Fargate — Task Role

ECS tasks use a task role (separate from the task execution role). Assign it in the task definition:

```json
{
  "family": "my-task",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/MyTaskRole",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole"
}
```

- **Task role**: what the application code is permitted to do (S3, DynamoDB, etc.)
- **Execution role**: what ECS itself is permitted to do (pull ECR image, write CloudWatch logs)

---

## Multi-Profile Workflows

```bash
# List all configured profiles
aws configure list-profiles

# Check which credentials are active
aws sts get-caller-identity --profile prod

# Switch profile for a command
AWS_PROFILE=prod aws s3 ls

# Assume a role from an existing profile
aws sts assume-role \
  --role-arn arn:aws:iam::999:role/CrossAccountRole \
  --role-session-name my-session \
  --profile dev

# Store assumed role credentials in a profile for SDK use
[profile cross-account]
role_arn = arn:aws:iam::999:role/CrossAccountRole
source_profile = dev
```

---

## Security Anti-Patterns

| Anti-pattern | Risk | Remediation |
|-------------|------|-------------|
| Hardcoded keys in source | Credential leak via git | Use SSO or environment injection |
| Long-lived IAM user keys in CI | Exposed if repo is compromised | Migrate to OIDC |
| `AWS_ACCESS_KEY_ID` in Dockerfile | Keys baked into image layers | Use build args or runtime env injection |
| Credentials in `.env` committed | Visible to all repo cloners | Add `.env` to `.gitignore`; use Secrets Manager |
| Root account access keys | Full account compromise | Delete root keys; use IAM users or SSO |
| Shared credential files in Docker volumes | Leaks all profiles | Mount only the specific profile needed |

---

## Debugging Credential Issues

```bash
# Which credentials are resolved?
aws sts get-caller-identity

# What region is configured?
aws configure get region

# Verbose SDK output (Go example)
AWS_SDK_LOAD_CONFIG=1 go run . 2>&1

# Python: inspect resolved credentials
python -c "import boto3; print(boto3.session.Session().get_credentials().resolve())"

# Check SSO token cache
ls -la ~/.aws/sso/cache/
cat ~/.aws/sso/cache/*.json | python -m json.tool
```
