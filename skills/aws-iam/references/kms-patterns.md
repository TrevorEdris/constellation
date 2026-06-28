# KMS Patterns — Reference

CMK design, key policies, envelope encryption, grants, and compliance considerations.

---

## Key Types

| Type | Management | Rotation | Cost | When to Use |
|------|-----------|----------|------|-------------|
| AWS Managed (`aws/service`) | AWS manages | Automatic (annual) | Free | Default; no policy control needed |
| Customer Managed (CMK) | You manage policy + rotation | Manual or automatic | $1/key/month | Compliance, cross-account, audit, revocation |
| Imported Key Material | You provide bytes | Manual (re-import) | $1/key/month | HSM or regulatory key source requirements |
| Multi-Region CMK | CMK replicated across regions | Same key ID in multiple regions | $1/key/region | Global applications, DR key access |

**Use CMK when:**
- Regulatory requirement to manage your own key lifecycle
- Need to revoke access by disabling/deleting a key
- Cross-account encryption (AWS managed keys cannot be used cross-account)
- Audit trail of every encrypt/decrypt call (via CloudTrail)

---

## Key Policy Structure

Every CMK requires a key policy. Unlike IAM policies, if the key policy does not explicitly allow the account root, the key is permanently inaccessible.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccess",
      "Comment": "Required — never remove this. Allows IAM policies to grant key access.",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::ACCOUNT:root"},
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowKeyAdministrators",
      "Effect": "Allow",
      "Principal": {"AWS": [
        "arn:aws:iam::ACCOUNT:role/KeyAdminRole"
      ]},
      "Action": [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*",
        "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*",
        "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowApplicationUse",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::ACCOUNT:role/AppRole"},
      "Action": ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "s3.us-east-1.amazonaws.com"  // Restrict to S3 only
        }
      }
    }
  ]
}
```

---

## Envelope Encryption

For data larger than 4KB, never call `kms:Encrypt` directly. Use envelope encryption:

```
1. kms:GenerateDataKey  → returns: { Plaintext: DEK, CiphertextBlob: encrypted_DEK }
2. Encrypt data locally with DEK (AES-256-GCM)
3. Store: { ciphertext, encrypted_DEK, key_id }
4. Discard plaintext DEK immediately after use

To decrypt:
1. kms:Decrypt(encrypted_DEK) → plaintext DEK
2. Decrypt ciphertext with DEK locally
3. Discard plaintext DEK after use
```

```python
import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

kms = boto3.client('kms')

def encrypt_data(key_id: str, plaintext: bytes) -> dict:
    # Get a fresh data key for each encrypt operation
    response = kms.generate_data_key(
        KeyId=key_id,
        KeySpec='AES_256'
    )
    dek = response['Plaintext']
    encrypted_dek = response['CiphertextBlob']

    # Encrypt locally
    nonce = os.urandom(12)
    aesgcm = AESGCM(dek)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    dek = b'\x00' * len(dek)  # Zero the DEK from memory

    return {
        'ciphertext': nonce + ciphertext,
        'encrypted_dek': encrypted_dek,
        'key_id': key_id
    }

def decrypt_data(envelope: dict) -> bytes:
    response = kms.decrypt(CiphertextBlob=envelope['encrypted_dek'])
    dek = response['Plaintext']

    nonce = envelope['ciphertext'][:12]
    ciphertext = envelope['ciphertext'][12:]
    aesgcm = AESGCM(dek)
    return aesgcm.decrypt(nonce, ciphertext, None)
```

---

## Key Rotation

```bash
# Enable automatic annual rotation
aws kms enable-key-rotation --key-id alias/my-key

# Check rotation status
aws kms get-key-rotation-status --key-id alias/my-key

# Manual rotation: create a new CMK, re-encrypt data, update aliases
aws kms create-alias \
  --alias-name alias/my-key \
  --target-key-id NEW_KEY_ID
```

KMS retains old key versions for decryption indefinitely — encrypted data using the old key can still be decrypted.

---

## KMS Grants

Grants allow temporary, scoped access without modifying the key policy — useful for service accounts and cross-account access:

```bash
aws kms create-grant \
  --key-id alias/my-key \
  --grantee-principal arn:aws:iam::ACCOUNT:role/TemporaryRole \
  --operations Decrypt GenerateDataKey \
  --name "temp-access-for-migration"

# Revoke when done
aws kms revoke-grant \
  --key-id alias/my-key \
  --grant-id GRANT_ID
```

---

## `kms:ViaService` Condition

Enforce that KMS operations can only be called through a specific AWS service — prevents direct API abuse:

```json
{
  "Condition": {
    "StringEquals": {
      "kms:ViaService": [
        "s3.us-east-1.amazonaws.com",
        "secretsmanager.us-east-1.amazonaws.com"
      ]
    }
  }
}
```

---

## Compliance Checklist

- [ ] CMK has explicit root principal statement (prevents permanent lockout)
- [ ] Annual key rotation enabled for all CMKs
- [ ] CloudTrail logging captures all KMS API calls
- [ ] Key usage monitored with CloudWatch metrics (`NumberOfRequestsForKeyId`)
- [ ] Unused CMKs scheduled for deletion (`aws kms schedule-key-deletion --pending-window-in-days 30`)
- [ ] Cross-account access scoped with `kms:ViaService` or `aws:PrincipalAccount` conditions
- [ ] No IAM user has direct `kms:Decrypt` permission (use roles)
- [ ] Key aliases used in code instead of key IDs (aliases can be updated; key IDs are permanent)

---

## Common Mistakes

| Mistake | Risk | Fix |
|---------|------|-----|
| Calling `kms:Encrypt` on large data | 4KB limit; high KMS cost at scale | Use envelope encryption |
| No root principal in key policy | Permanent key lockout | Always include root principal |
| Key ID hardcoded in application | Brittle; breaks key rotation | Use aliases (`alias/my-key`) |
| `kms:*` granted to application roles | Excessive privilege including key deletion | Grant only `Decrypt`, `GenerateDataKey`, `DescribeKey` |
| Sharing CMKs across environments | Dev compromise affects prod keys | One CMK per environment per service |
