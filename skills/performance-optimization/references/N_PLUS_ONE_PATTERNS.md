# N+1 Query Detection Patterns

## What Is N+1?

An N+1 query problem occurs when code loads a list of N records, then issues a separate query for each record to fetch related data — resulting in N+1 total queries instead of 1 or 2.

```
Request arrives
  → Query 1: SELECT * FROM orders          -- fetch 100 orders
  → Query 2: SELECT * FROM users WHERE id=1
  → Query 3: SELECT * FROM users WHERE id=2
  → ...
  → Query 101: SELECT * FROM users WHERE id=100
```

At 100 orders, this is 101 queries. At 10,000 orders, it is 10,001 queries. Latency scales linearly with dataset size.

---

## Detection Patterns by Framework

### Django ORM (Python)

**Safe patterns:**
```python
# FK / OneToOne: use select_related (SQL JOIN)
orders = Order.objects.select_related('customer').all()

# M2M / reverse FK: use prefetch_related (separate IN query)
orders = Order.objects.prefetch_related('items').all()

# Nested relations
orders = Order.objects.select_related('customer__address').prefetch_related('items__product')
```

**Danger patterns to grep for:**
```
# Accessing FK attribute in a loop without select_related
\.objects\.all\(\)
\.objects\.filter\(

# Then in iteration:
for order in orders:
    print(order.customer.name)   # N queries if not select_related
    for item in order.items.all():  # N queries if not prefetch_related
```

**Detection grep patterns:**
```bash
# Find queryset followed by attribute access in loops
grep -n "\.objects\." src/ -r --include="*.py"
# Then manually verify if the loop body accesses FK fields without prefetch
```

**Diagnostic:** Enable Django query logging:
```python
import logging
logging.getLogger('django.db.backends').setLevel(logging.DEBUG)
```

---

### SQLAlchemy (Python)

**Safe patterns:**
```python
from sqlalchemy.orm import joinedload, subqueryload, selectinload

# joinedload: SQL JOIN (good for single FK, bad for collections — cartesian product risk)
stmt = select(Order).options(joinedload(Order.customer))

# selectinload: separate SELECT...WHERE id IN (...) — preferred for collections
stmt = select(Order).options(selectinload(Order.items))

# subqueryload: subquery approach (older, selectinload preferred in modern SQLAlchemy)
stmt = select(Order).options(subqueryload(Order.items))
```

**Danger patterns:**
```python
# relationship() with default lazy loading
class Order(Base):
    customer = relationship("Customer")  # lazy="select" by default — N+1 risk

# Accessing relationship in a loop
for order in session.execute(select(Order)).scalars():
    print(order.customer.name)  # triggers query per iteration
```

**Detection grep patterns:**
```bash
# Find relationships without explicit lazy strategy
grep -n "relationship(" src/ -r --include="*.py"
# Flag any without lazy= or with lazy="select" (default)
```

---

### ActiveRecord (Ruby on Rails)

**Safe patterns:**
```ruby
# includes: uses separate query or JOIN depending on conditions
orders = Order.includes(:customer)
orders = Order.includes(:customer, items: :product)

# eager_load: forces LEFT OUTER JOIN (use when filtering on association)
orders = Order.eager_load(:customer).where(customers: { active: true })

# preload: always separate query (predictable, no JOIN)
orders = Order.preload(:items)
```

**Danger patterns:**
```ruby
# .each accessing association without includes
Order.all.each do |order|
  puts order.customer.name     # N+1 if not included
  order.items.each do |item|   # N+1 if not included
    puts item.product.name     # N+1 if not included
  end
end
```

**Detection:** Use the `bullet` gem in development:
```ruby
# Gemfile
group :development do
  gem 'bullet'
end

# config/environments/development.rb
config.after_initialize do
  Bullet.enable = true
  Bullet.alert = true
  Bullet.rails_logger = true
end
```

**Diagnostic grep:**
```bash
grep -n "\.each\|\.map\|\.each_with_object" app/ -r --include="*.rb"
# Review loop bodies for association access without includes
```

---

### TypeORM (TypeScript/Node.js)

**Safe patterns:**
```typescript
// Eager loading via find options
const orders = await orderRepo.find({
  relations: ['customer', 'items', 'items.product'],
});

// Query builder with explicit joins
const orders = await orderRepo
  .createQueryBuilder('order')
  .leftJoinAndSelect('order.customer', 'customer')
  .leftJoinAndSelect('order.items', 'item')
  .getMany();
```

**Danger patterns:**
```typescript
// find() without relations, then accessing in loop
const orders = await orderRepo.find();
for (const order of orders) {
  const customer = await customerRepo.findOneBy({ id: order.customerId }); // N+1
  console.log(customer.name);
}

// Entity relations defined as lazy (Promise) accessed in loop
@Entity()
class Order {
  @ManyToOne(() => Customer, { lazy: true })
  customer: Promise<Customer>;  // await customer inside loop = N+1
}
```

**Detection grep:**
```bash
grep -n "findOneBy\|findOne\b" src/ -r --include="*.ts"
# Flag any inside loops or async iterations
grep -n "\.find()" src/ -r --include="*.ts"
# Check if relations option is present
```

