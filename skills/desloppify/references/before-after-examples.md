# Before/After Examples

Concrete transformations showing what desloppification looks like in practice.

---

## Code Comment Examples

### Example 1: Over-Commented Function

**Before:**
```typescript
/**
 * Creates a new user in the database.
 * This function takes user input data, validates it,
 * hashes the password, and saves the user to the database.
 * @param data - The user input data containing name, email, and password
 * @returns The created user object
 */
async function createUser(data: CreateUserInput): Promise<User> {
  // Validate the input data
  const validated = schema.parse(data);

  // Hash the password using bcrypt
  const hashedPassword = await bcrypt.hash(validated.password, 10);

  // Create the user object with the hashed password
  const userData = {
    ...validated,
    password: hashedPassword,
  };

  // Save the user to the database and return the result
  return db.users.create({ data: userData });
}
```

**After:**
```typescript
async function createUser(data: CreateUserInput): Promise<User> {
  const validated = schema.parse(data);
  const hashedPassword = await bcrypt.hash(validated.password, 10);

  return db.users.create({
    data: { ...validated, password: hashedPassword },
  });
}
```

**What changed:** Removed JSDoc (TypeScript signature says it all), removed 5 narrator/step comments. Zero information lost — the code reads clearly on its own. 16 lines → 8 lines.

---

### Example 2: Language Tutorial Comments

**Before:**
```python
def get_active_users(users: list[User]) -> list[User]:
    # Create an empty list to store the active users
    active_users = []

    # Loop through each user in the users list
    for user in users:
        # Check if the user's status is active
        if user.status == Status.ACTIVE:
            # Add the active user to our list
            active_users.append(user)

    # Return the list of active users
    return active_users
```

**After:**
```python
def get_active_users(users: list[User]) -> list[User]:
    return [user for user in users if user.status == Status.ACTIVE]
```

**What changed:** Removed 5 tutorial comments. Simplified to a list comprehension since the loop was a simple filter. 12 lines → 2 lines.

---

### Example 3: Meaningful Comment Preserved

**Before:**
```typescript
// This function retries the API call with exponential backoff
// The retry delay is calculated using the formula: baseDelay * 2^attempt
// This helps to avoid overwhelming the API with too many requests
async function fetchWithRetry(url: string, maxAttempts: number = 3): Promise<Response> {
  // Initialize the attempt counter
  let attempt = 0;
  // Start the retry loop
  while (attempt < maxAttempts) {
```

**After:**
```typescript
// Exponential backoff: baseDelay * 2^attempt. The payments API
// rate-limits at 10 req/s and returns 429 without Retry-After.
async function fetchWithRetry(url: string, maxAttempts: number = 3): Promise<Response> {
  let attempt = 0;
  while (attempt < maxAttempts) {
```

**What changed:** Kept the "why" (specific API behavior that motivates the pattern), removed the "what" (restating the function name, explaining what a counter is, explaining what a loop does). The surviving comment tells you something you can't derive from the code alone.

---

## Code Pattern Examples

### Example 4: Defensive Coding for Impossible Cases

**Before:**
```typescript
function calculateTotal(items: CartItem[]): number {
  if (!items) {
    throw new Error("Items array is required");
  }
  if (!Array.isArray(items)) {
    throw new Error("Items must be an array");
  }

  let total = 0;
  for (const item of items) {
    if (!item) continue;
    if (typeof item.price !== "number") continue;
    if (typeof item.quantity !== "number") continue;
    total += item.price * item.quantity;
  }

  if (isNaN(total)) {
    return 0;
  }

  return total;
}
```

**After:**
```typescript
function calculateTotal(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}
```

**What changed:** Removed 5 impossible-case checks. TypeScript guarantees `items` is `CartItem[]`, each item has `price: number` and `quantity: number`. The `isNaN` check is impossible when multiplying two numbers. 17 lines → 3 lines.

---

### Example 5: Unnecessary Try-Catch and Single-Use Constants

