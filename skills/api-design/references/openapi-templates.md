# OpenAPI 3.1 Templates

Concrete, copy-paste-ready OpenAPI 3.1 templates. Customize the `info`, resource names, and schema fields for your domain.

---

## Minimal API Skeleton

The smallest valid OpenAPI 3.1 document with auth and a single resource:

```yaml
openapi: 3.1.0

info:
  title: My Service API
  version: 1.0.0
  description: |
    One-paragraph description of the API's purpose and intended consumers.
  contact:
    name: Platform Team
    email: platform@example.com
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://api-staging.example.com/v1
    description: Staging

tags:
  - name: Resources
    description: Core resource operations

security:
  - bearerAuth: []

paths: {}  # Replace with actual paths

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
```

---

## CRUD Resource Template

Full CRUD for a single resource (`/orders` example — substitute your resource name and schema):

```yaml
paths:

  /orders:
    get:
      summary: List orders
      operationId: listOrders
      tags: [Orders]
      parameters:
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/After'
        - $ref: '#/components/parameters/Before'
        - name: status
          in: query
          description: Filter by order status
          schema:
            $ref: '#/components/schemas/OrderStatus'
      responses:
        '200':
          description: Paginated list of orders
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderListResponse'
              example:
                data:
                  - id: ord_abc123
                    status: confirmed
                    total: 1099
                    currency: USD
                    createdAt: "2025-10-31T14:30:00Z"
                meta:
                  hasNext: true
                  hasPrev: false
                links:
                  self: /v1/orders?limit=20
                  next: /v1/orders?after=eyJpZCI6Im9yZF9hYmMxMjMifQ==&limit=20
        '401':
          $ref: '#/components/responses/Unauthorized'
        '429':
          $ref: '#/components/responses/TooManyRequests'

    post:
      summary: Create an order
      operationId: createOrder
      tags: [Orders]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrderRequest'
            example:
              lineItems:
                - productId: prod_xyz789
                  quantity: 2
              shippingAddressId: addr_def456
      responses:
        '201':
          description: Order created
          headers:
            Location:
              description: URL of the created order
              schema:
                type: string
                format: uri
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'

  /orders/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: Order ID
        schema:
          type: string
          example: ord_abc123

    get:
      summary: Get order by ID
      operationId: getOrder
      tags: [Orders]
      responses:
        '200':
          description: Order detail
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderResponse'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'

    put:
      summary: Replace an order
      operationId: replaceOrder
      tags: [Orders]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ReplaceOrderRequest'
      responses:
        '200':
          description: Order replaced
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'

    patch:
      summary: Partially update an order
      operationId: updateOrder
      tags: [Orders]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateOrderRequest'
      responses:
        '200':
          description: Order updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderResponse'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'

    delete:
      summary: Delete an order
      operationId: deleteOrder
      tags: [Orders]
      responses:
        '204':
          description: Order deleted
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
```

---

## Reusable Components

Drop these into your `components` section to standardize across all endpoints:

