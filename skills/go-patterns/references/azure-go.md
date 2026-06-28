# Azure SDK for Go

Patterns for the Azure SDK for Go (`github.com/Azure/azure-sdk-for-go/sdk/`). Load alongside `idiomatic-go.md` and `error-handling.md` when writing Go code targeting Azure services.

---

## Module Layout

The Azure SDK for Go uses a `sdk/` tree. Each service has its own module.

```
github.com/Azure/azure-sdk-for-go/sdk/
├── azidentity/          # Authentication — always import this
├── azcore/              # Core HTTP pipeline, retries, errors
├── storage/azblob/      # Blob Storage
├── security/keyvault/
│   ├── azsecrets/       # Key Vault Secrets
│   ├── azkeys/          # Key Vault Keys
│   └── azcertificates/  # Key Vault Certificates
├── data/azcosmos/       # Cosmos DB
├── resourcemanager/     # Management plane (provision resources)
│   ├── storage/         # Manage storage accounts
│   ├── network/         # Manage VNets, NSGs
│   └── ...
└── messaging/
    └── azservicebus/    # Service Bus
```

**Anti-pattern:** Never import from `github.com/Azure/azure-sdk-for-go/services/` — that is the deprecated `autorest`-based tree. All new code must use `sdk/`.

---

## Authentication

```go
import "github.com/Azure/azure-sdk-for-go/sdk/azidentity"

// Local dev + production: DefaultAzureCredential
// Chain: env vars → Workload Identity → Managed Identity → Azure CLI
credential, err := azidentity.NewDefaultAzureCredential(nil)
if err != nil {
    return fmt.Errorf("creating credential: %w", err)
}

// Production pinning: Managed Identity (system-assigned)
credential, err := azidentity.NewManagedIdentityCredential(nil)

// Production pinning: Managed Identity (user-assigned)
credential, err := azidentity.NewManagedIdentityCredential(
    &azidentity.ManagedIdentityCredentialOptions{
        ID: azidentity.ClientID("<client-id>"),
    },
)

// Production pinning: Workload Identity (AKS)
credential, err := azidentity.NewWorkloadIdentityCredential(nil)
// Reads AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_FEDERATED_TOKEN_FILE from env
```

**Pin the credential type in production** to avoid unexpected fallbacks. `DefaultAzureCredential` probes 8+ credential sources — in production, only one should be valid.

**Set `AZURE_TOKEN_CREDENTIALS` env var** to restrict the chain without code changes:
```
AZURE_TOKEN_CREDENTIALS=ManagedIdentityCredential
```

---

## Error Handling

All Azure SDK errors implement `*azcore.ResponseError`. Use `errors.As` — do not type-assert directly.

```go
import (
    "errors"
    "github.com/Azure/azure-sdk-for-go/sdk/azcore"
)

_, err := blobClient.DownloadStream(ctx, nil)
if err != nil {
    var respErr *azcore.ResponseError
    if errors.As(err, &respErr) {
        switch respErr.StatusCode {
        case 404:
            return nil, ErrNotFound
        case 409:
            return nil, ErrConflict
        case 429:
            // Throttled — SDK retries automatically; if bubbled up, it's permanent
            return nil, fmt.Errorf("rate limited: %w", err)
        default:
            return nil, fmt.Errorf("azure error %d (%s): %w",
                respErr.StatusCode, respErr.ErrorCode, err)
        }
    }
    return nil, fmt.Errorf("unexpected error: %w", err)
}
```

**Key fields on `*azcore.ResponseError`:**

| Field | Type | Description |
|-------|------|-------------|
| `StatusCode` | `int` | HTTP status code |
| `ErrorCode` | `string` | Azure service error code (e.g., `BlobNotFound`) |
| `RawResponse` | `*http.Response` | Full response for debugging |

---

## Retry Configuration

The SDK retries transient errors automatically (429, 500, 503). Customize via client options:

```go
import (
    "time"
    "github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
    "github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
)

client, err := azblob.NewClient(
    "https://<account>.blob.core.windows.net",
    credential,
    &azblob.ClientOptions{
        ClientOptions: azcore.ClientOptions{
            Retry: policy.RetryOptions{
                MaxRetries:    5,
                RetryDelay:    2 * time.Second,
                MaxRetryDelay: 30 * time.Second,
            },
        },
    },
)
```

