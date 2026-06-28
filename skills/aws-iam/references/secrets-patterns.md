# Secrets Manager and Parameter Store Patterns — Reference

Choosing between stores, injection patterns, rotation, and cross-service access.

---

## Decision Guide

| Factor | Use Secrets Manager | Use Parameter Store |
|--------|--------------------|--------------------|
| Rotation needed | Yes (built-in Lambda rotation) | No (manual rotation) |
| Value type | Passwords, API keys, OAuth tokens | Config values, feature flags, non-sensitive params |
| Binary secrets | Yes (up to 65KB) | No |
| Cost tolerance | $0.40/secret/month | Free (standard tier) |
| Cross-account access | Yes, via resource policy | Yes (advanced tier only) |
| AWS service integration | Secrets Manager is preferred for RDS, Redshift | Both supported |
| Size limit | 65KB | 4KB standard / 8KB advanced |

**Rule of thumb:** Any secret that changes (password, API key, OAuth token) → Secrets Manager. Any config value → Parameter Store Standard (free).

---

## Secrets Manager Patterns

### Basic Retrieval (Python)

```python
import boto3
import json
from functools import lru_cache

@lru_cache(maxsize=None)
def get_secret(secret_name: str) -> dict:
    """Fetch secret once per Lambda cold start; cached for lifetime of execution env."""
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_name)
    if 'SecretString' in response:
        return json.loads(response['SecretString'])
    # Binary secret
    import base64
    return base64.b64decode(response['SecretBinary'])

def handler(event, context):
    creds = get_secret('prod/myapp/database')
    # creds['username'], creds['password'], creds['host'], creds['port']
```

### Basic Retrieval (Go)

```go
import (
    "encoding/json"
    "github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

type DBSecret struct {
    Username string `json:"username"`
    Password string `json:"password"`
    Host     string `json:"host"`
    Port     int    `json:"port"`
    DBName   string `json:"dbname"`
}

func getDBSecret(ctx context.Context, client *secretsmanager.Client, secretID string) (DBSecret, error) {
    out, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
        SecretId: &secretID,
    })
    if err != nil {
        return DBSecret{}, fmt.Errorf("get secret %s: %w", secretID, err)
    }
    var secret DBSecret
    if err := json.Unmarshal([]byte(*out.SecretString), &secret); err != nil {
        return DBSecret{}, fmt.Errorf("unmarshal secret: %w", err)
    }
    return secret, nil
}
```

### ECS Task Definition Injection

```json
{
  "containerDefinitions": [{
    "name": "myapp",
    "image": "myapp:latest",
    "secrets": [
      {
        "name": "DB_PASSWORD",
        "valueFrom": "arn:aws:secretsmanager:us-east-1:123:secret:prod/myapp/db:password::"
      },
      {
        "name": "API_KEY",
        "valueFrom": "arn:aws:secretsmanager:us-east-1:123:secret:prod/myapp/api-key::"
      }
    ]
  }]
}
```

ECS injects secret values as environment variables at container start. The task execution role must have `secretsmanager:GetSecretValue` permission on the secret ARNs.

### CloudFormation / SAM Dynamic Reference

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Environment:
      Variables:
        DB_PASSWORD: '{{resolve:secretsmanager:prod/myapp/db:SecretString:password}}'
```

For sensitive values in ECS/Lambda, prefer the native secrets injection (above) over environment variables — environment variables appear in CloudTrail and the Lambda console.

---

## Secrets Rotation

### AWS-Managed Rotation (RDS, Redshift, DocumentDB)

```bash
# Enable automatic rotation using an AWS-managed Lambda
aws secretsmanager rotate-secret \
  --secret-id prod/myapp/db \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123:function:SecretsManagerRDSRotation \
  --rotation-rules AutomaticallyAfterDays=30

# For single-user rotation (simpler, no dependency on new credentials working first):
# Use: arn:aws:serverlessrepo:...:SecretsManagerRDSMySQLRotationSingleUser
# For alternating-user rotation (safer for production, no downtime):
# Use: arn:aws:serverlessrepo:...:SecretsManagerRDSMySQLRotationMultiUser
```

### Custom Rotation Lambda

For non-RDS secrets, implement a Lambda with four steps:
1. `createSecret` — generate a new secret value
2. `setSecret` — update the secret in the target system
3. `testSecret` — verify the new secret works
4. `finishSecret` — mark the new version as current

---

## Parameter Store Patterns

```python
# String parameter (config value)
ssm = boto3.client('ssm')
response = ssm.get_parameter(Name='/myapp/prod/feature-flag-x', WithDecryption=False)
value = response['Parameter']['Value']

# SecureString parameter (KMS-encrypted)
response = ssm.get_parameter(Name='/myapp/prod/api-key', WithDecryption=True)
api_key = response['Parameter']['Value']

# Batch fetch (up to 10 parameters)
response = ssm.get_parameters(
    Names=['/myapp/prod/db-host', '/myapp/prod/db-port', '/myapp/prod/cache-host'],
    WithDecryption=False
)
params = {p['Name'].split('/')[-1]: p['Value'] for p in response['Parameters']}

# Fetch all parameters under a path (hierarchical)
paginator = ssm.get_paginator('get_parameters_by_path')
for page in paginator.paginate(Path='/myapp/prod/', WithDecryption=True, Recursive=True):
    for param in page['Parameters']:
        print(param['Name'], param['Value'])
```

### Naming Convention

```
/org/environment/service/parameter-name
/myapp/prod/database/host
/myapp/prod/database/port
/myapp/prod/features/flag-x
/myapp/prod/integrations/stripe-api-key
```

Hierarchical naming enables:
- `GetParametersByPath` to fetch all params for a service at startup
- IAM policies scoped to `/myapp/prod/*`

---

## Cross-Account Secret Access

```json
// Resource policy on the Secrets Manager secret (source account)
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::CONSUMER_ACCOUNT:role/ConsumerRole"
    },
    "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    "Resource": "*"
  }]
}
```

If the secret is encrypted with a CMK, the consumer must also have `kms:Decrypt` on the key.

---

## IAM Policy for Secrets Manager Access

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": [
      "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:prod/myapp/*"
    ]
  }]
}
```

Scope to specific secret ARN patterns. Avoid `"*"` for `GetSecretValue` — it grants access to all secrets in the account.