```yaml
components:

  parameters:
    Limit:
      name: limit
      in: query
      description: Number of results per page (max 100)
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      example: 20

    After:
      name: after
      in: query
      description: Cursor pointing to the start of the next page (from previous response)
      schema:
        type: string
      example: eyJpZCI6Im9yZF9hYmMxMjMifQ==

    Before:
      name: before
      in: query
      description: Cursor pointing to the start of the previous page
      schema:
        type: string

  responses:
    BadRequest:
      description: Request is malformed or missing required fields
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
          example:
            type: https://api.example.com/errors/bad-request
            title: Bad Request
            status: 400
            detail: The request body is missing required field 'lineItems'.
            requestId: req_abc123

    Unauthorized:
      description: Authentication credentials missing or invalid
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
          example:
            type: https://api.example.com/errors/unauthorized
            title: Unauthorized
            status: 401
            detail: Bearer token is missing or has expired.
            requestId: req_abc123

    Forbidden:
      description: Caller is authenticated but lacks permission
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
          example:
            type: https://api.example.com/errors/forbidden
            title: Forbidden
            status: 403
            detail: Scope 'orders:write' is required for this operation.
            requestId: req_abc123

    NotFound:
      description: The requested resource does not exist
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'
          example:
            type: https://api.example.com/errors/not-found
            title: Not Found
            status: 404
            detail: Order ord_abc123 does not exist.
            requestId: req_abc123

    UnprocessableEntity:
      description: Request is syntactically valid but fails semantic validation
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ValidationProblemDetails'
          example:
            type: https://api.example.com/errors/validation-failed
            title: Validation Failed
            status: 422
            detail: One or more fields failed validation.
            requestId: req_abc123
            errors:
              - field: quantity
                code: INVALID_RANGE
                message: Quantity must be between 1 and 999.

    TooManyRequests:
      description: Rate limit exceeded
      headers:
        Retry-After:
          description: Seconds until the client may retry
          schema:
            type: integer
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ProblemDetails'

  schemas:

    ProblemDetails:
      type: object
      required: [type, title, status]
      description: RFC 7807 Problem Details object
      properties:
        type:
          type: string
          format: uri
          description: URI identifying the error type
          example: https://api.example.com/errors/not-found
        title:
          type: string
          description: Short, human-readable summary of the error type
          example: Not Found
        status:
          type: integer
          description: HTTP status code
          example: 404
        detail:
          type: string
          description: Explanation specific to this occurrence of the error
          example: Order ord_abc123 does not exist.
        instance:
          type: string
          description: URI of the request or resource that produced the error
          example: /v1/orders/ord_abc123
        requestId:
          type: string
          description: Correlation ID for distributed tracing
          example: req_abc123

    ValidationProblemDetails:
      allOf:
        - $ref: '#/components/schemas/ProblemDetails'
        - type: object
          properties:
            errors:
              type: array
              items:
                $ref: '#/components/schemas/FieldError'

    FieldError:
      type: object
      required: [field, code, message]
      properties:
        field:
          type: string
          description: JSON path of the field that failed validation
          example: lineItems[0].quantity
        code:
          type: string
          description: Machine-readable error code
          example: INVALID_RANGE
        message:
          type: string
          description: Human-readable description of the validation failure
          example: Quantity must be between 1 and 999.

    PaginationMeta:
      type: object
      properties:
        hasNext:
          type: boolean
          description: Whether there are more results after this page
        hasPrev:
          type: boolean
          description: Whether there are results before this page
        total:
          type: integer
          description: Total count of items matching the query (omit for cursor-only pagination)

    PaginationLinks:
      type: object
      properties:
        self:
          type: string
          format: uri
          description: URL of the current page
        next:
          type: string
          format: uri
          description: URL of the next page (absent if no next page)
        prev:
          type: string
          format: uri
          description: URL of the previous page (absent if no previous page)
        first:
          type: string
          format: uri
          description: URL of the first page
        last:
          type: string
          format: uri
          description: URL of the last page (omit for cursor-only pagination)
```

---

## Request Body with Validation

A request schema demonstrating field constraints:

```yaml
schemas:

  CreateOrderRequest:
    type: object
    required:
      - lineItems
      - shippingAddressId
    properties:
      lineItems:
        type: array
        minItems: 1
        maxItems: 50
        description: Line items to include in the order
        items:
          $ref: '#/components/schemas/LineItemInput'
      shippingAddressId:
        type: string
        description: ID of the shipping address to use
        example: addr_def456
      couponCode:
        type: string
        maxLength: 50
        pattern: '^[A-Z0-9_-]+$'
        description: Optional promotional coupon code
        example: SAVE20
      notes:
        type: string
        maxLength: 500
        description: Optional customer notes

  LineItemInput:
    type: object
    required:
      - productId
      - quantity
    properties:
      productId:
        type: string
        description: ID of the product to order
        example: prod_xyz789
      quantity:
        type: integer
        minimum: 1
        maximum: 999
        description: Number of units to order
        example: 2
```

---

## Response with Envelope

A complete response schema following the `data` + `meta` + `links` pattern:

