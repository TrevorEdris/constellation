# Migration Patterns Reference

Strategies for safely migrating from legacy systems, decomposing monoliths, and managing feature activation.

---

## Strangler Fig

### Concept

Gradually replace a legacy system by routing traffic through a facade layer. New functionality is built behind the facade; the facade routes each request to either the new or legacy handler. As new handlers are added, the legacy system handles fewer and fewer requests. When all routes are ported, the legacy system is removed.

Named after the strangler fig tree, which grows around a host tree and eventually replaces it.

### Implementation

**Step 1: Introduce the facade**

Add an API gateway, reverse proxy (nginx), or adapter service in front of the legacy system. All traffic flows through the facade. At this point, the facade passes everything to legacy — no change in behavior.

```nginx
# Initial: all traffic to legacy
location / {
    proxy_pass http://legacy-service;
}
```

**Step 2: Route new endpoints to new service**

As new capabilities are implemented, route their paths to the new service:

```nginx
location /api/v2/orders {
    proxy_pass http://new-order-service;
}
location /api/v2/users {
    proxy_pass http://new-user-service;
}
location / {
    proxy_pass http://legacy-service;  # everything else
}
```

**Step 3: Migrate existing endpoints**

For each existing legacy endpoint:
1. Implement the behavior in the new service
2. Deploy the new service
3. Update the facade route
4. Verify traffic and logs — roll back if errors appear
5. Remove the legacy handler (do not keep dead code)

**Step 4: Remove the legacy system**

When the facade routes zero traffic to legacy, decommission it.

### Anti-corruption layer (ACL)

The facade must translate between the legacy data model and the new domain model. This translation layer is the ACL.

Without ACL: legacy concepts (e.g., `CUSTOMER_ACCT_NUM`) leak into the new system.
With ACL: the new system uses clean domain concepts (`customer_id`); the ACL translates at the boundary.

```go
// ACL: translate legacy response to domain model
func translateLegacyOrder(legacy *legacyapi.OrderResponse) *domain.Order {
    return &domain.Order{
        ID:         domain.OrderID(legacy.ORDER_REF_NUM),
        CustomerID: domain.CustomerID(legacy.CUSTOMER_ACCT_NUM),
        Total:      domain.Money{Amount: legacy.TOT_AMT, Currency: "USD"},
        Status:     translateLegacyStatus(legacy.ORDER_STATUS_CD),
    }
}
```

### Key principles

- Never modify the legacy system to accommodate the new one — the legacy system is being replaced
- Each migration step must be individually deployable and rollback-capable
- Maintain parallel operation: both systems running during migration; traffic comparison useful for validation
- Data migration is the hardest part — plan it separately; consider dual-write or CDC-based sync

---

## Feature Flags

### Purpose

Decouple code deployment from feature activation. New code can be deployed to production without users seeing it. Features can be activated gradually, by segment, or rolled back instantly without redeployment.

### Use cases

| Pattern | Description |
|---------|-------------|
| **Kill switch** | Disable a broken feature in production without a deployment |
| **Gradual rollout** | 1% → 10% → 50% → 100% of users see new behavior; ramp up as confidence grows |
| **A/B test gate** | Different users see different variants; measure outcome |
| **Beta cohort** | Specific users/tenants get early access |
| **Staff testing** | Internal users see feature before public launch |
| **Maintenance mode** | Disable a feature while its backing service undergoes maintenance |

### Technology options

| Tool | Type | Notes |
|------|------|-------|
| LaunchDarkly | SaaS | Full-featured; streaming SDK; analytics built-in; expensive |
| Unleash | Open source / SaaS | Self-hostable; feature-rich; good SDK ecosystem |
| Flipt | Open source | Kubernetes-native; gRPC API; self-hosted |
| Flagr (Etsy) | Open source | Simple; REST API; good for custom integrations |
| Custom (Redis-backed) | DIY | Simple boolean flags in Redis; minimal overhead; no UI |
| Config in DB | DIY | `feature_flags` table; simple; no real-time propagation |

### Implementation patterns

**Simple boolean flag (custom):**
```go
func isFeatureEnabled(ctx context.Context, flag string, userID string) bool {
    // Check Redis for flag config
    val, err := redis.HGet(ctx, "feature_flags:"+flag, "enabled").Bool()
    if err != nil {
        return false  // fail closed (off) on error
    }
    return val
}
```

**Percentage rollout:**
```go
func isInRollout(flag string, userID string, percent int) bool {
    // Deterministic: same user always gets same result for same flag
    hash := fnv.New32a()
    hash.Write([]byte(flag + ":" + userID))
    return int(hash.Sum32()%100) < percent
}
```

**Rule:** always fail closed — if flag evaluation fails, return the conservative default (feature off).

