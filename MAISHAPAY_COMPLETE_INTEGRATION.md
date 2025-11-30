# MaishaPay Complete Payment Integration

This document describes the complete MaishaPay payment integration for AfriShop, enabling users to checkout and pay for their orders seamlessly.

## Overview

The integration consists of 4 main endpoints and a complete admin UI for payment tracking:

1. **POST /mobile-create-order-from-cart** - Converts cart to order
2. **POST /mobile-initiate-maisha-payment/:orderId** - Initiates payment with MaishaPay
3. **POST /maisha-callback** - Webhook for payment status updates (public endpoint)
4. **GET /mobile-order-status/:orderId** - Check order payment status

## Environment Variables

Add these secrets to your Lovable Cloud project:

- `MAISHA_PUBLIC_KEY` - Your MaishaPay public API key
- `MAISHA_SECRET_KEY` - Your MaishaPay secret API key
- `MAISHA_API_BASE_URL` - Base URL for MaishaPay API (e.g., `https://api.maishapay.com` for production or sandbox URL)
- `MAISHA_CALLBACK_URL` - Your callback URL (e.g., `https://your-domain.com/maisha-callback` or the full Supabase function URL)

## Database Schema

### maisha_payments table

Tracks all MaishaPay transactions:

```sql
- id (UUID)
- order_id (UUID, references orders)
- maisha_reference (TEXT, unique)
- status (TEXT: 'pending', 'paid', 'failed')
- amount_usd (NUMERIC)
- amount_cdf (NUMERIC)
- currency (TEXT)
- raw_request (JSONB)
- raw_response (JSONB)
- paid_at (TIMESTAMP)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### orders table updates

The orders table uses these fields for payment tracking:

- `maisha_transaction_id` - The reference sent to MaishaPay
- `maisha_payment_status` - Current payment status from MaishaPay
- `payment_verified_at` - Timestamp when payment was verified

## Payment Flow

### 1. Create Order from Cart

**Endpoint:** `POST /mobile-create-order-from-cart`

**Authentication:** Required (JWT token)

**Purpose:** Converts the user's DRAFT order (cart) to PENDING_PAYMENT status with calculated totals.

**Process:**
1. Authenticates user via JWT
2. Finds user's existing DRAFT order with items
3. Retrieves pricing settings from database
4. Calculates totals:
   - `baseSubtotalUsd` = sum of (base_price_usd × quantity)
   - `markupTotalUsd` = sum of (markup_fee_usd × quantity)
   - `shippingTotalUsd` = sum of (shipping_fee_usd × quantity)
   - `grandTotalUsd` = baseSubtotalUsd + markupTotalUsd + shippingTotalUsd
   - `grandTotalCdf` = grandTotalUsd × exchange_rate_usd_to_cdf
5. Updates order status to PENDING_PAYMENT with all calculated totals
6. Returns order details

**Response:**
```json
{
  "orderId": "uuid",
  "grandTotalUsd": 125.50,
  "grandTotalCdf": 351400,
  "itemCount": 3
}
```

### 2. Initiate MaishaPay Payment

**Endpoint:** `POST /mobile-initiate-maisha-payment/:orderId`

**Authentication:** Required (JWT token)

**Purpose:** Creates a MaishaPay payment session and returns checkout URL.

**Process:**
1. Validates order belongs to user and is PENDING_PAYMENT
2. Retrieves user profile for customer information
3. Creates unique reference: `AFRISHOP-{orderId}-{timestamp}`
4. Calls MaishaPay API with:
   - Amount in CDF
   - Customer email and phone
   - Callback URL
   - Order reference
5. Creates record in `maisha_payments` table
6. Updates order with `maisha_transaction_id`
7. Returns payment details with checkout URL

**Response:**
```json
{
  "orderId": "uuid",
  "payment": {
    "checkoutUrl": "https://checkout.maishapay.com/...",
    "maishaReference": "AFRISHOP-...",
    "amount": 351400,
    "currency": "CDF"
  }
}
```

**Mobile App Action:**
The mobile app should open `checkoutUrl` in a WebView or external browser for the user to complete payment.

### 3. MaishaPay Callback/Webhook

**Endpoint:** `POST /maisha-callback`

**Authentication:** None (public endpoint)

**Purpose:** Receives payment status updates from MaishaPay.

**Process:**
1. Receives webhook payload from MaishaPay (supports JSON and form-encoded)
2. Extracts reference and payment status
3. Looks up payment record by `maisha_reference`
4. Normalizes status:
   - 'success', 'paid', 'completed' → 'paid'
   - 'failed', 'cancelled', 'rejected' → 'failed'
   - Others → 'pending'
5. Updates `maisha_payments` table with status and timestamp
6. If paid: Updates order status to PAID and sets `payment_verified_at`
7. If failed: Updates order `maisha_payment_status` to 'failed'
8. Returns 200 response quickly

**Expected MaishaPay Payload:**
```json
{
  "reference": "AFRISHOP-...",
  "status": "paid",
  "amount": 351400,
  // ... other fields
}
```

### 4. Check Order Status

**Endpoint:** `GET /mobile-order-status/:orderId`

**Authentication:** Required (JWT token)

**Purpose:** Allows mobile app to poll order status after payment.

**Process:**
1. Validates user owns the order
2. Returns current order and payment status

**Response:**
```json
{
  "orderId": "uuid",
  "status": "paid",
  "grandTotalUsd": 125.50,
  "grandTotalCdf": 351400,
  "maishaReference": "AFRISHOP-...",
  "paymentStatus": "paid",
  "paidAt": "2025-11-30T10:30:00Z"
}
```

## Mobile App Integration

### Checkout Flow

```javascript
// 1. User taps "Checkout with Maisha"
const { orderId, grandTotalCdf } = await fetch('/mobile-create-order-from-cart', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
  }
}).then(r => r.json());

