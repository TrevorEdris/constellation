# Refactoring Techniques

A catalog of safe, behavior-preserving transformations. Each technique includes when to apply it, a pseudocode before/after example, and a risk level.

Risk levels:
- **Low** — mechanical transformation; automated tooling can often perform it
- **Medium** — requires verifying all callers; test coverage is important
- **High** — changes interfaces or class hierarchies; requires coordinating multiple files and callers

---

## Category 1: Composing Methods

Techniques for reshaping the internal structure of methods.

### Extract Method

**Description:** Turn a cohesive block of code within a method into a new method with a descriptive name.

**When to use:** Long Method, Duplicate Code, Comments as Deodorant (replace the comment with a named method).

**Risk:** Low — the original method simply calls the new one.

```
# Before
def process_order(order):
    # validate
    if order.total <= 0:
        raise ValueError("Invalid total")
    if order.items is None:
        raise ValueError("No items")

    # apply discount
    if order.customer.is_premium:
        order.total *= 0.9

    save(order)

# After
def process_order(order):
    validate_order(order)
    apply_discount(order)
    save(order)

def validate_order(order):
    if order.total <= 0:
        raise ValueError("Invalid total")
    if order.items is None:
        raise ValueError("No items")

def apply_discount(order):
    if order.customer.is_premium:
        order.total *= 0.9
```

---

### Inline Method

**Description:** When a method body is as clear as its name, replace calls to the method with the method body and remove the method.

**When to use:** Middle Man, Lazy Class, when the extracted method no longer earns its abstraction cost.

**Risk:** Low — purely mechanical reversal of Extract Method.

```
# Before
def get_rating(driver):
    return more_than_five_late_deliveries(driver)

def more_than_five_late_deliveries(driver):
    return driver.late_deliveries > 5

# After
def get_rating(driver):
    return driver.late_deliveries > 5
```

---

### Extract Variable

**Description:** Assign a complex expression to a well-named temporary variable to make it readable.

**When to use:** Complex boolean conditions, repeated sub-expressions, magic numbers.

**Risk:** Low.

```
# Before
if (order.quantity > 100 and order.item_price > 200) or
   (order.quantity > 50 and order.item_price > 500):
    apply_large_order_discount(order)

# After
is_large_quantity = order.quantity > 100 and order.item_price > 200
is_premium_order = order.quantity > 50 and order.item_price > 500

if is_large_quantity or is_premium_order:
    apply_large_order_discount(order)
```

---

### Replace Temp with Query

**Description:** Replace a temporary variable holding the result of an expression with a method call that computes the value.

**When to use:** When the temp variable is used as an intermediate result and the expression is complex enough to name. Enables Extract Method.

**Risk:** Low — but check that the expression has no side effects.

```
# Before
def calculate_total(order):
    base_price = order.quantity * order.item_price
    if base_price > 1000:
        return base_price * 0.95
    return base_price

# After
def calculate_total(order):
    if base_price(order) > 1000:
        return base_price(order) * 0.95
    return base_price(order)

def base_price(order):
    return order.quantity * order.item_price
```

---

### Split Temporary Variable

**Description:** A temporary variable that is assigned more than once for different purposes should be split into separate variables, each with one purpose.

**When to use:** When a variable is reused with different semantic meanings.

**Risk:** Low.

```
# Before
temp = 2 * (height + width)
print(temp)
temp = height * width   # reused for a different concept
print(temp)

# After
perimeter = 2 * (height + width)
print(perimeter)
area = height * width
print(area)
```

---

## Category 2: Moving Features

Techniques for relocating methods and fields to better homes.

### Move Method

**Description:** Move a method to the class that has the most information it needs.

**When to use:** Feature Envy, when a method uses another class's data more than its own.

**Risk:** Medium — all callers of the original method must be updated.

```
# Before
class Order:
    def discount_amount(self):
        if self.customer.membership == "gold":
            return self.total * 0.1
        return self.total * 0.05

# After
class Customer:
    def discount_rate(self):
        if self.membership == "gold":
            return 0.1
        return 0.05

class Order:
    def discount_amount(self):
        return self.total * self.customer.discount_rate()
```