```yaml
schemas:

  OrderResponse:
    type: object
    required: [data]
    properties:
      data:
        $ref: '#/components/schemas/Order'
      meta:
        type: object
        properties:
          requestId:
            type: string
            example: req_abc123
          timestamp:
            type: string
            format: date-time
            example: "2025-10-31T14:30:00Z"
      links:
        type: object
        properties:
          self:
            type: string
            format: uri
            example: /v1/orders/ord_abc123

  OrderListResponse:
    type: object
    required: [data, meta]
    properties:
      data:
        type: array
        items:
          $ref: '#/components/schemas/Order'
      meta:
        $ref: '#/components/schemas/PaginationMeta'
      links:
        $ref: '#/components/schemas/PaginationLinks'

  Order:
    type: object
    required: [id, status, total, currency, createdAt]
    properties:
      id:
        type: string
        description: Opaque order identifier
        example: ord_abc123
      status:
        $ref: '#/components/schemas/OrderStatus'
      total:
        type: integer
        description: Order total in smallest currency unit (e.g., cents)
        example: 1099
      currency:
        type: string
        minLength: 3
        maxLength: 3
        description: ISO 4217 currency code
        example: USD
      lineItems:
        type: array
        items:
          $ref: '#/components/schemas/LineItem'
      createdAt:
        type: string
        format: date-time
        description: ISO 8601 timestamp in UTC when the order was created
        example: "2025-10-31T14:30:00Z"
      updatedAt:
        type: string
        format: date-time
        description: ISO 8601 timestamp in UTC when the order was last modified
        example: "2025-10-31T15:00:00Z"

  OrderStatus:
    type: string
    enum:
      - pending
      - confirmed
      - shipped
      - delivered
      - cancelled
    description: Current lifecycle state of the order

  LineItem:
    type: object
    required: [id, productId, quantity, unitPrice]
    properties:
      id:
        type: string
        example: li_ghi789
      productId:
        type: string
        example: prod_xyz789
      quantity:
        type: integer
        minimum: 1
        example: 2
      unitPrice:
        type: integer
        description: Unit price in smallest currency unit (e.g., cents)
        example: 549
```

---

## Webhook Definition

Template for defining outbound webhook events (using OpenAPI 3.1 webhooks):

```yaml
webhooks:

  order.status_changed:
    post:
      summary: Order status changed
      description: |
        Fired whenever an order transitions to a new status.
        Deliveries are signed with HMAC-SHA256 using the webhook secret.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OrderStatusChangedEvent'
            example:
              eventId: evt_jkl012
              eventType: order.status_changed
              occurredAt: "2025-10-31T15:00:00Z"
              data:
                orderId: ord_abc123
                previousStatus: confirmed
                currentStatus: shipped
      responses:
        '200':
          description: Event acknowledged
        '204':
          description: Event acknowledged (no body)

components:
  schemas:

    OrderStatusChangedEvent:
      type: object
      required: [eventId, eventType, occurredAt, data]
      properties:
        eventId:
          type: string
          description: Unique ID for this event delivery (use for deduplication)
          example: evt_jkl012
        eventType:
          type: string
          description: Dot-namespaced event type identifier
          example: order.status_changed
        occurredAt:
          type: string
          format: date-time
          description: ISO 8601 timestamp when the event occurred
          example: "2025-10-31T15:00:00Z"
        data:
          type: object
          required: [orderId, previousStatus, currentStatus]
          properties:
            orderId:
              type: string
              example: ord_abc123
            previousStatus:
              $ref: '#/components/schemas/OrderStatus'
            currentStatus:
              $ref: '#/components/schemas/OrderStatus'
```

**Webhook security headers** (sent with every delivery):
```
X-Webhook-Signature: sha256=<hmac-hex>
X-Webhook-Event-Id: evt_jkl012
X-Webhook-Timestamp: 1730386200
```

Verify the signature on the receiving end:
```
expected = HMAC-SHA256(secret, timestamp + "." + body)
```

Reject deliveries where `|now - X-Webhook-Timestamp| > 300 seconds` to prevent replay attacks.
