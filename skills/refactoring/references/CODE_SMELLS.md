# Code Smell Catalog

A code smell is a surface indicator that usually corresponds to a deeper problem. Smells are not bugs — the code may work correctly — but they signal structural issues that increase future change cost. Each entry below includes detection indicators, impact, and the primary refactoring technique to address it.

---

## Category 1: Bloaters

Bloaters are code elements that have grown so large they become difficult to work with. They usually accumulate over time.

### Long Method

**Description:** A function or method that is too long to read, understand, or test as a unit. A common heuristic: if you need to scroll to see the whole function, it's too long. Aim for functions that fit on one screen (20-40 lines at most).

**Detection indicators:**
- Method body exceeds 40 lines
- Method has more than one level of abstraction (setup, logic, and formatting all mixed)
- The method name cannot capture everything it does
- You need comments to explain sections of the method body

**Impact:** Difficult to test (requires complex setup for a single assertion), hard to name accurately, resists reuse, increases merge conflict surface.

**Primary technique:** Extract Method — identify cohesive blocks and extract each into a well-named function.

---

### Large Class

**Description:** A class that has accumulated too many fields, methods, or responsibilities. Often signals a violation of the Single Responsibility Principle.

**Detection indicators:**
- Class has more than ~10 fields
- Class has more than ~20 methods
- You need a table of contents comment at the top of the class
- Different parts of the class are used by different callers with no overlap

**Impact:** High coupling, low cohesion. Adding a feature risks breaking unrelated functionality. Testing requires instantiating the entire class.

**Primary technique:** Extract Class — identify distinct responsibilities and split them into focused classes. Extract Subclass if the variation is type-based.

---

### Long Parameter List

**Description:** A function that accepts more than 3-4 parameters. Often a sign that the function has too many responsibilities or that a missing domain object has not been modeled.

**Detection indicators:**
- Function signature wraps across multiple lines in most editors
- Parameters are frequently passed together by callers
- Some parameters are only relevant in specific code paths

**Impact:** Call sites are fragile — adding a parameter requires changing every caller. Parameter order errors are silent bugs. Readability at call sites degrades.

**Primary technique:** Introduce Parameter Object — group related parameters into a named data object. Preserve Whole Object if the parameters already come from an existing object.

---

### Primitive Obsession

**Description:** Using raw primitive types (strings, ints, booleans) to represent domain concepts that deserve their own type.

**Detection indicators:**
- Strings used to represent enumerable states (e.g., `"active"`, `"pending"`, `"cancelled"`)
- Ints used without units (is this a price in cents? milliseconds? seconds?)
- Validation logic for the same primitive repeated in multiple places
- Parameter names needed to distinguish primitives of the same type (`userId`, `orderId` as plain `int`)

**Impact:** Validation is scattered. Type confusion bugs are easy to introduce. Domain intent is hidden.

**Primary technique:** Replace Primitive with Object — introduce a domain type (e.g., `Money`, `UserId`, `OrderStatus`) that encapsulates the primitive and its validation.

---

### Data Clumps

**Description:** Groups of data items that always appear together — passed as parameters together, stored as fields together, or accessed together. The group deserves to be a named abstraction.

**Detection indicators:**
- Three or more fields/parameters that appear together in multiple method signatures
- Removing one field from the group causes the other fields to become meaningless
- The same group is validated in multiple places

**Impact:** Duplicated structure. Missing the opportunity to attach behavior (validation, formatting) to the natural grouping.

**Primary technique:** Introduce Parameter Object or Extract Class to give the group a name and a home.

---

## Category 2: Object-Orientation Abusers

These smells arise from incomplete or incorrect application of OO principles.

### Switch Statements

**Description:** Repeated `switch` or `if/else if` chains that dispatch on a type code or flag. The same dispatch logic duplicated in multiple places.

**Detection indicators:**
- The same `switch` on a type field appears in multiple methods or classes
- Adding a new case requires finding and updating every switch
- The switch is on a field that could be a class hierarchy

**Impact:** Shotgun surgery — adding a new type means touching every switch statement. Logic for each type is scattered.

**Primary technique:** Replace Conditional with Polymorphism — convert the type code to a class hierarchy where each subclass implements the variant behavior. Replace Type Code with Subclasses if the class itself is what varies.