### Flag hygiene

- Every flag must have an owner and an expiry target date
- Create a ticket to remove each flag when rollout is complete
- Orphaned flags are technical debt and create unpredictable behavior
- Flag names should be positive: `new_checkout_flow` not `disable_old_checkout`
- Never nest flag checks: `if flag_a && flag_b` → impossible to understand which combination is active

### Testing with feature flags

- Unit tests should test both flag=on and flag=off behavior
- Integration tests should cover the flag evaluation path
- In CI: set flags explicitly; do not rely on default values

---

## Saga Pattern

### Problem

A business operation spans multiple services and must appear atomic. Example: "place an order" requires inventory reservation, payment charge, and shipment scheduling — all must succeed or all must be rolled back.

Traditional distributed transactions (2PC) are too slow and fragile for microservices.

### Solution: saga

Break the operation into a sequence of local transactions, each with a corresponding compensating transaction that reverses it.

```
Forward steps:
  1. ReserveInventory     → compensate: ReleaseInventory
  2. ChargePayment        → compensate: RefundPayment
  3. ScheduleShipment     → compensate: CancelShipment

On failure at step 2 (ChargePayment):
  Execute compensations in reverse:
  1'. ReleaseInventory    (compensation for step 1)
```

### Choreography saga

Services communicate via events. No central coordinator.

```
OrderService          → emits: OrderCreated
InventoryService      → listens: OrderCreated → reserves inventory → emits: InventoryReserved
PaymentService        → listens: InventoryReserved → charges payment → emits: PaymentCharged
ShipmentService       → listens: PaymentCharged → schedules shipment → emits: OrderFulfilled

On InventoryService failure:
InventoryService      → emits: InventoryReservationFailed
OrderService          → listens: InventoryReservationFailed → cancels order → emits: OrderCancelled
```

**Pros:** loose coupling; each service is autonomous; no SPOF coordinator.

**Cons:** hard to trace the full saga state; debugging requires correlating events across services; business logic is spread across many services.

### Orchestration saga

A central coordinator (orchestrator) explicitly tells each service what to do next.

```
SagaOrchestrator:
  1. Tell InventoryService: ReserveInventory
  2. If success: Tell PaymentService: ChargePayment
  3. If success: Tell ShipmentService: ScheduleShipment
  4. On any failure: Tell completed services to run compensations in reverse
```

**Pros:** saga state is centralized and easy to inspect; business flow is explicit in one place; easier to debug.

**Cons:** orchestrator is a SPOF (mitigated by making it durable — Temporal, Conductor); orchestrator has knowledge of all services (coupling).

### Temporal (recommended orchestration framework)

Temporal provides durable execution — the orchestrator's state survives crashes.

```go
func OrderFulfillmentWorkflow(ctx workflow.Context, orderID string) error {
    // Each activity is retried automatically; workflow state is persisted
    if err := workflow.ExecuteActivity(ctx, ReserveInventory, orderID).Get(ctx, nil); err != nil {
        return err
    }
    if err := workflow.ExecuteActivity(ctx, ChargePayment, orderID).Get(ctx, nil); err != nil {
        // Temporal compensates automatically via configured rollback activity
        workflow.ExecuteActivity(ctx, ReleaseInventory, orderID)
        return err
    }
    return workflow.ExecuteActivity(ctx, ScheduleShipment, orderID).Get(ctx, nil)
}
```

### Choosing choreography vs orchestration

| Factor | Choreography | Orchestration |
|--------|-------------|--------------|
| Number of steps | ≤ 3 | > 3 |
| Traceability needed | Low | High |
| Team coupling tolerance | High | Low |
| Existing Kafka/event infrastructure | Preferred | Either |
| Complex branching / conditional flows | Hard | Easy |

---

## Anti-Corruption Layer (ACL)

The ACL is a translation boundary between two systems with different domain models. It prevents a legacy or external system's concepts from leaking into the new system's domain.

### When to implement

- Integrating with a third-party API (different concepts, naming, data formats)
- Calling into a legacy system from a new service
- Wrapping an external service to isolate the new domain from its constraints

### Structure

```
New Service Domain Layer
       ↕
   ACL Layer          ← translation happens here
       ↕
External / Legacy System
```

The ACL:
- Translates data types and naming conventions
- Handles version differences in the external API
- Absorbs external model changes so the domain layer remains stable
- Contains all knowledge of the external system's quirks

### Hexagonal architecture alignment

ACLs naturally fit as adapters in hexagonal (ports and adapters) architecture:
- Port: the domain's abstract interface (`OrderRepository`, `PaymentGateway`)
- Adapter: the ACL implementing the port using the external system's API
- Domain: has no knowledge of the external system
