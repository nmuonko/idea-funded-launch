# AfriShop Payments API Documentation

This document describes the mobile API endpoints for MaishaPay payment integration.

## Overview

AfriShop uses MaishaPay as the payment gateway. The integration supports both **sandbox** (testing) and **live** (production) modes, controlled by environment variables.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MAISHAPAY_MODE` | Set to `sandbox` or `live` (or `1` for live) | Yes |
| `MAISHAPAY_SANDBOX_PUBLIC_KEY` | Sandbox API public key | For sandbox |
| `MAISHAPAY_SANDBOX_SECRET_KEY` | Sandbox API secret key | For sandbox |
| `MAISHAPAY_LIVE_PUBLIC_KEY` | Live API public key | For live |
| `MAISHAPAY_LIVE_SECRET_KEY` | Live API secret key | For live |
| `MAISHAPAY_CALLBACK_URL` | Webhook callback URL | Yes |

### Switching Between Sandbox and Live

1. **Sandbox Mode** (default): Set `MAISHAPAY_MODE=sandbox`
2. **Live Mode**: Set `MAISHAPAY_MODE=live` or `MAISHAPAY_MODE=1`

When switching to live:
1. Add your live API keys: `MAISHAPAY_LIVE_PUBLIC_KEY` and `MAISHAPAY_LIVE_SECRET_KEY`
2. Update `MAISHAPAY_CALLBACK_URL` to your production callback URL
3. Change `MAISHAPAY_MODE` to `live`

---

## Endpoints

### 1. Create Payment Session

Creates an order from cart items and initializes a MaishaPay payment session.

**Endpoint:** `POST /mobile-create-payment`

**Authentication:** Bearer token required

**Request Body:**
```json
{
  "cart_item_ids": ["uuid-1", "uuid-2"],
  "payment_method": "maishapay",
  "phone": "+243812345678",
  "email": "customer@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cart_item_ids` | array | Yes | Array of cart item UUIDs to checkout |
| `payment_method` | string | Yes | Must be `"maishapay"` |
| `phone` | string | No | Customer phone number |
| `email` | string | No | Customer email (falls back to user's email) |

**Success Response (200):**
```json
{
  "success": true,
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "maishapay_transaction_id": "AFRISHOP-550e8400-e29b-41d4-a716-446655440000",
  "maishapay_reference": "AFRISHOP-550e8400-e29b-41d4-a716-446655440000",
  "payment_url": "https://sandbox.maishapay.net/payment/vers1.0/merchant/checkout",
  "payment_mode": "sandbox",
  "checkout_fields": {
    "publicApiKey": "pk_sandbox_xxx",
    "secretApiKey": "sk_sandbox_xxx",
    "gatewayMode": "0",
    "montant": "125.50",
    "devise": "USD",
    "callbackUrl": "https://your-domain.com/api/maishapay/callback",
    "reference": "AFRISHOP-550e8400...",
    "email_client": "customer@example.com",
    "nom_client": "John Doe",
    "telephone_client": "+243812345678"
  },
  "order": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "PENDING_PAYMENT",
    "itemCount": 3,
    "totalUsd": 125.50,
    "totalCdf": 351400
  },
  "message": "Payment session created (sandbox mode). Open payment_url in WebView."
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `EMPTY_CART` | Cart is empty |
| 400 | `INVALID_ITEMS` | Some items not found in cart |
| 400 | `SAVED_ITEMS_INCLUDED` | Cannot checkout saved-for-later items |
| 400 | `MANUAL_QUOTE_REQUIRED` | Some items need custom shipping quote |
| 500 | `PAYMENT_CONFIG_ERROR` | MaishaPay not configured |
| 500 | `PAYMENT_INIT_FAILED` | Failed to create payment session |

---

### 2. Verify Payment Status

Checks the current payment status with MaishaPay and updates the local database.

**Endpoint:** `POST /mobile-verify-payment`

**Authentication:** Bearer token required

**Request Body:**
```json
{
  "order_id": "550e8400-e29b-41d4-a716-446655440000"
}
```
OR
```json
{
  "maishapay_reference": "AFRISHOP-550e8400-e29b-41d4-a716-446655440000"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "paid",
  "payment_status": "SUCCESS",
  "order_status": "PAID",
  "mode": "sandbox",
  "message": "Payment verified"
}
```

**Status Values:**
- `paid` - Payment confirmed successful
- `pending` - Payment still processing
- `failed` - Payment failed
- `cancelled` - Payment cancelled by user

---

### 3. MaishaPay Webhook Callback

**Endpoint:** `POST /maishapay-callback`

**Note:** This endpoint is called by MaishaPay servers, not by the mobile app.

**What it does:**
1. Receives payment notification from MaishaPay
2. Updates order status (PAID on success)
3. Updates `maisha_payments` record
4. Triggers confirmation email to customer
5. Notifies admin of payment

---

## Mobile App Integration

### Opening Payment URL

After receiving the payment URL, open it in a WebView or external browser:

```typescript
// React Native example
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';

// Option 1: Open in WebView (recommended)
<WebView
  source={{ uri: paymentUrl }}
  onNavigationStateChange={(navState) => {
    // Check if redirected back to callback URL
    if (navState.url.includes('maisha-callback')) {
      // Payment completed, check status
      verifyPayment(orderId);
    }
  }}
/>

// Option 2: Open in external browser
Linking.openURL(paymentUrl);
```

### Form POST Method

If you need to submit the checkout as a form (for some MaishaPay versions):

```typescript
const formHtml = `
  <html>
    <body onload="document.forms[0].submit()">
      <form method="POST" action="${paymentUrl}">
        ${Object.entries(checkoutFields).map(([key, value]) => 
          `<input type="hidden" name="${key}" value="${value}" />`
        ).join('')}
      </form>
    </body>
  </html>
`;

<WebView
  source={{ html: formHtml }}
  onNavigationStateChange={handleNavigation}
/>
```

### Polling for Status

If the callback doesn't work (e.g., app was closed), poll for status:

```typescript
const pollPaymentStatus = async (orderId: string, maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch('/mobile-verify-payment', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ order_id: orderId }),
    });
    
    const data = await response.json();
    
    if (data.status === 'paid') {
      return { success: true, data };
    }
    if (data.status === 'failed' || data.status === 'cancelled') {
      return { success: false, data };
    }
    
    // Wait 3 seconds before next attempt
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  return { success: false, timeout: true };
};
```

---

## Database Schema

### `maisha_payments` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `order_id` | uuid | Foreign key to orders |
| `maisha_reference` | text | MaishaPay transaction reference |
| `amount_usd` | numeric | Amount in USD |
| `amount_cdf` | numeric | Amount in CDF |
| `currency` | text | Currency code (USD/CDF) |
| `status` | text | paid/pending/failed/cancelled |
| `paid_at` | timestamp | When payment was confirmed |
| `raw_request` | jsonb | Original request data |
| `raw_response` | jsonb | MaishaPay callback data |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Last update time |

### `orders` Table (Payment Fields)

| Column | Type | Description |
|--------|------|-------------|
| `maisha_transaction_id` | text | MaishaPay transaction reference |
| `maisha_payment_status` | text | SUCCESS/PENDING/FAILED/CANCELLED |
| `maisha_status_code` | text | Raw status from MaishaPay |
| `maisha_description` | text | Status description |
| `operator_ref_id` | text | Mobile money operator reference |

---

## Testing in Sandbox Mode

1. Ensure `MAISHAPAY_MODE=sandbox` is set
2. Use sandbox API keys
3. Test payments will show "Sandbox" badge in admin panel
4. No real money is charged

### Test Card Numbers (if applicable)
Refer to MaishaPay sandbox documentation for test credentials.

---

## Security Notes

- Never expose API keys in frontend/mobile code
- All sensitive keys are stored as backend secrets
- Callback endpoint validates request signatures
- Payment verification uses server-side API calls only