---

### Parallel Inheritance Hierarchies

**Description:** A special case of Shotgun Surgery. Every time you create a subclass in one hierarchy, you must create a corresponding subclass in another.

**Detection indicators:**
- Two class hierarchies where adding a leaf to one requires adding a leaf to the other
- Class names in one hierarchy mirror names in the other

**Impact:** Double the maintenance burden for every new variant.

**Primary technique:** Move Method and Move Field to eliminate duplication by having one hierarchy reference the other rather than mirroring it.

---

### Refused Bequest

**Description:** A subclass inherits methods or data from its parent but does not use them — or actively overrides them to throw exceptions. The inheritance hierarchy is wrong.

**Detection indicators:**
- Subclass overrides methods to do nothing or throw `UnsupportedOperationException`
- Subclass only uses a small fraction of inherited interface
- Callers must check the concrete type before using the inherited interface

**Impact:** Liskov Substitution Principle violation. Callers cannot rely on the interface contract.

**Primary technique:** Replace Inheritance with Delegation — the subclass should hold a reference to the parent-type behavior it needs rather than inheriting everything.

---

### Temporary Field

**Description:** An instance field that is only set (and meaningful) during certain operations or code paths. The object appears in an inconsistent state at other times.

**Detection indicators:**
- Fields that are `null` or empty most of the time
- Fields that are only set inside one method and read inside another
- Comments explaining when a field is "valid"

**Impact:** Object lifecycle is unclear. Null checks proliferate. Class invariants cannot be stated simply.

**Primary technique:** Extract Class — group the temporary fields and the methods that use them into a separate class that is only instantiated when that data is relevant.

---

## Category 3: Change Preventers

These smells make a single logical change require edits in many places.

### Divergent Change

**Description:** A class is changed for more than one reason. Making different kinds of changes (e.g., persistence changes vs. business rule changes) both require editing the same class.

**Detection indicators:**
- "When we change X, we always edit this file for Y reasons"
- The class has methods that fall into clearly distinct groups with no overlap
- Commits touching this file have unrelated commit messages

**Impact:** Unrelated changes are coupled. A change for one reason risks breaking another concern.

**Primary technique:** Extract Class — split the class along the axis of change so each class has exactly one reason to change.

---

### Shotgun Surgery

**Description:** A single logical change requires edits scattered across many classes. The inverse of Divergent Change.

**Detection indicators:**
- "Changing X requires updating 5 different files"
- Related logic is spread across many small classes
- A single conceptual change produces a large, scattered diff

**Impact:** Easy to forget one of the required edit sites. Increases risk of inconsistency.

**Primary technique:** Move Method and Move Field to consolidate related behavior into one place. Inline Class if the scattered pieces are small enough to merge.

---

### Feature Envy

**Description:** A method that uses the data of another class more than its own class's data. The method "envies" the other class and probably belongs there.

**Detection indicators:**
- Method calls several getters on another object to compute something
- Method accesses another object's fields more than its own
- You need to pass an object in and access its internals

**Impact:** Increases coupling between classes. Logic that belongs to a domain concept is placed elsewhere, making it harder to find and maintain.

**Primary technique:** Move Method — move the method to the class whose data it uses. If only part of the method envies the other class, use Extract Method first, then Move Method.

---

## Category 4: Dispensables

Things that are unnecessary and whose absence would make the code cleaner.

### Dead Code

**Description:** Code that is never executed — unreachable branches, unused variables, unused functions, unused exports.

**Detection indicators:**
- Unreachable code after a `return` or `throw`
- Variables assigned but never read
- Functions/methods never called from outside tests
- Exported symbols never imported by any consumer

**Impact:** Readers waste time understanding code that has no effect. The presence of dead code signals incomplete cleanup and erodes confidence.

**Primary technique:** Safe Delete — remove the dead code. Use language tooling (see `DETECTION_TOOLS.md`) to identify unused symbols before deleting.

---

### Lazy Class

**Description:** A class that does so little that it doesn't justify the overhead of its existence. Often the remnant of a refactoring that moved most of its functionality elsewhere.

