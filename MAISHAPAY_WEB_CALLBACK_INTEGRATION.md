# MaishaPay Web Callback Integration

This document describes the complete MaishaPay callback flow for AfriShop's web application, modeled after the successful AfriFund implementation.

## Overview

When users complete payment on MaishaPay, they are redirected back to AfriShop with payment status information. The web callback system handles this redirect, verifies the payment, updates the order, and displays appropriate UI feedback.

## Flow Diagram

```
User → MaishaPay Payment → MaishaPay Redirect → AfriShop Callback Page → Backend Verification → Order Updated → Success/Pending/Failed UI
```

## Implementation Components

### 1. Callback Page Route

**URL:** `https://afrishop-usa.com/maisha-callback`

**File:** `src/pages/MaishaCallback.tsx`

This is the page where MaishaPay redirects users after payment.

### 2. Query Parameters

MaishaPay will redirect to the callback URL with these query parameters:

- `status` - HTTP status code (202 = success, 201 = pending, others = failed)
- `description` - Human-readable status message
- `transactionRefId` - MaishaPay transaction reference (matches `maisha_transaction_id` in orders table)
- `operatorRefId` - Mobile operator reference number

**Example Redirect:**
```
https://afrishop-usa.com/maisha-callback?status=202&description=Accepted&transactionRefId=AFRISHOP-abc-123&operatorRefId=OP-1234
```

### 3. Backend Edge Function

**Endpoint:** `POST /functions/v1/web-maisha-callback`

**File:** `supabase/functions/web-maisha-callback/index.ts`

**Authentication:** No JWT required (public endpoint)

This function:
- Validates the transaction reference
- Looks up the order by `maisha_transaction_id`
- Interprets the status code:
  - `202` → Payment SUCCESS → `payment_status: 'paid'`, `status: 'PAID'`
  - `201` or other 2xx → Payment PENDING → `payment_status: 'pending'`, `status: 'PENDING_PAYMENT'`
  - Other codes → Payment FAILED → `payment_status: 'failed'`, `status: 'CANCELLED'`
- Updates the order with payment status and metadata
- Updates the `maisha_payments` table
- Returns order summary

**Request Payload:**
```json
{
  "status": 202,
  "description": "Accepted",
  "transactionRefId": "AFRISHOP-abc-123",
  "operatorRefId": "OP-1234"
}
```

**Success Response:**
```json
{
  "success": true,
  "orderId": "uuid",
  "paymentStatus": "paid",
  "totalUsd": 100.50,
  "totalCdf": 281400
}
```

**Error Responses:**

- Missing transaction reference:
```json
{
  "success": false,
  "error": "MISSING_TRANSACTION_REF",
  "message": "Transaction reference is required"
}
```

- Order not found:
```json
{
  "success": false,
  "error": "ORDER_NOT_FOUND",
  "message": "Could not find order with this transaction reference"
}
```

### 4. Database Schema

The following columns were added to the `orders` table:

- `operator_ref_id` (TEXT) - Mobile operator reference
- `maisha_status_code` (TEXT) - MaishaPay status code
- `maisha_description` (TEXT) - Status description from MaishaPay

Existing columns used:
- `maisha_transaction_id` (TEXT) - Transaction reference for lookup
- `maisha_payment_status` (TEXT) - Payment status (paid/pending/failed)
- `status` (ENUM) - Order status (PAID, PENDING_PAYMENT, CANCELLED, etc.)
- `payment_verified_at` (TIMESTAMP) - When payment was verified

### 5. UI States

The callback page displays different UI based on payment status:

#### SUCCESS (status = 202)
- Green checkmark icon
- "Payment Successful!" title
- Shows order summary (USD and CDF amounts)
- Transaction details block
- "View My Orders" and "Back to Home" buttons

#### PENDING (status = 201 or other 2xx)
- Orange clock icon
- "Payment Pending" title
- Message that payment is being processed
- Transaction details block
- "Check Order Status" and "Back to Home" buttons

#### FAILED (other status codes)
- Red X icon
- "Payment Failed" title
- Message about failed/cancelled payment
- Transaction details block
- "View My Orders" and "Back to Home" buttons