Default retry behavior: 3 retries, exponential backoff, 4s base delay, 120s max. Override when the workload requires more aggressive or more conservative retry behavior.

---

## Context Propagation

Always pass `context.Context` through the entire call chain. All Azure SDK methods accept `ctx context.Context` as the first argument.

```go
func (s *StorageService) GetBlob(ctx context.Context, containerName, blobName string) ([]byte, error) {
    resp, err := s.client.DownloadStream(ctx, containerName, blobName, nil)
    if err != nil {
        return nil, fmt.Errorf("downloading blob %s/%s: %w", containerName, blobName, err)
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

Do not use `context.Background()` inside functions that accept a context — propagate the caller's context to respect cancellation and deadlines.

---

## Blob Storage

```go
import "github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"

credential, _ := azidentity.NewDefaultAzureCredential(nil)
client, err := azblob.NewClient(
    "https://<account>.blob.core.windows.net",
    credential,
    nil,
)
if err != nil {
    return fmt.Errorf("creating blob client: %w", err)
}

// Upload
_, err = client.UploadBuffer(ctx, "my-container", "my-blob.txt", data, nil)

// Download
resp, err := client.DownloadBuffer(ctx, "my-container", "my-blob.txt", data, nil)

// List blobs
pager := client.NewListBlobsFlatPager("my-container", nil)
for pager.More() {
    page, err := pager.NextPage(ctx)
    if err != nil {
        return fmt.Errorf("listing blobs: %w", err)
    }
    for _, blob := range page.Segment.BlobItems {
        fmt.Println(*blob.Name)
    }
}
```

---

## Key Vault Secrets

```go
import "github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azsecrets"

credential, _ := azidentity.NewDefaultAzureCredential(nil)
client, err := azsecrets.NewClient(
    "https://<vault-name>.vault.azure.net",
    credential,
    nil,
)
if err != nil {
    return fmt.Errorf("creating key vault client: %w", err)
}

// Get secret (latest version)
resp, err := client.GetSecret(ctx, "my-secret", "", nil)
if err != nil {
    var respErr *azcore.ResponseError
    if errors.As(err, &respErr) && respErr.StatusCode == 404 {
        return "", fmt.Errorf("secret not found: %w", ErrNotFound)
    }
    return "", fmt.Errorf("getting secret: %w", err)
}
value := *resp.Value
```

---

## Service Bus

```go
import "github.com/Azure/azure-sdk-for-go/sdk/messaging/azservicebus"

credential, _ := azidentity.NewDefaultAzureCredential(nil)
client, err := azservicebus.NewClient("<namespace>.servicebus.windows.net", credential, nil)
if err != nil {
    return fmt.Errorf("creating service bus client: %w", err)
}
defer client.Close(ctx)

// Send a message
sender, err := client.NewSender("my-queue", nil)
if err != nil {
    return fmt.Errorf("creating sender: %w", err)
}
defer sender.Close(ctx)

err = sender.SendMessage(ctx, &azservicebus.Message{
    Body: []byte(`{"event": "user.created", "id": "123"}`),
}, nil)

// Receive messages
receiver, err := client.NewReceiverForQueue("my-queue", nil)
if err != nil {
    return fmt.Errorf("creating receiver: %w", err)
}
defer receiver.Close(ctx)

messages, err := receiver.ReceiveMessages(ctx, 10, nil)
for _, msg := range messages {
    // Process...
    err = receiver.CompleteMessage(ctx, msg, nil)
    if err != nil {
        _ = receiver.AbandonMessage(ctx, msg, nil)
    }
}
```

---

## Anti-Patterns

| Anti-Pattern | Correct Pattern |
|-------------|----------------|
| `import "github.com/Azure/azure-sdk-for-go/services/..."` | Import from `sdk/` tree |
| `context.Background()` inside a handler | Propagate the request context |
| `err.(*azcore.ResponseError)` (direct type assertion) | `errors.As(err, &respErr)` |
| Hard-coded account keys or connection strings | `DefaultAzureCredential` + SDK clients |
| `DefaultAzureCredential` without `AZURE_TOKEN_CREDENTIALS` pin in production | Pin credential type explicitly |
| Creating a new credential per request | Create credential once at startup; it caches tokens |
