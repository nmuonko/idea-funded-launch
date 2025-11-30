# Complete Payment Features Documentation

This document describes all payment-related features implemented for AfriShop, including refunds, retries, order history, automated notifications, and status progression.

## Features Overview

### 1. Refund Processing Workflow

**Admin Panel Integration:**
- Refund button appears on order details page for PAID or PROCESSING orders
- Admins can provide a refund reason
- Calls MaishaPay refund API automatically
- Updates order status to CANCELLED and payment status to "refunded"
- Logs refund action in order timeline

**Edge Function:** `maisha-process-refund`
- Admin authentication required
- Validates order can be refunded
- Calls MaishaPay refund API
- Updates database tables: orders, maisha_payments, order_actions
- Returns refund reference

**API Endpoint:**
```typescript
POST /maisha-process-refund
Body: { orderId, reason }
```

### 2. Payment Retry Functionality

**Customer Experience:**
- Retry payment button appears on orders with failed payments
- Generates new payment reference for tracking
- Opens new MaishaPay checkout
- Maintains order details (no recreation needed)

**Mobile Integration:**
```typescript
// Retry failed payment
const { data } = await supabase.functions.invoke('mobile-retry-payment/' + orderId);
window.open(data.payment.checkoutUrl, '_blank');
```

**Edge Function:** `mobile-retry-payment`
- User authentication required
- Works for PENDING_PAYMENT or failed payment orders
- Creates new MaishaPay transaction
- Generates new unique reference (AFRISHOP-{orderId}-RETRY-{timestamp})
- Returns new checkout URL

**API Endpoint:**
```typescript
POST /mobile-retry-payment/:orderId
```

### 3. Customer Order History Page

**Features:**
- View all past orders (excludes DRAFT/cart orders)
- Display order status with colored badges
- Show order items with images and links
- Track payment status and amounts (USD & CDF)
- Retry payment for failed transactions
- Reorder functionality (adds all items back to cart)

**Route:** `/orders`

**Status Badges:**
- Pending Payment (Yellow)
- Paid (Green)
- Processing (Blue)
- Shipped (Purple)
- Ready for Pickup (Indigo)
- Completed (Emerald)
- Cancelled (Red)

**Reorder Function:**
Adds all items from a previous order back to the cart using the mobile-add-cart-item endpoint.

### 4. Automatic Order Status Progression

**Flow:** PAID → PROCESSING → SHIPPED → COMPLETED

**Implementation:**
After payment confirmation (in maisha-callback):
1. Order marked as PAID
2. Automatic progression to PROCESSING after 1 minute (background task)
3. Admin manually updates to SHIPPED (triggers shipping notification)
4. Admin marks as COMPLETED when delivered

**Admin Actions:**
- Status dropdown in order detail page
- Changing status to SHIPPED automatically sends shipping notification
- Manual refund button for PAID/PROCESSING orders

### 5. Email Notifications

#### Payment Confirmation Email

**Triggered by:** MaishaPay callback when payment succeeds

**Edge Function:** `send-payment-confirmation`

**Content:**
- Order summary with all items
- Itemized pricing breakdown (subtotal, service fee, shipping)
- Total in USD and CDF
- Order ID and date
- Next steps information

**Styling:**
- Professional HTML email template
- Gradient header with confirmation message
- Responsive table layout for items
- Color-coded totals
- Mobile-friendly design

#### Shipping Notification Email

**Triggered by:** Admin changes order status to SHIPPED

**Edge Function:** `send-shipping-notification`

**Content:**
- Order ID
- Tracking number (if available)
- Carrier information
- Estimated delivery date
- Shipping date

**Integration:**
Automatically called when admin updates order to SHIPPED status.

**Manual Send:**
Admin can click "Send Tracking Email" button on order detail page.

### 6. Background Task Handling

**Payment Confirmation:**
Uses EdgeRuntime.waitUntil() pattern in maisha-callback:
```typescript
setTimeout(async () => {
  await supabase
    .from('orders')
    .update({ status: 'PROCESSING' })
    .eq('id', orderId)
    .eq('status', 'PAID');
}, 60000); // 1 minute delay
```

**Email Sending:**
Emails are sent asynchronously after webhook response:
- Doesn't block payment confirmation response
- Errors in email sending don't fail the payment
- Logged for debugging

## Database Schema Updates

### maisha_payments table
Existing table tracks all payment transactions:
- id, order_id, maisha_reference
- status (pending, paid, failed, refunded)
- amount_usd, amount_cdf
- raw_request, raw_response (JSONB)
- paid_at, created_at, updated_at

