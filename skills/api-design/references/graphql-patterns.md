# GraphQL Schema Design

## Type Definitions

```graphql
scalar DateTime
scalar Decimal

type User {
  id: ID!
  email: String!
  createdAt: DateTime!
  orders(first: Int, after: String): OrderConnection!
}

type Order {
  id: ID!
  status: OrderStatus!
  total: Decimal!
  currency: String!
  lineItems: [LineItem!]!
  createdAt: DateTime!
}

type LineItem {
  id: ID!
  product: Product!
  quantity: Int!
  unitPrice: Decimal!
}

enum OrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
}
```

## Query, Mutation, Subscription Patterns

```graphql
type Query {
  # Single resource by ID
  order(id: ID!): Order

  # Paginated collection (Relay-style)
  orders(first: Int, after: String, filter: OrderFilter): OrderConnection!

  # Current user context
  me: User
}

type Mutation {
  # Returns the created/mutated resource
  createOrder(input: CreateOrderInput!): CreateOrderPayload!
  cancelOrder(id: ID!): CancelOrderPayload!
}

type Subscription {
  # Subscribe to events for a specific resource
  orderStatusChanged(orderId: ID!): Order!
}
```

## Input Types

```graphql
input CreateOrderInput {
  lineItems: [LineItemInput!]!
  shippingAddressId: ID!
  couponCode: String
}

input LineItemInput {
  productId: ID!
  quantity: Int!
}
```

## Relay-Style Pagination (Connection Pattern)

```graphql
type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
}

type OrderEdge {
  cursor: String!
  node: Order!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

## Error Handling: Errors Array vs Union Types

**Errors array (GraphQL default):**
```json
{
  "data": { "createOrder": null },
  "errors": [{ "message": "Product not found", "path": ["createOrder"] }]
}
```

**Union result types (recommended for mutations):**
```graphql
union CreateOrderResult = Order | ValidationError | NotFoundError

type Mutation {
  createOrder(input: CreateOrderInput!): CreateOrderResult!
}
```
This approach makes errors first-class, typed, and queryable by clients.

## Complexity and Depth Limiting

Prevent abuse by enforcing query complexity limits:
- **Max depth**: 7-10 levels (reject deeply nested queries)
- **Max complexity**: Assign cost to each field; reject queries over budget
- **Introspection**: Disable in production for public APIs

Libraries: `graphql-depth-limit`, `graphql-query-complexity`