---

### Move Field

**Description:** Move a field to the class that uses it most.

**When to use:** When a field is accessed primarily by another class. Often accompanies Move Method.

**Risk:** Medium — update all references.

---

### Extract Class

**Description:** Create a new class and move the relevant fields and methods from the old class into it.

**When to use:** Large Class, Divergent Change, Data Clumps.

**Risk:** Medium — the new class must be wired into the original class's interface.

```
# Before
class Person:
    name: str
    office_area_code: str
    office_number: str

    def telephone_number(self):
        return f"({self.office_area_code}) {self.office_number}"

# After
class TelephoneNumber:
    area_code: str
    number: str

    def to_string(self):
        return f"({self.area_code}) {self.number}"

class Person:
    name: str
    office_telephone: TelephoneNumber
```

---

### Inline Class

**Description:** Fold a class's features into another class and delete the original.

**When to use:** Middle Man, Lazy Class — when the class no longer earns its existence.

**Risk:** Medium — reverse of Extract Class.

---

### Hide Delegate

**Description:** Create a method on a server object that hides the delegate from the client.

**When to use:** Message Chains — to stop callers from navigating through the internal structure.

**Risk:** Low — adds a wrapper method; callers updated to use it.

```
# Before
manager = person.department.manager

# After (on Person)
def manager(self):
    return self.department.manager

# Caller
manager = person.manager
```

---

### Remove Middle Man

**Description:** Have the client call the delegate directly, removing the intermediary.

**When to use:** When Hide Delegate has gone too far and the delegating class has become a passthrough with no added value.

**Risk:** Medium — all callers updated.

---

## Category 3: Organizing Data

Techniques for improving how data is structured and accessed.

### Encapsulate Field

**Description:** Make a public field private and provide accessor methods.

**When to use:** Any public field in a class — encapsulation enables future change without breaking callers.

**Risk:** Low.

```
# Before
class Person:
    name: str  # public

# After
class Person:
    _name: str

    def get_name(self):
        return self._name

    def set_name(self, name: str):
        self._name = name
```

---

### Replace Data Value with Object

**Description:** Turn a data item into an object when it needs behavior or additional data.

**When to use:** Primitive Obsession — when a primitive has validation logic, formatting, or comparison behavior that belongs to it.

**Risk:** Low to Medium — callers must use the new type.

```
# Before
class Order:
    customer_name: str

# After
class Customer:
    name: str

    def is_valid(self):
        return len(self.name) > 0

class Order:
    customer: Customer
```

---

### Introduce Parameter Object

**Description:** Replace a group of parameters that naturally belong together with a single object.

**When to use:** Long Parameter List, Data Clumps.

**Risk:** Medium — all call sites updated.

```
# Before
def find_bookings(start_date, end_date, customer_id):
    ...

# After
class DateRange:
    start: date
    end: date

def find_bookings(range: DateRange, customer_id: int):
    ...
```

---

### Preserve Whole Object

**Description:** Pass the whole object instead of extracting several values from it and passing those.

**When to use:** When a caller pulls several values from an object to pass them to a function — pass the object directly instead.

**Risk:** Low — reduces parameter count; function now takes the object as a dependency.

```
# Before
low = day_temperature_range.low
high = day_temperature_range.high
plan.within_range(low, high)

# After
plan.within_range(day_temperature_range)
```

---

## Category 4: Simplifying Conditionals

Techniques for making conditional logic clearer.

### Decompose Conditional

**Description:** Extract condition tests and branches into well-named methods.

**When to use:** Complex if/else logic where each branch is non-trivial.

**Risk:** Low.

```
# Before
if date < SUMMER_START or date > SUMMER_END:
    charge = quantity * winter_rate + winter_service_charge
else:
    charge = quantity * summer_rate

# After
def is_summer(date):
    return SUMMER_START <= date <= SUMMER_END

def winter_charge(quantity):
    return quantity * winter_rate + winter_service_charge

def summer_charge(quantity):
    return quantity * summer_rate

charge = summer_charge(quantity) if is_summer(date) else winter_charge(quantity)
```