**Before:**
```typescript
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const ERROR_PREFIX = "Failed to process:";

function processItem(item: Item): Result {
  try {
    const value = item.price * item.quantity;
    const formatted = `$${value.toFixed(2)}`;
    return { value, formatted, status: "success" };
  } catch (error) {
    console.error(`${ERROR_PREFIX} ${error}`);
    throw error;
  }
}
```

**After:**
```typescript
function processItem(item: Item): Result {
  const value = item.price * item.quantity;
  return { value, formatted: `$${value.toFixed(2)}`, status: "success" };
}
```

**What changed:** Removed try-catch (multiplication and string formatting don't throw). Removed three single-use constants (`MAX_RETRIES` and `RETRY_DELAY_MS` were unused entirely; `ERROR_PREFIX` was used once in dead code). 12 lines → 4 lines.

---

## Prose Examples

### Example 6: AI-Slop README Introduction

**Before:**
> ## Overview
>
> Welcome to ProjectX, a comprehensive, cutting-edge solution designed to streamline and facilitate the management of user authentication workflows. In today's fast-paced development landscape, it's crucial to leverage robust and seamless authentication mechanisms that ensure security while fostering a positive user experience.
>
> ProjectX endeavors to provide a holistic approach to authentication, utilizing industry best practices and innovative design patterns. Let's dive in and explore the multifaceted capabilities this framework has to offer.

**After:**
> ## Overview
>
> ProjectX handles user authentication: login, registration, password reset, and session management. It wraps OAuth 2.0 and supports SAML for enterprise SSO.

**What changed:** Removed 8 slop words (comprehensive, cutting-edge, streamline, facilitate, crucial, leverage, robust, seamless, foster, endeavors, holistic, utilizing, innovative, multifaceted). Deleted 3 filler phrases. Replaced with what the project actually does. 4 sentences → 2 sentences.

---

### Example 7: Hedging-Heavy Technical Decision

**Before:**
> It's worth noting that one might consider using Redis for the caching layer. There are various approaches to caching, and it could be argued that Redis provides a robust and scalable solution. In some cases, it may be possible to achieve significant performance improvements by implementing a comprehensive caching strategy. That said, it's important to carefully evaluate the trade-offs involved.

**After:**
> Use Redis for caching. The current P95 latency is 800ms; adding a Redis cache for the product catalog query reduces it to 50ms. Trade-off: adds operational complexity (Redis cluster management, cache invalidation on product updates).

**What changed:** Removed 5 hedging phrases. Replaced vague claims ("significant performance improvements") with actual numbers. Named the specific trade-off instead of gesturing at trade-offs existing.

---

### Example 8: Filler-Heavy PR Description

**Before:**
> ## Summary
>
> This pull request introduces a groundbreaking enhancement to the user authentication flow. Interestingly, the previous implementation had several crucial limitations that needed to be addressed. It's worth noting that this change ensures a seamless experience for end users while leveraging modern security best practices.
>
> ### Key Changes
> - Implemented a robust token refresh mechanism
> - Utilized industry-standard encryption for sensitive data
> - Fostered a more intuitive login experience
>
> In conclusion, these changes represent a significant step forward in our authentication infrastructure.

**After:**
> ## Summary
>
> Adds automatic token refresh so users aren't logged out mid-session. Switches password hashing from MD5 to bcrypt.
>
> ### Changes
> - Refresh tokens via `/auth/refresh` endpoint, called 5 min before expiry
> - Bcrypt with cost factor 12 replaces MD5 password hashing
> - Login form shows inline validation errors instead of a generic alert

**What changed:** Removed 9 slop words and 4 filler phrases. Replaced vague claims ("robust token refresh mechanism") with specifics ("/auth/refresh endpoint, called 5 min before expiry"). Deleted the empty conclusion. Renamed "Key Changes" to "Changes" (all changes in a PR are key — that's why they're in the PR).
