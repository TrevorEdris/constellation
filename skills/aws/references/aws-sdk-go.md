# AWS SDK for Go v2 — Reference

Module: `github.com/aws/aws-sdk-go-v2`

---

## Setup

```go
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/s3
# Add per-service packages as needed
```

---

## Configuration

```go
import (
    "context"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

func main() {
    ctx := context.Background()

    // Loads credential chain: env vars → ~/.aws/credentials → SSO → IMDS/ECS/Lambda role
    cfg, err := config.LoadDefaultConfig(ctx,
        config.WithRegion("us-east-1"),   // Override region if needed
    )
    if err != nil {
        log.Fatalf("unable to load SDK config: %v", err)
    }

    client := s3.NewFromConfig(cfg)
    // Reuse client — never create per-request
}
```

---

## Error Handling

```go
import (
    "errors"
    "github.com/aws/aws-sdk-go-v2/service/s3/types"
    "github.com/aws/smithy-go"
)

_, err := client.GetObject(ctx, &s3.GetObjectInput{
    Bucket: aws.String("my-bucket"),
    Key:    aws.String("my-key"),
})
if err != nil {
    var noSuchKey *types.NoSuchKey
    if errors.As(err, &noSuchKey) {
        return fmt.Errorf("object not found: %w", err)
    }

    var apiErr smithy.APIError
    if errors.As(err, &apiErr) {
        // Generic AWS API error
        log.Printf("code: %s, message: %s", apiErr.ErrorCode(), apiErr.ErrorMessage())
    }
    return fmt.Errorf("get object: %w", err)
}
```

**Rules:**
- Use `errors.As` — never type-assert directly (`err.(*types.NoSuchKey)` panics on nil)
- Always wrap errors with `%w` for chain transparency
- Service-specific error types live in `service/X/types` package

---

## Pagination

```go
// Wrong — manual token loop
var nextToken *string
for {
    out, _ := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
        Bucket:            aws.String("my-bucket"),
        ContinuationToken: nextToken,
    })
    // ... process out.Contents
    if !out.IsTruncated {
        break
    }
    nextToken = out.NextContinuationToken
}

// Correct — use the paginator
paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
    Bucket: aws.String("my-bucket"),
})
for paginator.HasMorePages() {
    page, err := paginator.NextPage(ctx)
    if err != nil {
        return fmt.Errorf("list objects: %w", err)
    }
    for _, obj := range page.Contents {
        fmt.Println(aws.ToString(obj.Key))
    }
}
```

---

## Retry Configuration

```go
import "github.com/aws/aws-sdk-go-v2/aws/retry"

cfg, _ := config.LoadDefaultConfig(ctx,
    config.WithRetryer(func() aws.Retryer {
        return retry.NewStandard(func(o *retry.StandardOptions) {
            o.MaxAttempts = 5
            o.MaxBackoff = 30 * time.Second
        })
    }),
)
```

Default retry: 3 attempts with exponential backoff on transient errors (throttles, 5xx).

---

## Presigned URLs

```go
presigner := s3.NewPresignClient(client)

req, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
    Bucket: aws.String("my-bucket"),
    Key:    aws.String("my-key"),
}, s3.WithPresignExpires(15*time.Minute))
if err != nil {
    return fmt.Errorf("presign: %w", err)
}
fmt.Println(req.URL)
```

---

## Anti-Patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| `session.NewSession` (v1) | `config.LoadDefaultConfig` (v2) |
| New client per request | Initialize once, reuse globally |
| `context.Background()` everywhere | Pass caller's context for cancellation |
| Ignoring `IsTruncated` | Use SDK paginators |
| Hardcoded credentials in config struct | Let the credential chain resolve |

---

## Useful Helpers

```go
aws.String("value")   // *string literal
aws.ToString(ptr)     // safe *string → string (returns "" on nil)
aws.Int32(42)         // *int32 literal
aws.ToInt32(ptr)      // safe *int32 → int32
```

---

## Related

- Go error wrapping patterns: `go-patterns` skill → `references/error-handling.md`
- Lambda handler structure with Go: `/aws-serverless` → `references/lambda-patterns.md`
