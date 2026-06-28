# S3 Patterns — Reference

Common S3 patterns: presigned URLs, lifecycle, versioning, CORS, multipart upload.

---

## Bucket Configuration Checklist

| Setting | Recommendation |
|---------|---------------|
| Naming | Globally unique; use account ID or project prefix; avoid dots (TLS wildcard issues) |
| Region | Collocate with your compute; cross-region adds latency and egress cost |
| Versioning | Enable on all non-temporary buckets; protects against accidental deletes and corruption |
| Block public access | Enable all four settings at bucket and account level; use presigned URLs for sharing |
| Default encryption | SSE-S3 (free); SSE-KMS for compliance, key rotation control, or cross-account |
| Access logging | Enable server access logging to a separate bucket for audit trails |
| Object lock | Enable for WORM compliance (regulatory requirements) |

---

## Presigned URLs

Presigned URLs grant time-limited access to a private object without sharing credentials.

```python
# Python — GET
url = client.generate_presigned_url(
    'get_object',
    Params={'Bucket': 'my-bucket', 'Key': 'private/report.pdf'},
    ExpiresIn=3600  # Max: 7 days (IAM user), 12 hours (assumed role)
)

# Python — PUT (browser upload)
url = client.generate_presigned_url(
    'put_object',
    Params={
        'Bucket': 'my-bucket',
        'Key': 'uploads/user-123.jpg',
        'ContentType': 'image/jpeg'
    },
    ExpiresIn=600
)
```

```typescript
// TypeScript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const url = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: "my-bucket", Key: "private/file.pdf" }),
  { expiresIn: 3600 }
);
```

**Presigned POST** (for browser-based upload with size/content-type constraints):

```python
response = client.generate_presigned_post(
    Bucket='my-bucket',
    Key='uploads/${filename}',  # ${filename} replaced by browser at upload time
    Fields={"Content-Type": "image/jpeg"},
    Conditions=[
        ["content-length-range", 1024, 10485760],   # 1KB – 10MB
        ["starts-with", "$Content-Type", "image/"],
    ],
    ExpiresIn=600
)
# Returns: {'url': '...', 'fields': {...}}
# POST as multipart/form-data with fields + file
```

---

## Lifecycle Policies

```json
{
  "Rules": [
    {
      "ID": "expire-logs",
      "Status": "Enabled",
      "Filter": {"Prefix": "logs/"},
      "Expiration": {"Days": 90}
    },
    {
      "ID": "tier-old-objects",
      "Status": "Enabled",
      "Filter": {"Prefix": "data/"},
      "Transitions": [
        {"Days": 30, "StorageClass": "STANDARD_IA"},
        {"Days": 90, "StorageClass": "GLACIER_IR"},
        {"Days": 365, "StorageClass": "DEEP_ARCHIVE"}
      ]
    },
    {
      "ID": "expire-incomplete-multipart",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }
  ]
}
```

Always add an `AbortIncompleteMultipartUpload` rule to avoid accumulating incomplete upload parts.

---

## Versioning

```bash
# Enable versioning
aws s3api put-bucket-versioning \
  --bucket my-bucket \
  --versioning-configuration Status=Enabled

# List all versions of an object
aws s3api list-object-versions --bucket my-bucket --prefix path/to/key

# Restore a specific version
aws s3api get-object \
  --bucket my-bucket \
  --key path/to/key \
  --version-id VERSIONID \
  output-file.txt

# Delete a specific version permanently
aws s3api delete-object \
  --bucket my-bucket \
  --key path/to/key \
  --version-id VERSIONID
```

Versioning adds storage cost — pair with lifecycle rules that expire old versions:

```json
{
  "Rules": [{
    "ID": "expire-old-versions",
    "Status": "Enabled",
    "NoncurrentVersionExpiration": {"NoncurrentDays": 30}
  }]
}
```

---

## CORS Configuration

```json
[{
  "AllowedHeaders": ["Content-Type", "Content-Length"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedOrigins": ["https://myapp.com"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

Apply the most restrictive `AllowedOrigins` possible — avoid `"*"` for buckets containing user data.

---

## Multipart Upload

Required for objects >5GB; recommended for objects >100MB (parallel part upload).

```python
import boto3
from boto3.s3.transfer import TransferConfig

# High-level managed transfer (handles multipart automatically)
config = TransferConfig(
    multipart_threshold=100 * 1024 * 1024,  # 100MB
    max_concurrency=10,
    multipart_chunksize=100 * 1024 * 1024,
    use_threads=True
)

client.upload_file(
    Filename='/local/large-file.zip',
    Bucket='my-bucket',
    Key='uploads/large-file.zip',
    Config=config
)
```

---

## Cross-Account Access

```json
// Bucket policy on the source account
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::TARGET_ACCOUNT_ID:role/ConsumerRole"
    },
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::my-bucket",
      "arn:aws:s3:::my-bucket/*"
    ]
  }]
}
```

The consumer's IAM role must also allow the S3 actions in its identity policy.

---

## Performance Patterns

| Scenario | Pattern |
|----------|---------|
| High-throughput reads | Use random key prefixes to distribute across partitions |
| Many small objects | Consider batching into archives or S3 Express One Zone |
| Large file downloads | CloudFront CDN in front of S3 |
| Frequent access | S3 Standard or Express One Zone |
| Infrequent access | S3 Standard-IA (>128KB objects; charged per retrieval) |
| Long-term archive | Glacier IR (retrieval minutes) or Deep Archive (retrieval hours) |

---

## Related

- KMS encryption for S3: `/aws-iam` → `references/kms-patterns.md`
- S3 bucket IAM policies: `/aws-iam` → `references/policy-design.md`
- S3 event triggers for Lambda: `/aws-serverless` → `references/lambda-patterns.md`
