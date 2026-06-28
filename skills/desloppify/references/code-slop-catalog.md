# Code Slop Catalog

AI tools produce characteristic noise patterns in code. This catalog covers two categories: comment slop (noise in comments/docstrings) and code pattern slop (noise in the code itself).

---

## Comment Slop

### 1. Narrator Comments

**What:** Comments that restate the function/method name or describe what the code obviously does.

**Detection:**
- Pattern: `// This (function|method|class|module) (handles|processes|manages|performs|is responsible for|takes care of|deals with)`
- Pattern: `// (Handle|Process|Manage|Perform) the ...`
- Comment restates the function name in sentence form

**Severity:** CRITICAL

**Example:**
```typescript
// This function processes the user request
function processUserRequest(req: Request) { ... }
```

**Fix:** Delete the comment. The function name already says this.

---

### 2. Step Comments

**What:** Procedural narration that labels each step of a function like an instruction manual.

**Detection:**
- Pattern: `// Step \d+:`
- Pattern: `// (First|Second|Third|Then|Next|Finally|Lastly),`
- Sequential numbered comments inside a short function

**Severity:** HIGH

**Example:**
```typescript
function createUser(data: UserInput) {
  // Step 1: Validate the input
  validate(data);
  // Step 2: Hash the password
  const hash = hashPassword(data.password);
  // Step 3: Save to database
  return db.users.create({ ...data, password: hash });
}
```

**Fix:** Delete all step comments. The code reads clearly without them. If the function needs explanation, one comment at the top explaining *why* (not *what*) is sufficient.

---

### 3. Obvious Comments

**What:** Comments that restate the code on the next line in English.

**Detection:**
- Comment describes a single-line operation that is self-evident
- Comment uses the same words as the variable/function names below it
- Comment explains basic language syntax

**Severity:** CRITICAL

**Example:**
```typescript
// Initialize the counter
let counter = 0;

// Increment the counter
counter++;

// Return the result
return result;
```

**Fix:** Delete all three comments.

---

### 4. Section Dividers

**What:** Visual separator comments that add clutter without semantic value.

**Detection:**
- Pattern: `// [=\-*#]{3,}`
- Pattern: `// ----- .+ -----`
- Pattern: `/* ========== */`
- Decorative borders around section headers

**Severity:** HIGH

**Example:**
```typescript
// ========================
// USER AUTHENTICATION
// ========================
```

**Fix:** Delete the dividers. If the file needs sections, the code structure (classes, modules, named functions) should provide that organization. If it doesn't, refactor the file.

---

### 5. Over-Documented Trivials

**What:** Multi-line JSDoc/docstrings on getters, setters, or simple accessor methods where the type signature says everything.

**Detection:**
- JSDoc/docstring line count exceeds function body line count
- `@param` descriptions duplicate the parameter type
- `@returns` description is "The [field name]" or "Returns the [field name]"
- Function body is a single return statement

**Severity:** HIGH

**Example:**
```typescript
/**
 * Gets the user's name.
 * @returns {string} The name of the user.
 */
getName(): string {
  return this.name;
}
```

**Fix:** Delete the JSDoc entirely. `getName(): string` is self-documenting.

---

### 6. Language Tutorial Comments

**What:** Comments that explain how the programming language works rather than why the code makes a specific choice.

**Detection:**
- Comment explains what a `for` loop, `if` statement, `map`, `filter`, or other standard construct does
- Comment defines what a variable declaration is
- Comment explains string concatenation, array indexing, or other basic operations

**Severity:** CRITICAL

**Example:**
```python
# Create a new dictionary to store the results
results = {}

# Use a for loop to iterate over each item in the list
for item in items:
    # Check if the item meets the condition
    if item.is_valid():
        # Add the item to the results dictionary
        results[item.id] = item
```

**Fix:** Delete all four comments. Any developer reading this code understands dictionaries, for loops, conditionals, and dictionary assignment.

---

### 7. Placeholder Comments

**What:** Leftover scaffolding comments from code generation that were never replaced with real implementation or real comments.