**Detection indicators:**
- Class has fewer than 3 meaningful methods
- Class exists only to hold one field or delegate to one other class
- The class name describes a concept that isn't meaningfully distinct from its caller

**Impact:** Unnecessary indirection. Readers must navigate to a class that adds nothing.

**Primary technique:** Inline Class — merge the lazy class into its primary caller if the concept is not valuable on its own.

---

### Speculative Generality

**Description:** Code written for future requirements that don't currently exist. Hooks, parameters, and abstract layers added "just in case."

**Detection indicators:**
- Abstract base classes with only one concrete implementation
- Method parameters that are always passed the same value
- Configuration points with only one valid configuration
- Comments like "// we might need this later"

**Impact:** Complexity without benefit. Future maintainers must understand the abstraction to determine if it's actually needed.

**Primary technique:** Collapse Hierarchy if the abstraction has only one implementation. Remove the unused parameter or configuration option. YAGNI — you aren't gonna need it.

---

### Duplicate Code

**Description:** The same or structurally similar code appears in multiple locations. The most common smell and one of the most costly.

**Detection indicators:**
- Copy-pasted logic with minor variations
- The same algorithm appears in sibling classes
- Changing a business rule requires editing multiple files

**Impact:** Bug fixes and requirement changes must be applied to every copy. Copies diverge over time as some are updated and others are not.

**Primary technique:** Extract Method and move to a shared location. Pull Up Method if the duplication is in sibling classes. Form Template Method if the structure is the same but steps differ.

---

### Comments as Deodorant

**Description:** Comments that exist to explain confusing code rather than to document intent, trade-offs, or non-obvious domain knowledge.

**Detection indicators:**
- Block comments before each section of a long method explaining what the section does
- Comments explaining variable names that should be self-explanatory
- Comments that restate what the code already says clearly

**Impact:** The comment is a sign the code needs refactoring, not documentation. Comments go stale; code doesn't lie.

**Primary technique:** Extract Method with a descriptive name that replaces the comment. Rename Variable or Rename Method to make the code self-documenting.

---

## Category 5: Couplers

These smells indicate excessive coupling between classes.

### Inappropriate Intimacy

**Description:** A class that accesses another class's private fields or internal implementation details directly.

**Detection indicators:**
- Accessing fields via reflection or direct field access instead of methods
- A class knows which concrete type is behind an interface and casts to it
- One class relies on implementation details that are not part of the other's public contract

**Impact:** Changes to the internal implementation of one class break the other. The encapsulation boundary is meaningless.

**Primary technique:** Move Method and Move Field to put behavior closer to the data it uses. Extract Class to give the shared internals a proper home.

---

### Message Chains

**Description:** A sequence of method calls chained together: `order.getCustomer().getAddress().getCity()`. Each step navigates deeper into an object graph.

**Detection indicators:**
- Long chains of `.get()` calls
- Code that navigates through several layers of ownership to retrieve a value
- The caller knows the internal structure of objects it doesn't own

**Impact:** The caller is tightly coupled to the structure of the entire chain. Changing any step in the chain breaks the caller.

**Primary technique:** Hide Delegate — introduce a method on the first object in the chain that returns the needed value, hiding the internal navigation. Or Extract Method to encapsulate the chain where it's used.

---

### Middle Man

**Description:** A class that delegates most of its work to another class and adds little or no value of its own.

**Detection indicators:**
- More than half the class's methods just call the same method on a delegate
- The class has no fields of its own beyond the delegate reference
- Removing the class and calling the delegate directly would lose nothing

**Impact:** Pointless indirection. Readers must navigate through an extra layer.

**Primary technique:** Remove Middle Man — have callers call the delegate directly. Or Inline Class if the middle man has any value worth absorbing into the caller.

---

### Incomplete Library Class

**Description:** A library or framework class that almost does what you need, but requires workarounds or supplemental code scattered everywhere it's used.

**Detection indicators:**
- The same extension logic for a library type repeated in multiple places
- Helper utilities that only exist to compensate for a library's missing feature
- Wrappers that always accompany a library type

**Impact:** Duplicated workaround code that must be maintained in lockstep.

**Primary technique:** Introduce Extension Methods (language permitting) or Extract Class to centralize the workaround in one adapter class.
