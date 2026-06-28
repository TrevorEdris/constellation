# Azure SDK for Python

Patterns for `azure-sdk-for-python`. Load alongside `idiomatic-python.md` and `error-handling.md` when writing Python that targets Azure services.

---

## Package Naming Convention

Azure Python SDK packages follow `azure-<service>[-<plane>]`:

| Package | Purpose |
|---------|---------|
| `azure-identity` | Authentication — always install this |
| `azure-storage-blob` | Blob Storage |
| `azure-storage-queue` | Queue Storage |
| `azure-keyvault-secrets` | Key Vault Secrets |
| `azure-keyvault-keys` | Key Vault Keys |
| `azure-keyvault-certificates` | Key Vault Certificates |
| `azure-cosmos` | Cosmos DB |
| `azure-servicebus` | Service Bus |
| `azure-monitor-opentelemetry` | Azure Monitor (OTel exporter) |
| `azure-mgmt-*` | Management plane (provision resources) — requires `azure-identity` |

**Pin `azure-identity>=1.15`** — this version added `AZURE_TOKEN_CREDENTIALS` env var support for credential chain pinning.

---

## Authentication

```python
from azure.identity import DefaultAzureCredential

# Local dev + production: DefaultAzureCredential
# Chain: env vars → Workload Identity → Managed Identity → Azure CLI → VS Code → ...
credential = DefaultAzureCredential()

# Production pinning: Managed Identity (system-assigned)
from azure.identity import ManagedIdentityCredential
credential = ManagedIdentityCredential()

# Production pinning: Managed Identity (user-assigned)
credential = ManagedIdentityCredential(client_id="<client-id>")

# Production pinning: Workload Identity (AKS)
from azure.identity import WorkloadIdentityCredential
credential = WorkloadIdentityCredential()
# Reads AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_FEDERATED_TOKEN_FILE from env
```

### Async Credentials

For `asyncio`-based applications, use the async variant from `azure.identity.aio`:

```python
from azure.identity.aio import DefaultAzureCredential
from azure.storage.blob.aio import BlobServiceClient

async def main():
    async with DefaultAzureCredential() as credential:
        async with BlobServiceClient(
            account_url="https://<account>.blob.core.windows.net",
            credential=credential,
        ) as client:
            # ... use client
            pass
```

**Always close async credentials** — use `async with` or call `await credential.close()`. Unclosed async credentials leak background token refresh tasks.

**Token caching:**
- Sync: In-memory by default. Disk caching opt-in via `azure.identity.TokenCachePersistenceOptions`.
- Async: Same in-memory default.

---

## Error Handling

```python
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError, ResourceExistsError

try:
    secret = client.get_secret("my-secret")
except ResourceNotFoundError:
    # 404 — use this subclass when available
    raise SecretNotFoundError("my-secret")
except HttpResponseError as e:
    if e.status_code == 429:
        # Throttled — SDK retries automatically; if bubbled up, retries exhausted
        raise RateLimitExceededError from e
    raise AzureServiceError(f"Azure error {e.status_code}: {e.error.code}") from e
```

**Key exception hierarchy:**

| Exception | HTTP Status | When Raised |
|-----------|------------|-------------|
| `ResourceNotFoundError` | 404 | Resource does not exist |
| `ResourceExistsError` | 409 | Resource already exists (create conflicts) |
| `ResourceModifiedError` | 412 | Etag conflict (optimistic concurrency) |
| `ClientAuthenticationError` | 401 | Auth failed |
| `ServiceRequestError` | N/A | Network-level failure (connection refused, timeout) |
| `HttpResponseError` | Any | All other HTTP errors — base class |

Do not catch broad `Exception` — catch `HttpResponseError` and handle by `status_code`.

---

## Retry Configuration

The `azure-core` package underpins all Azure Python SDKs with a consistent retry pipeline.

```python
from azure.storage.blob import BlobServiceClient
from azure.core.pipeline.policies import RetryPolicy

client = BlobServiceClient(
    account_url="https://<account>.blob.core.windows.net",
    credential=credential,
    retry_total=5,
    retry_backoff_factor=2,
    retry_backoff_max=60,
)
```

Default retry behavior: 3 retries, exponential backoff. Override per-client in constructor kwargs.

---

## Blob Storage

```python
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContentSettings

credential = DefaultAzureCredential()
service_client = BlobServiceClient(
    account_url="https://<account>.blob.core.windows.net",
    credential=credential,
)

# Upload
blob_client = service_client.get_blob_client(container="my-container", blob="my-blob.txt")
with open("file.txt", "rb") as f:
    blob_client.upload_blob(
        f,
        overwrite=True,
        content_settings=ContentSettings(content_type="text/plain"),
    )

# Download
download_stream = blob_client.download_blob()
content = download_stream.readall()

# List blobs
container_client = service_client.get_container_client("my-container")
for blob in container_client.list_blobs(name_starts_with="prefix/"):
    print(blob.name, blob.size)

# Delete
blob_client.delete_blob(delete_snapshots="include")
```

---

## Key Vault Secrets

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.core.exceptions import ResourceNotFoundError

credential = DefaultAzureCredential()
client = SecretClient(
    vault_url="https://<vault-name>.vault.azure.net",
    credential=credential,
)

# Get secret
try:
    secret = client.get_secret("database-password")
    value = secret.value
except ResourceNotFoundError:
    raise RuntimeError("Secret 'database-password' not found in Key Vault")

# Set secret with expiry
from datetime import datetime, timezone, timedelta
client.set_secret(
    "api-key",
    "<secret-value>",
    expires_on=datetime.now(timezone.utc) + timedelta(days=90),
)

# List secrets
for secret_props in client.list_properties_of_secrets():
    print(secret_props.name, secret_props.expires_on)
```

---

## Cosmos DB

```python
from azure.identity import DefaultAzureCredential
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import CosmosHttpResponseError

credential = DefaultAzureCredential()
client = CosmosClient(
    url="https://<account>.documents.azure.com:443/",
    credential=credential,
)

database = client.get_database_client("mydb")
container = database.get_container_client("items")

# Create item
item = {"id": "123", "partitionKey": "tenant-A", "data": "..."}
container.create_item(body=item)

# Read item (point read — cheapest)
try:
    item = container.read_item(item="123", partition_key="tenant-A")
except CosmosHttpResponseError as e:
    if e.status_code == 404:
        raise ItemNotFoundError("123")
    raise

# Query (always include partition key filter)
query = "SELECT * FROM c WHERE c.partitionKey = @pk AND c.status = @status"
items = list(container.query_items(
    query=query,
    parameters=[
        {"name": "@pk", "value": "tenant-A"},
        {"name": "@status", "value": "active"},
    ],
    partition_key="tenant-A",
))
```

---

## Anti-Patterns

| Anti-Pattern | Correct Pattern |
|-------------|----------------|
| `azure-mgmt-*` without `azure-identity` (old pattern) | Use `DefaultAzureCredential` with `azure-identity` |
| `from azure.identity import DefaultAzureCredential` without pinning `azure-identity>=1.15` | Pin version in `pyproject.toml` |
| Not closing async clients/credentials | Use `async with` context managers |
| Catching bare `Exception` instead of `HttpResponseError` | Catch the specific exception class |
| Connection strings in environment variables | Use Managed Identity + SDK clients |
| Creating a new `DefaultAzureCredential()` per request | Create once at application startup |
| `from azure.cosmos import exceptions` without checking `status_code` | Always check `e.status_code` in `CosmosHttpResponseError` |