**Detection:**
- Pattern: `// TODO: implement`
- Pattern: `// (Replace|Update|Change|Modify) (this|the above) with (your|actual|real)`
- Pattern: `// Add your .+ here`
- Pattern: `// \.\.\. rest of (code|implementation|logic)`

**Severity:** CRITICAL

**Example:**
```typescript
// Replace this with your actual API key
const apiKey = "your-api-key-here";

// Add your error handling logic here
```

**Fix:** Either implement the actual code or delete the placeholder entirely. Placeholder comments in committed code are never acceptable.

---

### 8. Apologetic Comments

**What:** Comments that signal uncertainty about the code's correctness rather than fixing the underlying issue.

**Detection:**
- Pattern: `// (hack|workaround|kludge|quick fix|bandaid|band-aid)`
- Pattern: `// (should work|hopefully|might|probably|I think)`
- Pattern: `// (not sure|don't know) (why|if|how)`
- Pattern: `// (good enough|works for now|temporary)`

**Severity:** MEDIUM — these sometimes contain genuine context about known limitations.

**Example:**
```typescript
// This is a bit of a hack but should work for now
const timeout = setTimeout(() => retry(), 1000);
```

**Fix:** Either fix the underlying issue or rewrite the comment to explain the actual constraint. "Retry after 1s due to upstream rate limiting" is information. "Should work for now" is not.

---

### 9. Redundant Type Documentation

**What:** JSDoc `@param`/`@returns` annotations that duplicate information already expressed by TypeScript types or Python type hints.

**Detection:**
- `@param {string} name` on a function with `name: string` in the signature
- `@returns {boolean}` on a function with `: boolean` return type
- Docstring type annotations when the language has native type annotations
- `@param` description is just the parameter name with spaces: "The user name" for `userName`

**Severity:** HIGH

**Example:**
```typescript
/**
 * @param {string} userId - The user ID
 * @param {boolean} includeDeleted - Whether to include deleted users
 * @returns {Promise<User | null>} The user or null
 */
async function getUser(userId: string, includeDeleted: boolean): Promise<User | null> {
```

**Fix:** Delete the JSDoc. The TypeScript signature `(userId: string, includeDeleted: boolean): Promise<User | null>` already says all of this. Add a comment only if there's non-obvious context (e.g., "userId is the external OAuth provider ID, not our internal UUID").

---

## Code Pattern Slop

### 1. Defensive Coding for Impossible Cases

**What:** Null checks, type guards, or error handling for conditions that the type system or program flow already guarantees cannot occur.

**Detection:**
- Null/undefined check on a non-optional typed parameter
- Type guard (`typeof x === 'string'`) when `x` is already typed as `string`
- Validation at internal boundaries (not user input or external API boundaries)

**Severity:** HIGH

**Example:**
```typescript
function processUser(user: User): void {
  if (!user) {
    throw new Error("User is required");
  }
  if (typeof user.name !== "string") {
    throw new Error("User name must be a string");
  }
  // ...actual logic
}
```

**Fix:** Delete the guards. TypeScript's type system guarantees `user` is a `User` and `user.name` is a `string`. Trust the types. Only validate at system boundaries (user input, API responses, deserialization).

---

### 2. Try-Catch Around Non-Throwing Code

**What:** Error handling wrapped around code that cannot throw exceptions in normal operation.

**Detection:**
- try-catch around pure computation (arithmetic, string operations, object property access on known types)
- try-catch around synchronous code that has no documented throwing behavior
- Catch block that logs and re-throws without transformation

**Severity:** HIGH

**Example:**
```typescript
try {
  const fullName = `${user.firstName} ${user.lastName}`;
  const initials = fullName.split(" ").map(n => n[0]).join("");
} catch (error) {
  console.error("Failed to compute initials:", error);
  throw error;
}
```

**Fix:** Remove the try-catch. String template literals and `split`/`map`/`join` on known strings don't throw.

---

### 3. Unnecessary Type Assertions

**What:** Type casts (`as`) that don't change the effective type or that override type safety without justification.