---

### Prisma (TypeScript/Node.js)

**Safe patterns:**
```typescript
// include for eager loading
const orders = await prisma.order.findMany({
  include: {
    customer: true,
    items: {
      include: { product: true },
    },
  },
});

// select for specific fields (more efficient than include when you don't need all columns)
const orders = await prisma.order.findMany({
  select: {
    id: true,
    customer: { select: { name: true, email: true } },
  },
});
```

**Danger patterns:**
```typescript
// findMany without include, then querying in loop
const orders = await prisma.order.findMany();
for (const order of orders) {
  const customer = await prisma.customer.findUnique({  // N+1
    where: { id: order.customerId },
  });
}
```

**Detection grep:**
```bash
grep -n "prisma\.\w\+\.find" src/ -r --include="*.ts"
# For each findMany/findFirst, check if include or select covers related models
# Flag any prisma queries inside for...of, forEach, map, etc.
grep -n "for.*of\|\.forEach\|\.map" src/ -r --include="*.ts" -A 5
# Look for prisma calls in the following lines
```

---

### Go (database/sql)

Go has no ORM eager loading — N+1 must be prevented manually.

**Safe patterns:**
```go
// Batch fetch with IN clause
rows, err := db.Query(`
    SELECT o.id, o.amount, c.name
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ANY($1)`, pq.Array(orderIDs))

// Or: fetch related IDs, then batch query
customerIDs := extractCustomerIDs(orders)
customers, err := fetchCustomersByIDs(db, customerIDs)  // single IN query
customerMap := indexByID(customers)
```

**Danger patterns:**
```go
rows, err := db.Query("SELECT * FROM orders")
for rows.Next() {
    var order Order
    rows.Scan(&order.ID, &order.CustomerID)

    // N+1: query inside rows.Next() loop
    var customer Customer
    db.QueryRow("SELECT * FROM customers WHERE id = $1", order.CustomerID).
        Scan(&customer.ID, &customer.Name)
}
```

**Detection grep:**
```bash
# Find db.Query or db.QueryRow calls inside scan loops
grep -n "rows.Next()" . -r --include="*.go" -A 10 | grep -E "Query|QueryRow"
```

---

### GraphQL (DataLoader Pattern)

In GraphQL, N+1 occurs when resolvers make individual database calls per field on a list type.

**Danger pattern:**
```javascript
// Each resolver fetches independently — 1 query per user in a list
const resolvers = {
  Post: {
    author: async (post) => {
      return await db.user.findById(post.authorId);  // N queries for N posts
    },
  },
};
```

**Safe pattern — DataLoader:**
```javascript
import DataLoader from 'dataloader';

// Batch function: receives array of IDs, returns array of results in same order
const userLoader = new DataLoader(async (userIds) => {
  const users = await db.user.findMany({ where: { id: { in: userIds } } });
  const userMap = new Map(users.map(u => [u.id, u]));
  return userIds.map(id => userMap.get(id));  // preserve order
});

const resolvers = {
  Post: {
    author: (post) => userLoader.load(post.authorId),  // batched automatically
  },
};
```

**DataLoader requirements:**
- One DataLoader instance per request (not global — avoid cross-request data leaks).
- Batch function must return results in the same order as input keys.
- Use `loadMany` for pre-fetching known IDs.

**Detection grep:**
```bash
# Find resolvers accessing DB without DataLoader
grep -n "findById\|findOne\|findUnique" src/ -r --include="*.{js,ts}"
# Flag any inside resolver functions that are called per-field (not per-query)
```

---

## SQL-Level Detection

When framework-level analysis is insufficient, detect N+1 at the database level.

**Enable query logging:**
- PostgreSQL: `log_min_duration_statement = 0` (log all), then grep for repeated patterns
- MySQL: `SET GLOBAL general_log = 'ON';`
- SQLite: `PRAGMA data_version;` won't help — use application-level logging

**pg_stat_statements (PostgreSQL):**
```sql
SELECT query, calls, total_exec_time, rows
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```
Look for queries with identical structure but very high `calls` relative to request volume.

**Count queries per request:**
- Add request-scoped query counter middleware.
- Threshold: >10 queries per endpoint warrants investigation; >50 is a strong signal.

**Application-level logging:**
```python
# Django: count queries in a test
from django.test.utils import CaptureQueriesContext
with CaptureQueriesContext(connection) as ctx:
    response = client.get('/api/orders/')
assert len(ctx) < 5, f"Too many queries: {len(ctx)}"
```

---

## Fix Patterns Summary

| Situation | Fix |
|-----------|-----|
| ORM FK access in loop | Eager load (JOIN / `select_related` / `include`) |
| ORM collection access in loop | Prefetch / `prefetch_related` / `selectinload` |
| Manual DB query in loop | Batch with IN clause + map by ID |
| GraphQL resolver per-field DB call | DataLoader with batch function |
| Multiple sequential API calls | Batch endpoint or aggregation layer |
| JOIN causing cartesian product on collections | Use separate query (subquery load / prefetch) |
