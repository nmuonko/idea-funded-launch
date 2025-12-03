# Save for Later - Mobile API Documentation

## Overview
The AfriShop cart now supports "Save for Later" functionality, allowing users to save items they're not ready to purchase immediately.

## Database Changes
New columns added to `order_items`:
- `is_saved_for_later` (boolean, default: false)
- `saved_at` (timestamptz, nullable)
- `last_reminder_at` (timestamptz, nullable)

---

## API Endpoints

### GET /mobile-get-cart
Returns cart items separated into active and saved sections.

**Response:**
```json
{
  "items": [...],           // Active items (backward compatible)
  "activeItems": [
    {
      "id": "uuid",
      "productUrl": "https://...",
      "productTitle": "Product Name",
      "store": "AMAZON",
      "basePriceUsd": 99.99,
      "quantity": 1,
      "itemSubtotalUsd": 114.99,
      "isSavedForLater": false,
      "savedAt": null
    }
  ],
  "savedItems": [
    {
      "id": "uuid",
      "productUrl": "https://...",
      "productTitle": "Saved Product",
      "store": "WALMART",
      "basePriceUsd": 49.99,
      "quantity": 2,
      "itemSubtotalUsd": 114.98,
      "isSavedForLater": true,
      "savedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "summary": {
    "itemCount": 1,              // Only active items
    "itemsTotalUsd": 99.99,
    "markupFeeUsd": 15.00,
    "shippingFeeUsd": 30.00,
    "totalUsd": 144.99,
    "totalCdf": 405972,
    "exchangeRate": 2800,
    "savedItemCount": 1          // Count of saved items
  }
}
```

---

### PATCH /mobile-update-cart-item/:id
Update item quantity OR save/unsave status.

**Request Body (save for later):**
```json
{
  "isSavedForLater": true
}
```

**Request Body (move back to cart):**
```json
{
  "isSavedForLater": false
}
```

**Request Body (update quantity):**
```json
{
  "quantity": 3
}
```

**Response:**
```json
{
  "success": true,
  "item": {
    "id": "uuid",
    "productUrl": "...",
    "quantity": 1,
    "isSavedForLater": true,
    "savedAt": "2024-01-15T10:30:00Z"
  },
  "summary": { ... }
}
```

---

### POST /mobile-checkout
Selective checkout - only checkout specific items.

**Request Body:**
```json
{
  "cart_item_ids": [
    "item-uuid-1",
    "item-uuid-2"
  ]
}
```

**Validation Rules:**
- All items must belong to the authenticated user
- All items must NOT be `is_saved_for_later = true`
- All items must NOT require manual quote

**Success Response:**
```json
{
  "success": true,
  "orderId": "order-uuid",
  "order": {
    "id": "order-uuid",
    "status": "PENDING_PAYMENT",
    "itemCount": 2,
    "totalItemsUsd": 149.99,
    "shippingFeeUsd": 35.00,
    "grandTotalUsd": 184.99,
    "grandTotalCdf": 517972
  },
  "message": "Order created. Proceed to payment."
}
```

**Error Responses:**
```json
// Saved items included
{
  "error": "SAVED_ITEMS_INCLUDED",
  "message": "Cannot checkout items that are saved for later.",
  "savedItemIds": ["item-uuid"]
}

// Invalid items
{
  "error": "INVALID_ITEMS",
  "message": "Some requested items were not found in your cart.",
  "missingIds": ["item-uuid"]
}
```

---

## Automatic Email Reminders

The `saved-cart-reminders` edge function runs to send reminder emails:

**Criteria:**
- Items saved for at least 48 hours
- User hasn't received a reminder in the last 5 days

**Email Content:**
- Bilingual (French/English)
- Lists saved items with prices
- Call-to-action to return to app

**Trigger manually:**
```typescript
await supabase.functions.invoke('saved-cart-reminders');
```

---

## Admin Dashboard

Navigate to `/admin/saved-carts` to:
- View all users with saved items
- See total value of saved carts
- View individual saved items per user
- Manually trigger reminder emails