---

### Replace Nested Conditional with Guard Clauses

**Description:** Return early for special cases to eliminate deep nesting, leaving the main path of the method unindented and clear.

**When to use:** Methods with a primary happy path buried inside nested conditionals for edge cases.

**Risk:** Low.

```
# Before
def pay_amount(employee):
    if employee.is_separated:
        result = separated_amount(employee)
    else:
        if employee.is_retired:
            result = retired_amount(employee)
        else:
            result = normal_pay_amount(employee)
    return result

# After
def pay_amount(employee):
    if employee.is_separated:
        return separated_amount(employee)
    if employee.is_retired:
        return retired_amount(employee)
    return normal_pay_amount(employee)
```

---

### Replace Conditional with Polymorphism

**Description:** Create a class hierarchy where each subclass handles one variant of the conditional logic, eliminating the conditional entirely.

**When to use:** Switch Statements, Parallel Inheritance Hierarchies — when dispatch is on a type code.

**Risk:** High — introduces a class hierarchy; requires refactoring all dispatch sites.

```
# Before
class Bird:
    type: str

    def speed(self):
        if self.type == "EUROPEAN":
            return base_speed()
        elif self.type == "AFRICAN":
            return base_speed() - load_factor() * self.number_of_coconuts
        elif self.type == "NORWEGIAN_BLUE":
            return 0 if self.is_nailed else base_speed(self.voltage)

# After
class EuropeanSwallow(Bird):
    def speed(self):
        return base_speed()

class AfricanSwallow(Bird):
    def speed(self):
        return base_speed() - load_factor() * self.number_of_coconuts

class NorwegianBlueParrot(Bird):
    def speed(self):
        return 0 if self.is_nailed else base_speed(self.voltage)
```

---

### Consolidate Conditional Expression

**Description:** Combine multiple conditionals with the same result into a single conditional with an extracted method.

**When to use:** Multiple `if` checks that all return the same value — consolidate the check.

**Risk:** Low.

```
# Before
def disability_amount(employee):
    if employee.seniority < 2:
        return 0
    if employee.months_disabled > 12:
        return 0
    if employee.is_part_time:
        return 0
    # compute disability
    ...

# After
def disability_amount(employee):
    if is_not_eligible_for_disability(employee):
        return 0
    ...

def is_not_eligible_for_disability(employee):
    return (employee.seniority < 2 or
            employee.months_disabled > 12 or
            employee.is_part_time)
```

---

## Category 5: Simplifying Method Calls

Techniques for improving the interfaces between objects.

### Rename Method

**Description:** Change the method name to better communicate its intent.

**When to use:** Whenever a method name does not clearly describe what it does.

**Risk:** Low — but must update all callers. IDE refactoring tools handle this safely.

---

### Add/Remove Parameter

**Description:** Add a parameter a method needs, or remove one it no longer uses.

**When to use:** When a method needs information it does not have, or when a parameter is never used.

**Risk:** Low to Medium — all callers must be updated.

---

### Replace Parameter with Method Call

**Description:** Remove a parameter by having the method call the computation itself.

**When to use:** When a parameter value is derived from data the method can access directly.

**Risk:** Low — simplifies call sites.

```
# Before
base_price = quantity * item_price
discount_level = retrieve_discount_level()
final_price = discounted_price(base_price, discount_level)

# After
final_price = discounted_price(quantity * item_price)

def discounted_price(base_price):
    discount_level = retrieve_discount_level()
    ...
```

---

## Category 6: Dealing with Generalization

Techniques for reorganizing inheritance hierarchies.

### Pull Up Field/Method

**Description:** Move a field or method that is duplicated in subclasses up to the superclass.

**When to use:** Duplicate Code in sibling classes.

**Risk:** Low — consolidates duplication.

---

### Push Down Field/Method

**Description:** Move behavior from a superclass down to the subclasses that use it.

