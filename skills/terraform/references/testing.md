# Terraform Testing

## Testing Pyramid

```
                    ┌──────────┐
                    │ Terratest│  Integration (real cloud)
                   /└──────────┘\
                  / ┌──────────┐ \
                 /  │ tf test  │  \  Unit + Integration (mock-capable)
                /   └──────────┘   \
               / ┌──────────────┐   \
              /  │   Checkov /  │    \  Policy-as-code (static)
             /   │   tfsec      │     \
            /    └──────────────┘      \
           / ┌────────────────────────┐ \
          /  │  terraform validate +  │  \  Structural (no cloud calls)
         /   │      terraform fmt     │   \
        /    └────────────────────────┘    \
```

## Gate 1: `terraform fmt` + `terraform validate`

```bash
# Format check — fails CI on unformatted code
terraform fmt -check -recursive .

# Structural and type check — no provider calls, fast
terraform validate
```

Add as pre-commit hooks:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.92.3
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_docs
        args: ["--hook-config=--path-to-file=README.md"]
```

## Gate 2: `tflint`

Provider-aware linting: invalid instance types, deprecated arguments, unused declarations.

```bash
# Install
brew install tflint

# Initialize plugins
tflint --init

# Run
tflint --recursive
```

`.tflint.hcl` with AWS plugin:

```hcl
plugin "aws" {
  enabled = true
  version = "0.33.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

rule "terraform_unused_declarations" {
  enabled = true
}

rule "terraform_deprecated_interpolation" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}

rule "terraform_required_version" {
  enabled = true
}
```

## Gate 3: Checkov (Policy-as-Code)

Security misconfiguration scanning. Run post-plan in CI.

```bash
# Install
pip install checkov

# Scan a directory
checkov -d .

# Scan with specific framework
checkov -d . --framework terraform

# Soft-fail (report without failing pipeline)
checkov -d . --soft-fail

# Skip specific check IDs
checkov -d . --skip-check CKV_AWS_18,CKV_AWS_19
```

### Checkov in GitHub Actions

```yaml
- name: Run Checkov
  uses: bridgecrewio/checkov-action@master
  with:
    directory: .
    framework: terraform
    output_format: sarif
    output_file_path: checkov-results.sarif
    soft_fail: false
```

## Gate 4: `terraform test` (Native, 1.6+)

HCL-based tests in `*.tftest.hcl` files. Supports mocking (1.7+) to avoid cloud API calls for unit tests.

```hcl
# tests/unit/main.tftest.hcl
mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    defaults = {
      id  = "test-bucket-id"
      arn = "arn:aws:s3:::test-bucket"
    }
  }
}

run "bucket_has_versioning_enabled" {
  variables {
    bucket_name = "my-test-bucket"
    versioning  = true
  }

  assert {
    condition     = aws_s3_bucket_versioning.this.versioning_configuration[0].status == "Enabled"
    error_message = "Expected versioning to be enabled"
  }
}

run "bucket_prevents_destroy" {
  variables {
    bucket_name = "my-test-bucket"
    versioning  = false
  }

  assert {
    condition     = aws_s3_bucket.this.lifecycle[0].prevent_destroy == true
    error_message = "Expected prevent_destroy lifecycle rule"
  }
}
```

```bash
# Run all tests
terraform test

# Run specific test file
terraform test -filter=tests/unit/main.tftest.hcl

# Verbose output
terraform test -verbose
```

## Gate 5: Terratest (Go Integration Tests)

Integration tests that actually provision infrastructure. Heavier — use for module validation gates, not per-PR.

```go
// test/s3_module_test.go
package test

import (
    "testing"
    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/gruntwork-io/terratest/modules/s3"
    "github.com/stretchr/testify/assert"
)

func TestS3ModuleCreatesEncryptedBucket(t *testing.T) {
    t.Parallel()

    terraformOptions := terraform.WithDefaultRetryableErrors(t, &terraform.Options{
        TerraformDir: "../examples/complete",
        Vars: map[string]interface{}{
            "bucket_name": "terratest-bucket-" + random.UniqueId(),
            "environment": "test",
        },
    })

    defer terraform.Destroy(t, terraformOptions)
    terraform.InitAndApply(t, terraformOptions)

    bucketName := terraform.Output(t, terraformOptions, "bucket_name")

    assert.True(t, s3.DoesBucketExist(t, "us-east-1", bucketName))
}
```

```bash
# Run integration tests
cd test
go test -v -timeout 30m ./...
```

## Pre-commit Configuration (Full Stack)

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.92.3
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
        args:
          - --args=--config=__GIT_WORKING_DIR__/.tflint.hcl
      - id: checkov
        args:
          - --args=--framework terraform
      - id: terraform_docs
        args: ["--hook-config=--path-to-file=README.md"]
      - id: terraform_trivy
```

## CI Pipeline Structure

```yaml
# .github/workflows/terraform.yml
jobs:
  validate:
    steps:
      - terraform fmt -check -recursive .
      - terraform init -backend=false
      - terraform validate

  lint:
    needs: validate
    steps:
      - tflint --recursive

  plan:
    needs: validate
    steps:
      - terraform init
      - terraform plan -out=plan.bin
      - checkov -d . --framework terraform

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    environment: production  # Manual approval gate
    steps:
      - terraform apply plan.bin
```
