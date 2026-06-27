# Root Cause Tracing

Tracing a bug backward from symptom to source. The symptom is where you observe the failure. The root cause is where the failure originates. These are almost never the same place.

---

## The Five-Step Process

### Step 1: Observe the Symptom

Record the exact observable failure:
- The error message verbatim (do not paraphrase)
- The stack trace if present (every frame)
- The unexpected output (what you got vs. what you expected)
- The reproduction steps (exact, not approximate)

The symptom is your starting point, not your destination.

### Step 2: Find the Immediate Cause

Locate the code that produced the symptom:
- Follow the stack trace to the exact line
- If no stack trace: add logging at the failure point and reproduce
- Identify what condition produced the error or wrong value

The immediate cause is the first node in your trace, not the answer.

### Step 3: Ask "What Called This / Set This Value?"

For each cause you find, ask:
- What function called this function?
- What component set this value?
- What condition enabled this code path?
- Where does this data come from?

Follow the answer upstream. Repeat.

### Step 4: Keep Tracing Until You Find the Origin

You have found the root cause when:
- The input comes from an external boundary (user input, database, config, external service)
- The condition is an unvalidated assumption
- Fixing this point prevents the bug from recurring through any code path

You have NOT found the root cause when:
- Adding a null check here "fixes it" but the null should not have been possible
- Catching the exception here makes it stop crashing but does not explain why it happened
- The fix requires protecting against an invariant that should be guaranteed

### Step 5: Verify the Origin

Before declaring root cause found:
- Can you explain in one sentence what condition makes this bug structurally possible?
- Does fixing this condition prevent all manifestations of the bug, or just the one you observed?
- Is there a shorter code path that bypasses your fix and still triggers the bug?

---

## Instrumentation Patterns

When the trace is unclear, add instrumentation before hypothesizing.

### Logging at Component Boundaries

Add structured log output at the entry and exit of each component:

```python
# At the entry point of each component in the data flow
logger.debug("PaymentProcessor.charge input", amount=amount, currency=currency, order_id=order_id)

# At the exit point
logger.debug("PaymentProcessor.charge output", result=result, error=error)
```

This lets you identify exactly which boundary produces the bad value without guessing.

### Assertion-Based Tracing

Add assertions to document what you believe should be true at each point:

```python
def process_order(order):
    assert order is not None, "order must not be None at process_order entry"
    assert order.items, "order must have at least one item"
    assert order.total > 0, f"order total must be positive, got {order.total}"
    # ... rest of function
```

When an assertion fires, you have pinpointed where an invariant breaks. Remove assertions after the investigation is complete.

### Minimal Reproduction

If the bug requires a complex setup to reproduce, create the smallest possible reproduction:
1. Start with the full failing test
2. Remove components one at a time while the bug still reproduces
3. The minimal reproduction reveals which components are actually necessary

The minimal reproduction is often illuminating on its own.

---

## Fix at Source, Not at Symptom

| Approach | Description | Problem |
|----------|-------------|---------|
| Fix at symptom | Add null check where NPE occurs | Bug recurs via different code path |
| Fix at immediate cause | Validate input to the failing function | Bug recurs from different caller |
| Fix at root cause | Prevent the invalid state from being created | Bug cannot recur structurally |

**The test:** After your fix, ask "is there another code path that can still produce the invalid state?" If yes, you fixed a symptom, not the root cause.

---

## Worked Example: Multi-Layer System

**Symptom:** `NullPointerException: Cannot invoke method 'multiply' on null object` in `InvoiceService.calculateTax()`

**Stack trace:**
```
InvoiceService.calculateTax(InvoiceService.java:142)
InvoiceService.generateInvoice(InvoiceService.java:87)
InvoiceController.createInvoice(InvoiceController.java:34)
```

**Step 1: Observe**
- NPE at line 142 of InvoiceService
- `calculateTax()` is called from `generateInvoice()` at line 87
- `generateInvoice()` is called from the controller at line 34

**Step 2: Find immediate cause**
Reading line 142: `BigDecimal tax = lineItem.getPrice().multiply(taxRate);`
- `lineItem.getPrice()` returns null
- Immediate cause: `getPrice()` returns null for some line items

**Step 3: Trace upstream**
- Where does the line item come from? `generateInvoice()` fetches them from `OrderRepository.findLineItems(orderId)`
- Where does the repository get prices? From the `order_line_items` database table, column `unit_price`
- Are there rows where `unit_price` is null? Query the database: YES — rows created before a schema migration 6 months ago have null `unit_price`

**Step 4: Find origin**
The migration added the `unit_price` column without backfilling historical rows. The ORM maps null database columns to null Java objects. No validation exists when line items are created or when invoices are generated.

**Root cause:** The migration omitted a data backfill, and no validation layer prevents invoice generation for orders with incomplete pricing data.

**Step 5: Verify**
Fix at root cause: Add a validation check in `OrderRepository.findLineItems()` that throws a meaningful exception for line items with null prices, AND add a data migration to backfill or mark historical records. A null check in `calculateTax()` alone would hide the data integrity problem.

---

## Common Tracing Mistakes

| Mistake | Why It Fails |
|---------|-------------|
| Stopping at the first fixable point | Often a symptom layer, not the source |
| Adding null checks without asking why null is possible | Hides data integrity problems |
| Tracing in the wrong direction (forward from suspected cause) | Confirmation bias — traces what you expect to find |
| Skipping layers because "that code is fine" | Assumptions are where bugs hide |
| Assuming the test is testing what you think | Mocks can bypass the layer where the bug originates |