**Detection:**
- `as T` where the expression is already typed as `T`
- `as any` used to silence a type error rather than fixing the underlying type
- Multiple sequential assertions: `x as unknown as T`
- `!` (non-null assertion) on values that are already non-optional

**Severity:** MEDIUM

**Example:**
```typescript
const name: string = getUserName() as string; // getUserName() already returns string
const element = document.getElementById("app") as HTMLElement as HTMLDivElement;
```

**Fix:** Remove redundant assertions. For the `document.getElementById` case, either handle the `null` case or use a single assertion with a comment explaining why it's safe.

---

### 4. Single-Use Constants

**What:** Named constants extracted for values that appear exactly once and whose meaning is already clear from context.

**Detection:**
- `const` declaration used only at one call site
- The constant name restates the string/number value
- No realistic scenario where the value would change independently

**Severity:** LOW

**Example:**
```typescript
const DEFAULT_PAGE_SIZE = 20;
const ERROR_MESSAGE_USER_NOT_FOUND = "User not found";
const HTTP_STATUS_OK = 200;

// ...used exactly once each, deep in the code
```

**Fix:** Inline the values at their single usage point. Constants earn their existence through reuse or through making magic numbers/strings meaningful — not by restating what they contain.

---

### 5. Premature Abstraction

**What:** Design patterns, interfaces, or class hierarchies introduced for a single implementation with no current need for extensibility.

**Detection:**
- Interface with exactly one implementing class
- Abstract base class with exactly one concrete subclass
- Factory function that returns only one type
- Strategy/visitor/observer pattern with one strategy/visitor/observer
- Builder pattern for an object with 2-3 fields

**Severity:** MEDIUM

**Example:**
```typescript
interface IUserRepository { getUser(id: string): Promise<User>; }
class PostgresUserRepository implements IUserRepository { ... }
// No other implementation exists or is planned
```

**Fix:** Delete the interface. Use the concrete class directly. Extract an interface when a second implementation actually materializes.

---

### 6. Speculative Generality

**What:** Parameters, configuration options, or extension points added for hypothetical future requirements that don't currently exist.

**Detection:**
- Function parameters that are always passed the same value by all callers
- Configuration options with only one valid value
- Generic type parameters used for only one type
- Comments like "for future use" or "in case we need to"

**Severity:** MEDIUM

**Example:**
```typescript
function fetchUsers(
  endpoint: string = "/api/users",
  method: string = "GET",
  retryCount: number = 3,
  retryDelay: number = 1000,
  customHeaders?: Record<string, string>,
) { ... }
// Every caller: fetchUsers()
```

**Fix:** Remove unused parameters. Add them back when a second caller actually needs different values.

---

### 7. Empty/Silent Catch Blocks

**What:** Exception handlers that catch errors and do nothing — swallowing failures silently.

**Detection:**
- `catch` block with empty body
- `catch` block containing only a comment like `// ignore` or `// swallow`
- `catch` block that logs but takes no corrective action and doesn't re-throw

**Severity:** HIGH

**Example:**
```typescript
try {
  await saveUserPreferences(prefs);
} catch (e) {
  // ignore
}
```

**Fix:** Either handle the error meaningfully (retry, fallback, notify user) or let it propagate. If the error genuinely doesn't matter, add a specific comment explaining *why* it's safe to ignore (not just "ignore").

---

### 8. Wrapping Simple Operations

**What:** Helper functions that add a single layer of indirection around an already-clear operation, used once.

**Detection:**
- Function body is a single expression or return statement
- Function is called from exactly one location
- The function name doesn't add domain meaning beyond what the wrapped operation says

**Severity:** LOW

**Example:**
```typescript
function isPositive(n: number): boolean {
  return n > 0;
}

function formatDate(date: Date): string {
  return date.toISOString();
}
// Each called once
```

**Fix:** Inline the expression at the call site. Extract a helper only when it's reused, when the name adds domain meaning (`isEligibleForDiscount` vs `isPositive`), or when the operation is genuinely complex.
