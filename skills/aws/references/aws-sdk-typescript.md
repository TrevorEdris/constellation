# AWS SDK for TypeScript/Node.js v3 — Reference

Package family: `@aws-sdk/client-*` (modular, tree-shakeable)

---

## Setup

```bash
# Install only what you need — each service is its own package
npm install @aws-sdk/client-s3 @aws-sdk/client-lambda @aws-sdk/client-dynamodb
npm install @aws-sdk/lib-dynamodb          # Higher-level DynamoDB document client
npm install @aws-sdk/s3-request-presigner  # Presigned URL helper

# TypeScript types are bundled — no separate @types package needed
```

---

## Configuration

```typescript
import { S3Client } from "@aws-sdk/client-s3";

// Credential chain: env vars → ~/.aws/credentials → SSO token → ECS/Lambda execution role
const client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  // Do NOT hardcode accessKeyId / secretAccessKey
  maxAttempts: 5,  // Default is 3; increase for DynamoDB, SQS
});

// Create once at module scope — reuse across requests
export default client;
```

---

## Command Pattern (v3)

v3 uses a command pattern instead of fluent methods:

```typescript
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({ region: "us-east-1" });

const response = await client.send(
  new GetObjectCommand({ Bucket: "my-bucket", Key: "my-key" })
);

const body = await response.Body?.transformToString();
```

---

## Error Handling

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { NoSuchKey } from "@aws-sdk/client-s3";
import { ServiceException } from "@smithy/smithy-client";

async function getObject(bucket: string, key: string): Promise<string> {
  const client = new S3Client({ region: "us-east-1" });
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return (await response.Body?.transformToString()) ?? "";
  } catch (err) {
    if (err instanceof NoSuchKey) {
      throw new Error(`Object not found: s3://${bucket}/${key}`);
    }
    if (err instanceof ServiceException) {
      // Generic AWS service error — has .name, .message, .$metadata
      console.error(`AWS error: ${err.name} - ${err.message}`);
    }
    throw err;
  }
}
```

**Error types:**
- Service-specific errors: `import { NoSuchKey } from "@aws-sdk/client-s3"`
- Base class: `ServiceException` from `@smithy/smithy-client`
- Check `err.name` for the error code string (`"NoSuchKey"`, `"AccessDenied"`)
- `err.$metadata.httpStatusCode` for HTTP status

---

## Pagination

```typescript
import { paginateListObjectsV2 } from "@aws-sdk/client-s3";

const paginator = paginateListObjectsV2(
  { client },
  { Bucket: "my-bucket", Prefix: "logs/" }
);

for await (const page of paginator) {
  for (const obj of page.Contents ?? []) {
    console.log(obj.Key);
  }
}
```

Pagination helpers follow the pattern `paginate<OperationName>` in each service package.

---

## DynamoDB Document Client

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Get item — automatically unmarshals DynamoDB types to JS types
const result = await dynamo.send(new GetCommand({
  TableName: "my-table",
  Key: { pk: "user#123", sk: "profile" },
}));
const item = result.Item;  // Plain JavaScript object

// Put item — automatically marshals JS types to DynamoDB types
await dynamo.send(new PutCommand({
  TableName: "my-table",
  Item: { pk: "user#123", sk: "profile", name: "Alice", age: 30 },
}));
```

---

## Presigned URLs

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({ region: "us-east-1" });

const url = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: "my-bucket", Key: "my-file.pdf" }),
  { expiresIn: 3600 }  // seconds
);
```

---

## v2 vs v3 Migration

| Feature | v2 (`aws-sdk`) | v3 (`@aws-sdk/client-*`) |
|---------|---------------|--------------------------|
| Import | `import AWS from 'aws-sdk'` | Per-service: `import { S3Client } from '@aws-sdk/client-s3'` |
| Tree-shaking | No (entire SDK in bundle) | Yes (only imported services) |
| Middleware | Plugin-based | Middleware stack (native) |
| ESM | No | Yes |
| Status | EOL (2025) | Current |

**Migration priority:** Lambda functions especially — v2 in Lambda bundle adds ~5MB and significant cold start time.

---

## Anti-Patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| `import AWS from 'aws-sdk'` in new code | Per-service v3 imports |
| `new S3Client()` inside every function call | Create at module scope, reuse |
| Not setting `maxAttempts` | Set to 5 for DynamoDB, SQS, Step Functions |
| Hardcoding `accessKeyId` in client config | Let credential chain resolve |
| `response.Body.read()` (v2 style) | `await response.Body.transformToString()` (v3) |
| Ignoring `err.$metadata.requestId` | Log it — required for AWS Support tickets |

---

## Related

- TypeScript async patterns: `typescript-patterns` skill
- Lambda handler structure with Node.js: `/aws-serverless` → `references/lambda-patterns.md`
- DynamoDB single-table design: `database-schema-designer` skill
