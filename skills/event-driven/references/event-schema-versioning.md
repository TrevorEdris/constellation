# Event Schema Versioning Reference

Strategies for evolving event schemas without breaking producers or consumers.

---

## Why Event Schema Versioning Is Hard

Unlike an API where breaking changes can be deployed with a version bump and migration period, events in a stream are immutable. Old events cannot be changed retroactively. Consumers replaying from the beginning of a Kafka topic may encounter events from years ago.

Requirements:
- **Forward compatibility:** new producers, old consumers — old consumer can read new event
- **Backward compatibility:** old producers, new consumers — new consumer can read old event
- **Long-term replay:** consumer rebuilt from scratch must be able to read all historical events

---

## Schema Format Comparison

### Avro (recommended for high-throughput Kafka)

Binary encoding; very compact (field names not repeated in payload). Requires schema registry.

```json
{
  "type": "record",
  "name": "OrderCreated",
  "namespace": "com.example.orders",
  "fields": [
    {"name": "order_id", "type": "string"},
    {"name": "user_id",  "type": "string"},
    {"name": "total",    "type": "double"},
    {"name": "currency", "type": "string", "default": "USD"},
    {"name": "created_at", "type": "string"}
  ]
}
```

Adding `currency` with a `"default": "USD"` is a backward-compatible change: old consumers that don't know about `currency` can still read new messages (they ignore the field); new consumers reading old messages get the default.

### Protobuf (recommended for cross-language microservices)

Binary encoding; field numbers are the stable identity — field names can change. Strong backward/forward compatibility guarantees when field numbers are preserved.

```protobuf
syntax = "proto3";

package com.example.orders;

message OrderCreated {
  string order_id   = 1;
  string user_id    = 2;
  double total      = 3;
  string currency   = 4;  // added in v2; old messages have zero value ""
  int64  created_at = 5;  // unix timestamp
}
```

**Rules for backward compatibility:**
- Never reuse a field number for a different type
- Never delete a field number (mark deprecated but keep it)
- Adding new fields with new field numbers is always backward compatible in proto3

### JSON Schema (low-throughput, high readability)

Human-readable; no schema registry required; no binary encoding. Compatibility checking is advisory (not enforced on publish).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "$id": "https://example.com/schemas/order-created/v2",
  "type": "object",
  "required": ["order_id", "user_id", "total", "created_at"],
  "properties": {
    "order_id":   {"type": "string"},
    "user_id":    {"type": "string"},
    "total":      {"type": "number"},
    "currency":   {"type": "string", "default": "USD"},
    "created_at": {"type": "string", "format": "date-time"}
  }
}
```

### CloudEvents (envelope standard)

CloudEvents is a specification for event metadata, not a serialization format. Use it as a wrapper around an Avro/Protobuf/JSON payload.

```json
{
  "specversion": "1.0",
  "id":           "01HX5RNK9J3PMQBK56XVZY7NQ5",
  "source":       "/services/order-service",
  "type":         "com.example.orders.OrderCreated",
  "time":         "2024-01-15T10:30:00Z",
  "datacontenttype": "application/avro",
  "schemaversion": "2",
  "data":         "<avro-encoded-bytes>"
}
```

CloudEvents provides: standard source, ID (for deduplication), type, and time. Payload format is separate.

---

## Compatibility Rules

### Safe changes (always compatible)

- Add an optional field with a default value
- Add a new message/record type
- Rename a field (Protobuf: don't rename field numbers; Avro: add alias)
- Add a new enum value (if consumer handles unknown values gracefully)

### Breaking changes (never allowed on a live topic)

- Remove a required field
- Change a field's data type
- Rename a field without a transition period
- Change the semantics of a field without changing its name/type

### Managing breaking changes

**Option 1: New topic + parallel publishing**
1. Create `orders-v2` topic
2. Publisher writes to both `orders` (v1) and `orders-v2` (v2) during transition
3. Consumers migrate to `orders-v2`
4. After all consumers are migrated, stop writing to `orders` (v1)
5. Deprecate `orders` topic after retention period

**Option 2: Schema versioning in payload + consumer branching**
1. Bump schema version field in the payload
2. Consumer detects version and applies appropriate deserialization/transformation

```go
func (c *Consumer) Handle(ctx context.Context, raw []byte) error {
    var envelope EventEnvelope
    if err := json.Unmarshal(raw, &envelope); err != nil {
        return err
    }

    switch envelope.SchemaVersion {
    case 1:
        return c.handleV1(ctx, envelope.Data)
    case 2:
        return c.handleV2(ctx, envelope.Data)
    default:
        return fmt.Errorf("unknown schema version: %d", envelope.SchemaVersion)
    }
}
```

**Option 3: Upcasting (event versioning pattern)**

Store events in their original version. When replaying, apply an upcaster that transforms old versions to the current version before the consumer sees them.

```go
// Upcaster registry
type Upcaster func(payload []byte) ([]byte, error)

