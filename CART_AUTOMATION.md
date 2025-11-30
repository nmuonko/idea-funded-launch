# AfriShop Cart Automation Systems

This document describes the automated cart management systems implemented in AfriShop.

## 1. Cart Conversion Analytics Widget

**Location**: Admin Dashboard (right sidebar)

**Features**:
- Displays active carts count (DRAFT + PENDING_PAYMENT status)
- Shows completed orders count for the current month
- Calculates conversion rate (completed / total carts started this month)
- Trend analysis comparing current month to previous month
- Visual indicators for positive/negative trends

**Purpose**: Helps admins track cart abandonment rates and identify opportunities to improve conversion.

## 2. Automatic Cart Cleanup

**Edge Function**: `cleanup-expired-carts`
**Schedule**: Runs daily at 2:00 AM UTC
**Logic**: Deletes DRAFT orders that haven't been updated in 30+ days

**What it does**:
1. Finds all DRAFT orders with `updated_at` older than 30 days
2. Deletes associated order items first (foreign key constraint)
3. Deletes the expired orders
4. Logs the number of deleted carts

**Purpose**: Keeps the database clean and prevents accumulation of stale cart data.

## 3. Abandoned Cart Recovery Emails

**Edge Function**: `send-abandoned-cart-emails`
**Schedule**: Runs daily at 10:00 AM UTC
**Logic**: Sends reminder emails to customers with carts older than 24 hours

**What it does**:
1. Finds DRAFT orders updated 24+ hours ago
2. Checks if reminder email was already sent (via `admin_notes`)
3. Gets customer email and cart details from database
4. Sends personalized reminder email via Resend showing:
   - Cart items with images
   - Total amount in USD and CDF
   - Call-to-action button to complete order
5. Marks cart as reminded in `admin_notes` to prevent duplicate emails

**Email Content**:
- Personalized greeting with customer name
- List of cart items with thumbnails (up to 3 shown)
- Total price in both currencies
- "Complete Your Order" button linking to the website
- Professional styling matching AfriShop branding

**Purpose**: Recovers lost sales by reminding customers about their abandoned carts.

## Cron Job Management

Both automated tasks are scheduled using PostgreSQL's `pg_cron` extension:

- **Cleanup**: `0 2 * * *` (2 AM daily)
- **Emails**: `0 10 * * *` (10 AM daily)

### View scheduled jobs:
```sql
SELECT * FROM cron.job;
```

### Delete a scheduled job (if needed):
```sql
SELECT cron.unschedule('cleanup-expired-carts-daily');
SELECT cron.unschedule('send-abandoned-cart-emails-daily');
```

### Manually trigger an edge function (for testing):
You can call the edge functions directly from Supabase Functions or via the admin panel when needed.

## Configuration

**Environment Variables Required**:
- `RESEND_API_KEY` - For sending emails
- `EMAIL_FROM_ADDRESS` - Sender email address (e.g., "AfriShop <noreply@afrishop.com>")
- `FRONTEND_BASE_URL` - Your website URL for the "Complete Order" button
- `SUPABASE_SERVICE_ROLE_KEY` - For admin access in edge functions

## Monitoring

- Check edge function logs in Supabase for execution results
- Monitor email delivery in Resend dashboard
- Track conversion rates in the Admin Dashboard widget
- Review `admin_notes` field in orders table to see when reminder emails were sent

## Best Practices

1. **Email Frequency**: Currently sends only ONE reminder per cart to avoid spam
2. **Timing**: 24-hour delay ensures customers had enough time to decide
3. **Cleanup Timing**: 30-day retention balances database cleanliness with data history
4. **Scheduling**: Jobs run during low-traffic hours to minimize database load
