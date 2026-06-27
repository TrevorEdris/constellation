# Defense in Depth

A bug fixed at one layer can resurface through a different code path. Defense in depth means adding validation at multiple layers so the bug is structurally impossible, not just absent from the path you tested.

---

## Why Single-Layer Validation Fails

| Scenario | How Single-Layer Fix Breaks |
|----------|----------------------------|
| Refactoring | New code path bypasses the protected function |
| Test mocks | Tests mock the fixed layer, passing bad data through anyway |
| Direct database access | Bypass scripts skip business logic validation |
| New feature | Developer not aware of the constraint writes new code without it |
| Edge case | The validation covers the known case but not a related variant |

A fix that only works because "the data always comes through this path" is fragile by design.

---

## The Four-Layer Validation Pattern

### Layer 1: Entry Point

**Purpose:** Block invalid inputs before they enter the system.

**Where:** API endpoints, message queue consumers, CLI argument parsing, file imports.

**What to validate:**
- Required fields are present
- Data types match expectations
- Values are within acceptable ranges
- Relationships are coherent (if field A is set, field B must also be set)

**Example:**
```python
# Entry point: API request handler
def create_order(request):
    if not request.items:
        raise ValidationError("Order must contain at least one item")
    for item in request.items:
        if item.quantity <= 0:
            raise ValidationError(f"Item quantity must be positive, got {item.quantity}")
        if item.unit_price is None:
            raise ValidationError(f"Item must have a unit price")
```

### Layer 2: Business Logic

**Purpose:** Enforce domain invariants that span multiple fields or require domain knowledge.

**Where:** Service classes, domain model methods, use case handlers.

**What to validate:**
- Business rules that cannot be expressed as simple field constraints
- Multi-entity relationships (order total must equal sum of line items)
- State machine transitions (cannot ship a cancelled order)
- Computed value consistency

**Example:**
```python
# Business logic layer: Order service
class OrderService:
    def generate_invoice(self, order_id):
        order = self.repository.find(order_id)

        # Enforce invariant: all line items must have pricing data
        incomplete = [i for i in order.items if i.unit_price is None]
        if incomplete:
            raise BusinessRuleViolation(
                f"Cannot generate invoice: {len(incomplete)} line items missing price data. "
                f"Item IDs: {[i.id for i in incomplete]}"
            )

        # Now safe to calculate
        return self._build_invoice(order)
```

### Layer 3: Environment Guards

**Purpose:** Detect unexpected state that your assumptions depend on.

**Where:** Function preambles, before critical operations, after external service calls.

**What to add:**
- Assertions on pre-conditions your code assumes
- Assertions on post-conditions you guarantee
- Sanity checks before irreversible operations

**Example:**
```python
# Environment guard: before processing
def process_payment(amount, currency, order_id):
    # Guard: document and enforce pre-conditions
    assert amount is not None, f"payment amount required for order {order_id}"
    assert amount > 0, f"payment amount must be positive, got {amount} for order {order_id}"
    assert currency in SUPPORTED_CURRENCIES, f"unsupported currency: {currency}"

    # Now proceed with confidence
    return payment_gateway.charge(amount, currency)
```

Remove or convert guards to proper errors before production if they affect user-facing flows. Retain them as internal assertions for developer-facing invariants.

### Layer 4: Debug Instrumentation

**Purpose:** Structured logging that makes the data flow visible without requiring a debugger.

**Where:** Component boundaries — the entry and exit of each major component.

**What to log:**
- Input to each component (key fields, not entire payloads in production)
- Output from each component
- Decisions made (which branch was taken, why)
- External service call results

**Example:**
```python
# Debug instrumentation: log at component boundaries
logger.info("invoice.generation.start", order_id=order_id, item_count=len(order.items))

result = self._calculate_totals(order)

logger.info("invoice.generation.totals",
    order_id=order_id,
    subtotal=result.subtotal,
    tax=result.tax,
    total=result.total
)
```

Structured logs make bugs visible during investigation without requiring code changes.

---

## Applying Defense in Depth

### Step 1: Trace the Data Flow

Map how the bad value travels through the system:
- What is the source of truth for this data?
- What components handle it between source and failure?
- What assumptions does each component make?

### Step 2: Map Checkpoints

Identify where each layer can add validation:
- Entry point: where does data enter the system?
- Business logic: where are domain rules enforced?
- Environment guards: where are invariants assumed?
- Instrumentation: where are boundaries between components?

### Step 3: Add Validation at Each Layer

Do not pick one. Add appropriate validation at each layer:
- Entry point: reject invalid data before it enters
- Business logic: enforce invariants in domain operations
- Guards: assert on assumptions before critical operations
- Logs: make the data flow visible

### Step 4: Test Each Layer

For each validation you add:
- Write a test that passes invalid data to that layer
- Confirm the layer rejects it with a clear error
- Confirm removing that layer's validation causes a test to fail

This documents your intent and prevents future regressions.

---

## Goal: Structural Impossibility

The test for sufficient defense in depth: after your changes, can you write code that bypasses all your validation layers and still produces the bug?

If yes: you have not achieved structural impossibility. Another code path can still trigger the bug.

If no: the bug requires a code change to reintroduce. That is defense in depth.

---

## What Defense in Depth Is Not

| Misconception | Reality |
|---------------|---------|
| "Just add null checks everywhere" | Null checks without meaning are noise; use assertions with clear messages |
| "Catch all exceptions and log them" | Swallowing exceptions hides bugs rather than preventing them |
| "More layers = better" | Duplicate validation without distinct purpose adds maintenance cost |
| "Validate in tests only" | Tests run on the happy path; production sees edge cases |

Each validation layer should serve a distinct purpose. Duplicate checks with the same logic add noise without protection.