var upcasters = map[string][]Upcaster{
    "OrderCreated": {
        // V1 → V2: add default currency field
        func(payload []byte) ([]byte, error) {
            var v1 OrderCreatedV1
            json.Unmarshal(payload, &v1)
            v2 := OrderCreatedV2{OrderID: v1.OrderID, UserID: v1.UserID,
                                 Total: v1.Total, Currency: "USD"}
            return json.Marshal(v2)
        },
    },
}
```

---

## Confluent Schema Registry — Practical Usage

### Registering and enforcing compatibility

```bash
# Set compatibility mode for a subject
curl -X PUT http://schema-registry:8081/config/orders-value \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "FULL"}'

# Attempt to register a new schema version
# → returns error if compatibility check fails
curl -X POST http://schema-registry:8081/subjects/orders-value/versions \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "{...avro-json...}"}'

# Check compatibility without registering
curl -X POST http://schema-registry:8081/compatibility/subjects/orders-value/versions/latest \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "{...avro-json...}"}'
# Returns: {"is_compatible": true}
```

### CI/CD integration

Add schema compatibility check as a CI gate before merging:
```yaml
# GitHub Actions example
- name: Check Avro schema compatibility
  run: |
    mvn io.confluent:kafka-schema-registry-maven-plugin:6.2.0:test-compatibility \
      -Dschema.registry.url=http://schema-registry:8081 \
      -Dschema.subject=orders-value \
      -Dschema.file=src/main/avro/OrderCreated.avsc
```

This prevents breaking schema changes from being merged.

---

## Minimum Event Envelope

Every event, regardless of format, must carry:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID/ULID | Deduplication key; idempotency |
| `source` | String URI | Trace origin to producing service |
| `type` | String | Consumer routing; human-readable event name |
| `time` | ISO 8601 UTC | Temporal ordering; audit trail |
| `schema_version` | Integer | Consumer branching on version |

Optional but recommended:
| Field | Purpose |
|-------|---------|
| `correlation_id` | Trace a request through multiple events |
| `causation_id` | ID of the event that caused this event |
| `trace_id` | OTel/Datadog trace correlation |

---

## ULID vs UUID for Event IDs

| | UUID v4 | ULID |
|--|---------|------|
| Sortable | No | Yes (time-sorted) |
| Entropy | 122 bits | 80 bits (48-bit timestamp + 80-bit random) |
| Database index performance | Poor (random inserts) | Good (monotonically increasing) |
| String length | 36 chars | 26 chars |

ULIDs are recommended for event IDs in high-throughput systems: they are sortable (useful for deduplication tables and inbox patterns), URL-safe, and index-friendly.

```go
import "github.com/oklog/ulid/v2"

eventID := ulid.Make().String()  // "01HWSZ3FYVB8MK3E7FAYH9QR1P"
```
