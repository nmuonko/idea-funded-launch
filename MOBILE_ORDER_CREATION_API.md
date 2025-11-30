# Mobile Order Creation API

## Endpoint: POST /mobile-create-order-from-cart

Creates an order from the user's cart by transitioning a DRAFT order to PENDING_PAYMENT status.

### Authentication

Requires JWT token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Request

No request body required. The endpoint automatically processes the authenticated user's cart.

### Success Response

**Status Code:** 200

```json
{
  "success": true,
  "orderId": "uuid",
  "order": {
    "id": "uuid",
    "status": "PENDING_PAYMENT",
    "itemCount": 3,
    "itemsTotalUsd": 1985.00,
    "markupTotalUsd": 297.75,
    "shippingTotalUsd": 31.99,
    "grandTotalUsd": 2314.74,
    "grandTotalCdf": 6481258,
    "exchangeRate": 2800
  }
}
```

### Error Responses

#### UNAUTHORIZED (401)
User is not authenticated or JWT token is invalid.

```json
{
  "error": "UNAUTHORIZED",
  "message": "Authentication required."
}
```

**Mobile App Action:** Redirect to login screen.

---

#### EMPTY_CART (400)
User's cart is empty or contains no items.

```json
{
  "error": "EMPTY_CART",
  "message": "Your cart is empty. Please add items before checkout."
}
```

**Mobile App Action:** Show friendly message and redirect to shopping/browse screen.

---

#### DB_FETCH_ERROR (500)
Failed to retrieve cart data from database.

```json
{
  "error": "DB_FETCH_ERROR",
  "message": "Failed to fetch cart data.",
  "details": "error details"
}
```

**Mobile App Action:** Show "Something went wrong. Please try again." with retry button.

---

#### SETTINGS_ERROR (500)
Failed to load pricing configuration.

```json
{
  "error": "SETTINGS_ERROR",
  "message": "Failed to load pricing configuration.",
  "details": "error details"
}
```

**Mobile App Action:** Show "System configuration error. Please contact support."

---

#### DB_ORDER_UPDATE_FAILED (500)
Failed to finalize the order (most common issue: RLS policy violation).

```json
{
  "error": "DB_ORDER_UPDATE_FAILED",
  "message": "Failed to finalize order. Please try again.",
  "details": "error details",
  "code": "42501"
}
```

**Mobile App Action:** Show "Unable to complete checkout. Please try again." with retry button.

---

#### INTERNAL_ERROR (500)
Unexpected server error.

```json
{
  "error": "INTERNAL_ERROR",
  "message": "An unexpected error occurred. Please try again.",
  "details": "error details"
}
```

**Mobile App Action:** Show "Something went wrong. Please try again later." and log error to crash reporting.

---

## Mobile Integration Example

```javascript
async function createOrderFromCart(authToken) {
  try {
    const response = await fetch(
      'https://your-project.supabase.co/functions/v1/mobile-create-order-from-cart',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error codes
      switch (data.error) {
        case 'UNAUTHORIZED':
          // Redirect to login
          navigateToLogin();
          break;
        
        case 'EMPTY_CART':
          // Show empty cart message
          showAlert('Your cart is empty', 'Please add items to continue');
          navigateToShopping();
          break;
        
        case 'DB_ORDER_UPDATE_FAILED':
        case 'DB_FETCH_ERROR':
        case 'SETTINGS_ERROR':
          // Show retry option
          showAlert('Unable to complete checkout', data.message, {
            retry: () => createOrderFromCart(authToken)
          });
          break;
        
        default:
          // Generic error
          showAlert('Something went wrong', 'Please try again later');
          logError(data);
      }
      return null;
    }

    // Success - proceed to payment
    return data.order;

  } catch (error) {
    // Network or parsing error
    showAlert('Connection error', 'Please check your internet connection');
    logError(error);
    return null;
  }
}

// Usage in checkout flow
const order = await createOrderFromCart(userToken);
if (order) {
  // Proceed to initiate payment
  const payment = await initiatePayment(order.id);
  if (payment) {
    openCheckoutWebView(payment.checkoutUrl);
  }
}
```

## Order Flow

1. User adds items to cart → Creates/updates DRAFT order with order_items
2. User taps "Checkout" → Calls `/mobile-create-order-from-cart`
3. Backend transitions DRAFT → PENDING_PAYMENT and calculates totals
4. Mobile receives order details → Calls `/mobile-initiate-maisha-payment/:orderId`
5. Backend creates MaishaPay payment → Returns checkout URL
6. User completes payment → MaishaPay webhook updates order status to PAID
7. Mobile polls `/mobile-order-status/:orderId` to confirm payment

## Pricing Calculation

The endpoint uses the same calculation logic as `/mobile-get-cart`:

```
For each cart item:
  base_price_usd      = product price
  markup_fee_usd      = base_price * markup_percent / 100
  shipping_fee_usd    = shipping_flat_fee + (base_price * shipping_percent / 100)
  line_total_usd      = base_price + markup_fee + shipping_fee
  line_total_cdf      = line_total_usd * exchange_rate

Order totals (sum of all items * quantity):
  items_total_usd     = Σ(base_price_usd * quantity)
  markup_total_usd    = Σ(markup_fee_usd * quantity)
  shipping_total_usd  = Σ(shipping_fee_usd * quantity)
  grand_total_usd     = items_total + markup_total + shipping_total
  grand_total_cdf     = grand_total_usd * exchange_rate
```

## Logging

All operations are logged with `[mobile-create-order-from-cart]` prefix for debugging:

- User authentication
- Draft order fetch
- Totals calculation
- Order update operations
- Errors with full details

Check Edge Function logs in Lovable Cloud dashboard for troubleshooting.
