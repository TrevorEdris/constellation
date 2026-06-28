# AWS SDK for Rust — Reference

Crate family: `aws-config`, `aws-sdk-*` (per-service)

Maturity note: GA since 2023. Fewer community examples than Go/Python/JS — consult [AWS SDK for Rust docs](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/getting-started.html) for service-specific patterns not covered here.

---

## Setup

```toml
# Cargo.toml
[dependencies]
aws-config = { version = "1", features = ["behavior-version-latest"] }
aws-sdk-s3 = "1"
aws-sdk-lambda = "1"  # Add per-service crates as needed
tokio = { version = "1", features = ["full"] }
```

---

## Configuration

```rust
use aws_config::BehaviorVersion;
use aws_sdk_s3::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Credential chain: env vars → profile → web identity (OIDC) → IMDSv2
    let config = aws_config::defaults(BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let client = Client::new(&config);
    // Reuse client — Arc<Client> for multi-thread sharing
    Ok(())
}
```

**Critical:** `BehaviorVersion::latest()` is required since SDK 1.x. Using `BehaviorVersion::v2023_11_09()` (deprecated) emits warnings and will eventually fail.

---

## Error Handling

```rust
use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::operation::get_object::GetObjectError;
use aws_sdk_s3::Client;

async fn get_object(client: &Client, bucket: &str, key: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let response = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await;

    match response {
        Ok(output) => {
            let data = output.body.collect().await?.into_bytes().to_vec();
            Ok(data)
        }
        Err(SdkError::ServiceError(err)) => {
            match err.err() {
                GetObjectError::NoSuchKey(_) => {
                    Err(format!("Object not found: s3://{}/{}", bucket, key).into())
                }
                _ => Err(Box::new(err.into_err())),
            }
        }
        Err(err) => Err(Box::new(err)),
    }
}
```

**Pattern:**
1. Match on `SdkError<ServiceError>`
2. Call `.into_service_error()` or match on `SdkError::ServiceError` to get typed errors
3. `SdkError::ConstructionFailure` = SDK config issue (not a transient error — don't retry)
4. `SdkError::TimeoutError` / `SdkError::DispatchFailure` = network issues (retriable)
5. Never `unwrap()` or `panic!()` on AWS errors in production code

---

## Builder Pattern (Fluent API)

```rust
// All SDK operations use builder pattern
let output = client
    .list_objects_v2()
    .bucket("my-bucket")
    .prefix("logs/")
    .max_keys(100)
    .send()
    .await?;

for obj in output.contents() {
    println!("{}", obj.key().unwrap_or_default());
}
```

---

## Pagination

```rust
use aws_sdk_s3::Client;

async fn list_all_objects(client: &Client, bucket: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut keys = Vec::new();
    let mut paginator = client
        .list_objects_v2()
        .bucket(bucket)
        .into_paginator()
        .send();

    while let Some(page) = paginator.next().await {
        let page = page?;
        for obj in page.contents() {
            keys.push(obj.key().unwrap_or_default().to_string());
        }
    }
    Ok(keys)
}
```

Use `.into_paginator()` — available on all paginated operations.

---

## Async Runtime

The AWS SDK for Rust supports **only `tokio`**. Do not use `async-std`, `smol`, or other runtimes.

```rust
// Correct: tokio runtime
#[tokio::main]
async fn main() { ... }

// Wrong: blocking call inside async context
let result = tokio::runtime::Handle::current().block_on(async { ... }); // Can deadlock
```

---

## Shared Client (Multi-thread)

```rust
use std::sync::Arc;
use aws_sdk_s3::Client;

// Clients are cheaply cloneable (Arc-backed internally) — share across threads
let client = Arc::new(Client::new(&config));
let client_clone = Arc::clone(&client);

tokio::spawn(async move {
    client_clone.list_buckets().send().await.unwrap();
});
```

---

## Anti-Patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| `block_on` inside async tasks | Structure code as async throughout; avoid mixing |
| Skipping `BehaviorVersion::latest()` | Always specify it — required since SDK 1.x |
| `unwrap()` on SDK errors | Match on `SdkError` variants; return `Result` |
| Creating a new config per call | Load config once; share `SdkConfig` reference |
| Not using `.into_paginator()` | Always paginate for list operations |

---

## Credential Verification

```rust
use aws_sdk_sts::Client as StsClient;

let sts = StsClient::new(&config);
let identity = sts.get_caller_identity().send().await?;
println!("Arn: {:?}", identity.arn());
```

---

## Related

- Lambda handler with Rust (lambda_runtime): `/aws-serverless` → `references/lambda-patterns.md`
- Rust error handling patterns: consult the `thiserror`/`anyhow` ecosystem for wrapping `SdkError`