#### ERROR (missing transaction reference)
- Warning triangle icon
- "Unable to Verify Payment" title
- Message to contact support
- Available transaction details
- "Contact Support" and "Back to Home" buttons

### 6. Frontend-Backend Communication

When the callback page loads:

1. **Immediately show loading state:**
   - "Verifying Payment" message
   - Spinner animation

2. **Extract query parameters** from URL

3. **Call backend edge function:**
```typescript
const { data, error } = await supabase.functions.invoke('web-maisha-callback', {
  body: {
    status: parseInt(status),
    description,
    transactionRefId,
    operatorRefId,
  },
});
```

4. **Handle response:**
   - Map `paymentStatus` to UI state (success/pending/failed)
   - Display order totals and transaction details
   - Show appropriate buttons

5. **Error handling:**
   - `ORDER_NOT_FOUND` → show error state with support contact
   - Other errors → show failed state

## Integration with MaishaPay

### Step 1: Configure Callback URL

When creating a payment with MaishaPay (via `mobile-initiate-maisha-payment`), provide this callback URL:

```
https://afrishop-usa.com/maisha-callback
```

### Step 2: MaishaPay Redirect

After payment completion, MaishaPay will redirect to:
```
https://afrishop-usa.com/maisha-callback?status=202&description=Accepted&transactionRefId=AFRISHOP-abc-123&operatorRefId=OP-1234
```

### Step 3: Automatic Processing

The callback page automatically:
- Reads the query parameters
- Calls the backend to verify and update the order
- Shows appropriate UI based on result

## Testing

### Test Success Payment

Navigate to:
```
http://localhost:5173/maisha-callback?status=202&description=Payment%20Accepted&transactionRefId=TEST-ORDER-ID&operatorRefId=OP-123
```

Replace `TEST-ORDER-ID` with an actual order's `maisha_transaction_id`.

### Test Pending Payment

Navigate to:
```
http://localhost:5173/maisha-callback?status=201&description=Payment%20Processing&transactionRefId=TEST-ORDER-ID&operatorRefId=OP-123
```

### Test Failed Payment

Navigate to:
```
http://localhost:5173/maisha-callback?status=400&description=Payment%20Failed&transactionRefId=TEST-ORDER-ID&operatorRefId=OP-123
```

### Test Missing Reference

Navigate to:
```
http://localhost:5173/maisha-callback?status=202&description=Accepted
```

## Security Considerations

1. **Public Endpoint:** The backend function does not require authentication because MaishaPay redirects cannot include user JWTs.

2. **Validation:** The function validates the transaction reference and only updates orders that exist in the database.

3. **Idempotency:** Multiple calls with the same transaction reference will update the same order (last update wins).

4. **Service Role Key:** Backend uses service role key to bypass RLS and update orders.

## Monitoring

Check logs for the backend function:
```bash
supabase functions logs web-maisha-callback
```

Key log messages:
- `[Web Maisha Callback] Request received`
- `[Web Maisha Callback] Order not found`
- `[Web Maisha Callback] Updating order`
- `[Web Maisha Callback] Success`

## Troubleshooting

### Issue: "Order not found" error

**Cause:** The `transactionRefId` from MaishaPay doesn't match any `maisha_transaction_id` in the orders table.

**Solution:** 
- Verify that `mobile-initiate-maisha-payment` is setting `maisha_transaction_id` correctly
- Check that the reference format matches between payment initiation and callback

### Issue: Payment status not updating

**Cause:** RLS policies or database permissions issue.

**Solution:**
- Backend uses service role key, so should bypass RLS
- Check Edge Function logs for specific error messages

### Issue: UI shows loading forever

**Cause:** Backend function error or network issue.

**Solution:**
- Check browser console for errors
- Verify Edge Function is deployed: `supabase functions list`
- Check function logs for errors

## Related Documentation

- `MAISHAPAY_COMPLETE_INTEGRATION.md` - Mobile API integration
- `PAYMENT_FEATURES.md` - Payment workflow features
- `MOBILE_ORDER_CREATION_API.md` - Order creation from cart

## Support

For MaishaPay integration issues, contact: support@afrishop-usa.com