**When to use:** When a field or method is only relevant to some subclasses.

**Risk:** Low.

---

### Extract Superclass

**Description:** Create a superclass and move shared features from two classes into it.

**When to use:** When two classes have similar features with no existing shared hierarchy.

**Risk:** Medium — introduces a new type in the hierarchy.

---

### Extract Interface

**Description:** Identify a subset of a class's interface and extract it into a separate interface.

**When to use:** Tight Coupling — when callers only need a subset of a class's behavior; extracting the interface lets you substitute implementations.

**Risk:** Medium — callers must be updated to use the interface type.

```
# Before
class ReportGenerator:
    def generate_pdf(self, data): ...
    def generate_csv(self, data): ...
    def send_email(self, report, recipient): ...
    def log_generation(self, report): ...

# After
class Reportable(Protocol):
    def generate_pdf(self, data): ...
    def generate_csv(self, data): ...

class ReportGenerator(Reportable):
    def generate_pdf(self, data): ...
    def generate_csv(self, data): ...
    def send_email(self, report, recipient): ...
    def log_generation(self, report): ...
```

---

### Replace Inheritance with Delegation

**Description:** Have the subclass hold an instance of the superclass and delegate to it, rather than inheriting.

**When to use:** Refused Bequest — when the subclass only uses part of the superclass's interface or inheritance creates an incorrect "is-a" relationship.

**Risk:** High — restructures the type hierarchy; callers may need interface updates.

---

## Category 7: SOLID Transformations

Targeted refactorings to enforce SOLID principles.

### Dependency Inversion (Extract Interface + Inject)

**Principle:** High-level modules should not depend on low-level modules. Both should depend on abstractions.

**When to use:** Tight Coupling — when a class directly instantiates its dependencies, making it hard to test or swap implementations.

**Risk:** Medium to High — affects constructor signatures and call sites.

```
# Before
class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()  # hard dependency

    def save_order(self, order):
        self.db.insert(order)

# After
class OrderRepository(Protocol):
    def save(self, order): ...

class PostgresOrderRepository:
    def save(self, order): ...

class OrderService:
    def __init__(self, repository: OrderRepository):
        self.repository = repository  # injected

    def save_order(self, order):
        self.repository.save(order)
```

---

### Single Responsibility (Extract Class)

**Principle:** A class should have only one reason to change.

**When to use:** Divergent Change, Large Class.

**Technique:** Extract Class — identify distinct responsibilities and split them. See Category 2 for the full technique.

---

### Open/Closed (Strategy Pattern)

**Principle:** Open for extension, closed for modification.

**When to use:** When adding new behavior requires modifying an existing class instead of extending it.

**Risk:** High — introduces a strategy interface and requires wiring.

```
# Before
class Sorter:
    def sort(self, data, algorithm):
        if algorithm == "bubble":
            ...
        elif algorithm == "quick":
            ...

# After
class BubbleSort:
    def sort(self, data): ...

class QuickSort:
    def sort(self, data): ...

class Sorter:
    def __init__(self, strategy):
        self.strategy = strategy

    def sort(self, data):
        return self.strategy.sort(data)
```

---

### Interface Segregation (Split Interface)

**Principle:** Clients should not be forced to depend on interfaces they do not use.

**When to use:** When an interface has grown to contain methods that only some implementors need.

**Risk:** Medium — splits an interface; implementors and callers must be updated.

```
# Before
class Worker(Protocol):
    def work(self): ...
    def eat(self): ...   # robots don't eat

# After
class Workable(Protocol):
    def work(self): ...

class Feedable(Protocol):
    def eat(self): ...

class HumanWorker(Workable, Feedable):
    def work(self): ...
    def eat(self): ...

class RobotWorker(Workable):
    def work(self): ...
```

---

### Liskov Substitution (Fix via Composition)

**Principle:** Subtypes must be substitutable for their base types without altering correctness.

**When to use:** Refused Bequest — when a subclass cannot honor the superclass contract.

**Technique:** Replace Inheritance with Delegation. See Category 6.