// 2. Initiate payment
const { payment } = await fetch(`/mobile-initiate-maisha-payment/${orderId}`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
  }
}).then(r => r.json());

// 3. Open checkout URL in WebView
openWebView(payment.checkoutUrl);

// 4. Poll for payment status (while WebView is open)
const pollStatus = setInterval(async () => {
  const status = await fetch(`/mobile-order-status/${orderId}`, {
    headers: {
      'Authorization': `Bearer ${userToken}`,
    }
  }).then(r => r.json());
  
  if (status.status === 'paid') {
    clearInterval(pollStatus);
    showSuccessScreen();
    closeWebView();
  } else if (status.status === 'failed') {
    clearInterval(pollStatus);
    showErrorScreen();
    closeWebView();
  }
}, 3000); // Poll every 3 seconds
```

## Admin Panel Integration

### Payments Page

The Admin Panel now shows all MaishaPay transactions with:

**Dashboard Cards:**
- Total Transactions count
- Paid transactions count
- Pending transactions count
- Total Amount (USD)

**Payments Table:**
Shows data from `maisha_payments` table joined with orders and profiles:
- Maisha Reference (full transaction ID)
- Order ID (shortened)
- Customer name and phone
- Amount in USD and CDF
- Payment status with colored badges
- Transaction date

**Filtering:**
- All transactions
- Paid only
- Pending only
- Failed only

**Search:**
Search by Maisha reference, order ID, or customer name

### Order Details

When viewing an order in the admin panel, payment information shows:
- Maisha transaction reference
- Payment status
- Amount paid (USD and CDF)
- Payment verification timestamp

## Testing

### Sandbox Testing

1. Set `MAISHA_API_BASE_URL` to MaishaPay sandbox URL
2. Use sandbox API keys in `MAISHA_PUBLIC_KEY` and `MAISHA_SECRET_KEY`
3. In mobile app:
   - Add items to cart
   - Call `/mobile-create-order-from-cart`
   - Call `/mobile-initiate-maisha-payment/:orderId`
   - Open returned checkout URL
   - Complete test payment in MaishaPay sandbox
4. Verify:
   - Webhook received at `/maisha-callback`
   - Order status changes to PAID
   - Payment appears in Admin → Payments with "Paid" status

### Production Deployment

1. Update `MAISHA_API_BASE_URL` to production URL
2. Update `MAISHA_PUBLIC_KEY` and `MAISHA_SECRET_KEY` with live keys
3. Update `MAISHA_CALLBACK_URL` to your production callback URL
4. Test with small real transaction
5. Monitor logs and admin panel

## Security

- All payment endpoints use JWT authentication except the public callback
- Callback endpoint uses service role key to update database
- Payment secrets are stored in Lovable Cloud secrets (never in code)
- RLS policies ensure users can only see their own payments
- Admins can view all payments via admin role check

## Troubleshooting

### Payment Not Updating

1. Check edge function logs for `/maisha-callback`
2. Verify MaishaPay is sending webhooks to correct URL
3. Check `maisha_payments` table for raw_response field
4. Verify status normalization logic matches MaishaPay's status values

### Checkout URL Not Working

1. Verify `MAISHA_API_BASE_URL` is correct
2. Check MaishaPay API response in edge function logs
3. Ensure API keys are valid and not expired
4. Check MaishaPay dashboard for transaction

### Order Stuck in PENDING_PAYMENT

1. User may have closed payment without completing
2. Check if webhook was received (logs and maisha_payments table)
3. Manually verify payment status in MaishaPay dashboard
4. Admin can manually mark order as paid if needed

## Support

- MaishaPay API Documentation: [Check with MaishaPay]
- AfriShop Backend: Check edge function logs in Lovable Cloud
- Database: Use Lovable Cloud Database viewer to inspect orders and maisha_payments tables
