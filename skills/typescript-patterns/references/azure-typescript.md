# Azure SDK for TypeScript / Node.js

Patterns for the `@azure/` npm scope. Load alongside `idiomatic-typescript.md` and `error-handling.md` when writing TypeScript or Node.js code targeting Azure services.

---

## Package Naming Convention

All Azure SDK v2 packages use the `@azure/` scope:

| Package | Purpose |
|---------|---------|
| `@azure/identity` | Authentication — always install this |
| `@azure/storage-blob` | Blob Storage |
| `@azure/storage-queue` | Queue Storage |
| `@azure/keyvault-secrets` | Key Vault Secrets |
| `@azure/keyvault-keys` | Key Vault Keys |
| `@azure/keyvault-certificates` | Key Vault Certificates |
| `@azure/cosmos` | Cosmos DB |
| `@azure/service-bus` | Service Bus |
| `@azure/event-hubs` | Event Hubs |
| `@azure/monitor-opentelemetry` | Azure Monitor (OTel exporter) |
| `@azure/app-configuration` | App Configuration |
| `applicationinsights` | Application Insights (auto-instrumentation) |

**Anti-pattern:** Never use `@azure/ms-rest-js` or `@azure/ms-rest-azure-js` — these are deprecated. All new code must use `@azure/` v2 clients.

**Anti-pattern:** Do not mix `azure-sdk` v1 and v2 clients in the same application — the credential and pipeline types are incompatible.

---

## Authentication

```typescript
import { DefaultAzureCredential } from "@azure/identity";

// Local dev + production: DefaultAzureCredential
const credential = new DefaultAzureCredential();

// Production pinning: Managed Identity (system-assigned)
import { ManagedIdentityCredential } from "@azure/identity";
const credential = new ManagedIdentityCredential();

// Production pinning: Managed Identity (user-assigned)
const credential = new ManagedIdentityCredential("<client-id>");

// Production pinning: Workload Identity (AKS)
import { WorkloadIdentityCredential } from "@azure/identity";
const credential = new WorkloadIdentityCredential();
// Reads AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_FEDERATED_TOKEN_FILE from env

// Server-side only (App Service / Functions): direct managed identity
// Browser apps: use InteractiveBrowserCredential
```

**Singleton pattern:** Create the credential once at module load time — the client caches tokens and refreshes them automatically. Creating a new credential per request is wasteful and incorrect.

```typescript
// credentials.ts — shared singleton
import { DefaultAzureCredential } from "@azure/identity";
export const azureCredential = new DefaultAzureCredential();
```

---

## Error Handling

All `@azure/` packages surface `RestError` from `@azure/core-rest-pipeline`:

```typescript
import { RestError } from "@azure/core-rest-pipeline";

async function getSecret(name: string): Promise<string> {
  try {
    const secret = await client.getSecret(name);
    return secret.value!;
  } catch (err) {
    if (err instanceof RestError) {
      switch (err.statusCode) {
        case 404:
          throw new NotFoundError(`Secret '${name}' not found`);
        case 403:
          throw new ForbiddenError(`No access to secret '${name}'`);
        case 429:
          // SDK retries automatically; if thrown, retries are exhausted
          throw new RateLimitError(`Rate limited accessing '${name}'`);
        default:
          throw new AzureError(`Azure error ${err.statusCode}: ${err.code}`, { cause: err });
      }
    }
    throw err; // Re-throw unexpected errors
  }
}
```

**Key fields on `RestError`:**

| Field | Type | Description |
|-------|------|-------------|
| `statusCode` | `number` | HTTP status code |
| `code` | `string \| undefined` | Azure error code (e.g., `"SecretNotFound"`) |
| `message` | `string` | Human-readable error message |
| `request` | `PipelineRequest` | The request that caused the error |

---

## Retry Configuration

All `@azure/` clients accept retry options via `PipelineRetryOptions`:

```typescript
import { BlobServiceClient } from "@azure/storage-blob";

const client = new BlobServiceClient(
  "https://<account>.blob.core.windows.net",
  credential,
  {
    retryOptions: {
      maxTries: 5,
      retryDelayInMs: 2000,
      maxRetryDelayInMs: 30000,
      retryPolicyType: StorageRetryPolicyType.EXPONENTIAL,
    },
  }
);
```

---

## Blob Storage

```typescript
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, BlockBlobUploadOptions } from "@azure/storage-blob";

const credential = new DefaultAzureCredential();
const serviceClient = new BlobServiceClient(
  "https://<account>.blob.core.windows.net",
  credential
);

// Upload string
const containerClient = serviceClient.getContainerClient("my-container");
const blobClient = containerClient.getBlockBlobClient("my-blob.txt");

await blobClient.upload("hello world", 11, {
  blobHTTPHeaders: { blobContentType: "text/plain" },
} satisfies BlockBlobUploadOptions);

// Upload stream
import { createReadStream } from "fs";
await blobClient.uploadStream(createReadStream("file.txt"));

// Download
const downloadResponse = await blobClient.download();
const content = await streamToString(downloadResponse.readableStreamBody!);

// List blobs
for await (const blob of containerClient.listBlobsFlat({ prefix: "prefix/" })) {
  console.log(blob.name, blob.properties.contentLength);
}

// Delete
await blobClient.delete();
```

---

## Key Vault Secrets

```typescript
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { RestError } from "@azure/core-rest-pipeline";

const credential = new DefaultAzureCredential();
const client = new SecretClient("https://<vault-name>.vault.azure.net", credential);

// Get latest version
async function getSecret(name: string): Promise<string> {
  try {
    const { value } = await client.getSecret(name);
    return value!;
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) {
      throw new Error(`Secret '${name}' not found`);
    }
    throw err;
  }
}

// Set secret
await client.setSecret("api-key", "<value>", {
  expiresOn: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
});

// List secrets
for await (const secretProperties of client.listPropertiesOfSecrets()) {
  console.log(secretProperties.name, secretProperties.expiresOn);
}
```

---

## Service Bus

```typescript
import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient, ServiceBusMessage } from "@azure/service-bus";

const credential = new DefaultAzureCredential();
const client = new ServiceBusClient("<namespace>.servicebus.windows.net", credential);

// Send message
const sender = client.createSender("my-queue");
try {
  await sender.sendMessages({
    body: { event: "user.created", id: "123" },
    contentType: "application/json",
  } satisfies ServiceBusMessage);
} finally {
  await sender.close();
}

// Receive and process messages
const receiver = client.createReceiver("my-queue", { receiveMode: "peekLock" });

const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 5000 });
for (const message of messages) {
  try {
    // Process message
    console.log("Received:", message.body);
    await receiver.completeMessage(message);
  } catch (err) {
    await receiver.abandonMessage(message);
  }
}

await receiver.close();
await client.close();
```

---

## Anti-Patterns

| Anti-Pattern | Correct Pattern |
|-------------|----------------|
| `import { DefaultAzureCredential } from "@azure/ms-rest-js"` | Import from `@azure/identity` |
| `new DefaultAzureCredential()` on every request | Create once, share across all SDK clients |
| `catch (err: any)` without checking `instanceof RestError` | `if (err instanceof RestError) { ... }` |
| Connection strings in `process.env` or `.env` | Managed Identity + `DefaultAzureCredential` |
| Mixing `@azure/` v1 and v2 clients | Use only `@azure/` v2 scope packages |
| `.value!` on optional secrets without null check | Check `if (!secret.value) throw ...` before using |
| `for await` on `listBlobsFlat` without abort signal | Pass `AbortSignal.timeout(30_000)` to long-running list operations |
