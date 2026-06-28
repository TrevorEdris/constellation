# AWS SDK for Python (boto3) — Reference

Package: `boto3`, `botocore`

---

## Setup

```bash
pip install boto3
# Or with exact version pinning (recommended):
echo "boto3==1.35.0" >> requirements.txt
```

---

## Configuration

```python
import boto3

# Credential chain: env vars → ~/.aws/credentials → ~/.aws/config → instance profile / ECS task role / Lambda execution role
client = boto3.client('s3', region_name='us-east-1')  # Always pass region_name explicitly

# For multiple services, reuse session
session = boto3.Session(profile_name='my-profile', region_name='us-east-1')
s3 = session.client('s3')
sts = session.client('sts')
```

---

## Error Handling

```python
from botocore.exceptions import ClientError

def get_object(bucket: str, key: str) -> bytes:
    client = boto3.client('s3')
    try:
        response = client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    except ClientError as e:
        code = e.response['Error']['Code']
        if code == 'NoSuchKey':
            raise KeyError(f"Object s3://{bucket}/{key} not found") from e
        if code == 'AccessDenied':
            raise PermissionError(f"Access denied to s3://{bucket}/{key}") from e
        raise  # Re-raise unexpected AWS errors
```

**Rules:**
- Catch `ClientError`, not bare `Exception` — other exceptions indicate SDK or network issues
- Check `e.response['Error']['Code']` for service-specific error codes
- Error codes are strings, not integers: `'404'` vs `'NoSuchKey'` (service-dependent)
- Re-raise unknown error codes — don't silently swallow unexpected failures

---

## Pagination

```python
# Wrong — missing results after first page
response = client.list_objects_v2(Bucket='my-bucket')
for obj in response['Contents']:  # Only first 1000 objects
    print(obj['Key'])

# Correct — use paginator
paginator = client.get_paginator('list_objects_v2')
for page in paginator.paginate(Bucket='my-bucket', Prefix='logs/'):
    for obj in page.get('Contents', []):
        print(obj['Key'])
```

Every paginated API has a corresponding paginator. Common ones:
- `list_objects_v2`, `list_buckets`
- `describe_instances`, `describe_security_groups`
- `list_functions` (Lambda), `describe_log_groups` (CloudWatch)

---

## Async (aioboto3)

```python
import aioboto3

async def get_object_async(bucket: str, key: str) -> bytes:
    session = aioboto3.Session()
    async with session.client('s3') as client:
        response = await client.get_object(Bucket=bucket, Key=key)
        return await response['Body'].read()
```

**Rules:**
- Standard `boto3` is blocking — it will block the event loop if called from `async` code
- Use `aioboto3` for `asyncio`-based services (FastAPI, async Lambda handlers)
- `aioboto3` wraps `boto3` under the hood; API is identical with `async/await`

---

## Presigned URLs

```python
# Generate presigned URL (no credentials in URL — time-limited access)
url = client.generate_presigned_url(
    'get_object',
    Params={'Bucket': 'my-bucket', 'Key': 'private/file.pdf'},
    ExpiresIn=3600  # seconds (max 7 days for IAM user, 1 hour for role)
)

# Presigned POST (browser upload without exposing credentials)
response = client.generate_presigned_post(
    Bucket='my-bucket',
    Key='uploads/${filename}',
    Fields={"Content-Type": "image/jpeg"},
    Conditions=[["content-length-range", 100, 10485760]],  # 100B – 10MB
    ExpiresIn=600
)
# Response contains 'url' and 'fields' for multipart/form-data POST
```

---

## Resource vs Client

| API Style | Example | When to Use |
|-----------|---------|-------------|
| `client` (low-level) | `client.get_object(Bucket=..., Key=...)` | Precise control; explicit error codes; production code |
| `resource` (higher-level) | `s3.Object('bucket', 'key').get()` | Quick scripts; hides error details — avoid in production |

Prefer `client` in all production code — `resource` obscures error codes and has subtle behavioral differences.

---

## Anti-Patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| Hardcoded `region_name='us-east-1'` | Use env var `AWS_DEFAULT_REGION` or explicit region from config |
| `boto3.resource` in production | `boto3.client` for explicit error handling |
| Catching bare `Exception` for AWS errors | Catch `ClientError` specifically |
| Creating client inside tight loops | Create once at module level or in constructor |
| Calling `get_session_token` in Lambda | Lambda already has session credentials via execution role |
| Blocking boto3 call in async handler | Use `aioboto3` or `asyncio.to_thread` |

---

## Credential Debugging

```python
import boto3

# Verify which credentials are in use
sts = boto3.client('sts')
identity = sts.get_caller_identity()
print(identity['Arn'])  # Shows role ARN or IAM user ARN

# Check resolved region
session = boto3.session.Session()
print(session.region_name)
```

---

## Related

- Python async patterns: `python-patterns` skill
- Lambda handler structure: `/aws-serverless` → `references/lambda-patterns.md`
- Secrets injection: `/aws-iam` → `references/secrets-patterns.md`
