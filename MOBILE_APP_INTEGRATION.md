# Mobile App Integration Guide for AfriShop

Your AfriShop backend is now ready to support your native mobile app! This guide covers the API endpoints your mobile developers need to integrate.

## Authentication

All mobile API endpoints require authentication using Supabase Auth JWT tokens.

### Getting an Auth Token

```typescript
// Example: Login and get token
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});

const authToken = data.session?.access_token;
```

### Using the Token in Requests

Include the token in all API requests:

```typescript
const response = await fetch(API_ENDPOINT, {
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  }
});
```

## Cart Management APIs

### 1. Get Cart
**Endpoint**: `GET /mobile-get-cart`

Returns the user's current cart (DRAFT order) with all items and pricing.

```typescript
const response = await fetch(
  'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-get-cart',
  {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    }
  }
);

const { items, summary } = await response.json();

// Response structure:
{
  items: [
    {
      id: "uuid",
      productUrl: "https://...",
      productTitle: "Product Name",
      productImageUrl: "https://...",
      quantity: 1,
      basePriceUsd: 100.00,
      markupFeeUsd: 15.00,
      shippingFeeUsd: 10.00,
      lineTotalUsd: 125.00,
      lineTotalCdf: 350000
    }
  ],
  summary: {
    itemCount: 3,
    itemsTotalUsd: 300.00,
    markupFeeUsd: 45.00,
    shippingFeeUsd: 30.00,
    totalUsd: 375.00,
    totalCdf: 1050000,
    exchangeRate: 2800
  }
}
```

### 2. Add to Cart (with Intelligent Merge)
**Endpoint**: `POST /mobile-add-cart-item`

Adds a product to the cart. **Important**: If an item with the same `productUrl` already exists in the cart, the quantities will be automatically merged instead of creating a duplicate entry.

```typescript
const response = await fetch(
  'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-add-cart-item',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productUrl: "https://www.amazon.com/product-link",
      productPrice: 99.99,  // Price from the product page
      quantity: 1,
      productTitle: "Optional Product Title",
      productImageUrl: "Optional Image URL"
    })
  }
);

const result = await response.json();

// Check if item was merged with existing cart item
if (result.merged) {
  showToast('Quantity updated in cart!');
} else {
  showToast('Added to cart!');
}

// Response structure:
{
  success: true,
  merged: false,  // true if item was merged with existing item
  item: {
    id: "uuid",
    productUrl: "https://...",
    productTitle: "Product Name",
    quantity: 1,  // Updated quantity if merged
    basePriceUsd: 99.99,
    markupFeeUsd: 15.00,
    shippingFeeUsd: 10.99,
    lineTotalUsd: 125.98,
    lineTotalCdf: 352744
  }
}
```

**Smart Cart Merge Behavior**:
- The backend automatically detects if the same product (by exact `productUrl` match) is already in the cart
- If found, it merges by adding the new quantity to the existing quantity
- No duplicate product rows in the cart
- The `merged` flag in the response tells you whether a merge occurred
- This provides a cleaner UX and prevents cart clutter

### 3. Update Cart Item Quantity
**Endpoint**: `PATCH /mobile-update-cart-item/:itemId`

Updates the quantity of a cart item.

```typescript
const response = await fetch(
  `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-update-cart-item/${itemId}`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      quantity: 2
    })
  }
);

const { updatedItem, cartSummary } = await response.json();
```

### 4. Delete Cart Item
**Endpoint**: `DELETE /mobile-delete-cart-item/:itemId`

Removes an item from the cart.

```typescript
const response = await fetch(
  `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-delete-cart-item/${itemId}`,
  {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${authToken}`,
    }
  }
);
```

## Order Management APIs

### 1. Get User Orders
**Endpoint**: `GET /mobile-get-orders`

Returns all orders for the authenticated user.

```typescript
const response = await fetch(
  'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-get-orders',
  {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    }
  }
);

const { orders } = await response.json();
```

### 2. Get Order Details
**Endpoint**: `GET /mobile-get-order-by-id/:orderId`

Gets detailed information for a specific order.

```typescript
const response = await fetch(
  `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-get-order-by-id/${orderId}`,
  {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    }
  }
);

const { order, items } = await response.json();
```

## Payment Integration

### Initiate MaishaPay Payment
**Endpoint**: `POST /mobile-initiate-maisha-payment`

Initiates a payment through MaishaPay for an order.

```typescript
const response = await fetch(
  'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-initiate-maisha-payment',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orderId: "uuid",
      phoneNumber: "+243XXXXXXXXX"
    })
  }
);

const { paymentUrl, transactionId } = await response.json();

// Open paymentUrl in WebView for user to complete payment
```

## Push Notifications

### Register Device Token
**Endpoint**: `POST /register-device-token`

Registers a device token for push notifications (for cart recovery alerts).

```typescript
const response = await fetch(
  'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/register-device-token',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceToken: "fcm-or-apns-token",
      platform: "ios"  // or "android"
    })
  }
);
```

**When to call**: Call this endpoint after:
1. User logs in
2. App receives a new device token from FCM/APNS
3. App launches (to update last_used_at timestamp)

## Error Handling

All endpoints return errors in this format:

```json
{
  "error": "Error message here"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad request (missing/invalid parameters)
- `401` - Unauthorized (invalid or missing auth token)
- `403` - Forbidden (user doesn't own the resource)
- `404` - Not found
- `500` - Server error

## Testing with cURL

### Get Cart
```bash
curl -X GET \
  https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-get-cart \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### Add to Cart
```bash
curl -X POST \
  https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-add-cart-item \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "productUrl": "https://www.amazon.com/product",
    "productPrice": 99.99,
    "quantity": 1
  }'
```

## Best Practices

1. **Cache Cart Data**: Cache cart data locally and only refresh when needed
2. **Optimistic Updates**: Update UI immediately, then sync with backend
3. **Error Recovery**: Handle network errors gracefully with retry logic
4. **Token Refresh**: Implement automatic token refresh before expiry
5. **Loading States**: Show loading indicators during API calls
6. **Offline Mode**: Queue actions when offline and sync when online

## Need Help?

- Check the Supabase edge function logs for debugging
- Review the PUSH_NOTIFICATIONS_SETUP.md for notification setup
- Test endpoints with Postman or cURL first
- Contact the backend team if you encounter issues
