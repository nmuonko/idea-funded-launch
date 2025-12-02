# MaishaPay Complete Payment Integration

This document describes the complete MaishaPay payment integration for AfriShop, enabling users to checkout and pay for their orders seamlessly.

## Overview

The integration consists of these main endpoints:

1. **POST /mobile-create-order-from-cart** - Converts cart to order
2. **POST /mobile-initiate-maisha-payment/:orderId** - Initiates payment with MaishaPay
3. **POST /maisha-callback** - Webhook for payment status updates (public endpoint)
4. **POST /web-maisha-callback** - Web redirect callback handler
5. **GET /mobile-order-status/:orderId** - Check order payment status

## Environment Variables

Add these secrets to your Lovable Cloud project:

- `MAISHA_PUBLIC_KEY` - Your MaishaPay public API key
- `MAISHA_SECRET_KEY` - Your MaishaPay secret API key
- `MAISHA_API_BASE_URL` - Base URL for MaishaPay API
- `MAISHA_CALLBACK_URL` - Your callback URL

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
- created_at, updated_at (TIMESTAMP)
```

### orders table payment fields

- `maisha_transaction_id` - The reference sent to MaishaPay
- `maisha_payment_status` - Current payment status
- `maisha_status_code` - MaishaPay status code
- `maisha_description` - Status description
- `operator_ref_id` - Mobile operator reference
- `payment_verified_at` - Timestamp when payment was verified

## Payment Flow

### 1. Create Order from Cart

**Endpoint:** `POST /mobile-create-order-from-cart`

**Authentication:** Required (JWT token)

**Process:**
1. Authenticates user via JWT
2. Finds user's existing DRAFT order with items
3. Retrieves pricing settings from database
4. Calculates totals (baseSubtotal + markup + shipping)
5. Updates order status to PENDING_PAYMENT
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

**Process:**
1. Validates order belongs to user and is PENDING_PAYMENT
2. Creates unique reference: `AFRISHOP-{orderId}-{timestamp}`
3. Calls MaishaPay API with amount, customer info, callback URL
4. Creates record in `maisha_payments` table
5. Returns payment details with checkout URL

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

### 3. MaishaPay Callback/Webhook

**Endpoint:** `POST /maisha-callback`

**Authentication:** None (public endpoint)

**Process:**
1. Receives webhook payload from MaishaPay
2. Extracts reference and payment status
3. Normalizes status (success/paid/completed → 'paid')
4. Updates `maisha_payments` table
5. If paid: Updates order status to PAID
6. Returns 200 response quickly

### 4. Web Redirect Callback

**Endpoint:** `POST /web-maisha-callback`

**URL:** `https://afrishop-usa.com/maisha-callback`

After payment completion, MaishaPay redirects users with query parameters:
- `status` - HTTP status code (202 = success, 201 = pending, others = failed)
- `description` - Human-readable status message
- `transactionRefId` - MaishaPay transaction reference
- `operatorRefId` - Mobile operator reference number

**UI States:**
- **SUCCESS (202)**: Green checkmark, order summary, "View My Orders" button
- **PENDING (201/2xx)**: Orange clock, processing message
- **FAILED (other)**: Red X, failed message
- **ERROR (missing ref)**: Warning, contact support message

### 5. Check Order Status

**Endpoint:** `GET /mobile-order-status/:orderId`

**Authentication:** Required (JWT token)

**Response:**
```json
{
  "orderId": "uuid",
  "status": "paid",
  "grandTotalUsd": 125.50,
  "grandTotalCdf": 351400,
  "paymentStatus": "paid",
  "paidAt": "2025-11-30T10:30:00Z"
}
```

## Mobile App Integration

### Checkout Flow

```javascript
// 1. Create order from cart
const { orderId } = await fetch('/mobile-create-order-from-cart', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${userToken}` }
}).then(r => r.json());

// 2. Initiate payment
const { payment } = await fetch(`/mobile-initiate-maisha-payment/${orderId}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${userToken}` }
}).then(r => r.json());

// 3. Open checkout URL in WebView
openWebView(payment.checkoutUrl);

// 4. Poll for payment status
const pollStatus = setInterval(async () => {
  const status = await fetch(`/mobile-order-status/${orderId}`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  }).then(r => r.json());
  
  if (status.status === 'paid') {
    clearInterval(pollStatus);
    showSuccessScreen();
  }
}, 3000);
```

## Admin Panel Integration

### Payments Page

**Dashboard Cards:**
- Total Transactions count
- Paid/Pending/Failed counts
- Total Amount (USD)

**Payments Table:**
- Maisha Reference, Order ID, Customer info
- Amount in USD and CDF
- Payment status with colored badges
- Transaction date

**Features:** Filtering by status, search by reference/customer

## Testing

### Sandbox Testing

1. Set `MAISHA_API_BASE_URL` to sandbox URL
2. Use sandbox API keys
3. Add items to cart → Create order → Initiate payment
4. Complete test payment in MaishaPay sandbox
5. Verify webhook received and order status updated

### Test Web Callback URLs

```
# Success
/maisha-callback?status=202&description=Accepted&transactionRefId=TEST-ID&operatorRefId=OP-123

# Pending
/maisha-callback?status=201&description=Processing&transactionRefId=TEST-ID

# Failed
/maisha-callback?status=400&description=Failed&transactionRefId=TEST-ID
```

## Security

- All payment endpoints use JWT authentication except public callback
- Callback endpoint uses service role key to update database
- Payment secrets stored in Lovable Cloud secrets (never in code)
- RLS policies ensure users can only see their own payments

## Troubleshooting

**Payment Not Updating:**
- Check edge function logs for `/maisha-callback`
- Verify MaishaPay is sending webhooks to correct URL
- Check `maisha_payments` table for raw_response field

**Checkout URL Not Working:**
- Verify `MAISHA_API_BASE_URL` is correct
- Check MaishaPay API response in edge function logs
- Ensure API keys are valid

**Order Stuck in PENDING_PAYMENT:**
- User may have closed payment without completing
- Check if webhook was received
- Admin can manually mark order as paid if needed