### orders table
Uses existing fields:
- maisha_transaction_id (reference for MaishaPay)
- maisha_payment_status (payment status from MaishaPay)
- payment_verified_at (timestamp)
- status (order status enum)

## Admin Panel Integration

### Order Detail Page

**New Features:**
1. **Refund Button** (PAID/PROCESSING orders)
   - Opens RefundDialog component
   - Requires reason input
   - Shows warning about irreversible action

2. **Send Tracking Email Button** (SHIPPED orders)
   - Manually trigger shipping notification
   - Disabled while sending
   - Shows loading state

3. **Automatic Shipping Notification**
   - Triggered when status changed to SHIPPED
   - Includes tracking number and carrier if available

### Payments Page

Updated to show maisha_payments data:
- Maisha transaction reference
- Order ID (linked)
- Customer details
- Amount in USD and CDF
- Payment status (Paid/Pending/Failed)
- Transaction date

## Mobile App Integration

### Retry Payment Flow

```javascript
// 1. User views order with failed payment
const order = orders.find(o => o.maisha_payment_status === 'failed');

// 2. Tap "Retry Payment" button
const response = await fetch(`/mobile-retry-payment/${order.id}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// 3. Open new checkout URL
const { payment } = await response.json();
openWebView(payment.checkoutUrl);

// 4. Poll for status update
pollOrderStatus(order.id);
```

### Order History Integration

```javascript
// Fetch user's order history
const { data } = await supabase
  .from('orders')
  .select('*, order_items(*), maisha_payments(*)')
  .eq('user_id', userId)
  .neq('status', 'DRAFT')
  .order('created_at', { ascending: false });
```

## Email Service Configuration

**Provider:** Resend (https://resend.com)

**Required Secret:**
- `RESEND_API_KEY` (already configured)
- `EMAIL_FROM_ADDRESS` (e.g., "AfriShop <orders@afrishop.com>")

**Email Templates:**
Both emails use professional HTML templates with:
- Gradient headers
- Responsive design
- Color-coded status information
- Clear call-to-action sections
- Mobile-friendly layout

## Testing

### Refund Testing

1. Admin logs in
2. Navigate to PAID order
3. Click "Process Refund"
4. Enter reason
5. Confirm refund
6. Verify:
   - MaishaPay refund API called
   - Order status = CANCELLED
   - Payment status = refunded
   - Timeline shows refund action

### Retry Payment Testing

1. Create order with failed payment
2. Customer views order history
3. Click "Retry Payment"
4. Complete payment in new window
5. Verify:
   - New maisha_payments record created
   - New checkout URL works
   - Payment success updates order

### Email Testing

**Payment Confirmation:**
1. Complete payment in sandbox
2. Check customer email
3. Verify order details correct
4. Check email formatting

**Shipping Notification:**
1. Admin marks order as SHIPPED
2. Check customer email
3. Verify tracking info included
4. Test manual send button

## Monitoring & Logging

All edge functions include detailed console logging:
- Request parameters
- API calls to MaishaPay
- Database updates
- Email sending status
- Error details

**Check logs in:**
Lovable Cloud → Edge Functions → Function logs

## Production Checklist

- [ ] Update EMAIL_FROM_ADDRESS with verified domain
- [ ] Test all emails in production
- [ ] Verify MaishaPay refund API credentials
- [ ] Test refund flow with small amount
- [ ] Monitor email delivery rates
- [ ] Set up email bounce handling
- [ ] Test retry payment flow
- [ ] Verify order progression timing
- [ ] Check mobile app integration

## Troubleshooting

### Emails Not Sending

1. Verify RESEND_API_KEY is set
2. Check domain verification in Resend
3. Review edge function logs
4. Test with different email addresses

### Refunds Failing

1. Check MaishaPay API credentials
2. Verify order is in correct status
3. Check MaishaPay dashboard
4. Review refund API response in logs

### Retry Payment Not Working

1. Verify order status allows retry
2. Check MaishaPay API response
3. Ensure new reference is unique
4. Test checkout URL validity

### Status Not Progressing

1. Check maisha-callback logs
2. Verify background task executed
3. Check order status conditions
4. Review database constraints

## Support

- AfriShop Backend: Check Lovable Cloud logs
- Email Issues: Resend support (https://resend.com/support)
- Payment Issues: MaishaPay support
- Database: Lovable Cloud Database viewer
