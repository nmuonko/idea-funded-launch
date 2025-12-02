# Cart Analytics & Automation System

This document describes the cart analytics, automation, and customer intelligence features for AfriShop.

## Cart Automation Systems

### 1. Cart Conversion Analytics Widget

**Location**: Admin Dashboard (right sidebar)

**Features**:
- Displays active carts count (DRAFT + PENDING_PAYMENT status)
- Shows completed orders count for the current month
- Calculates conversion rate (completed / total carts started)
- Trend analysis comparing current month to previous month
- Visual indicators for positive/negative trends

**Purpose**: Helps admins track cart abandonment rates and identify conversion opportunities.

### 2. Automatic Cart Cleanup

**Edge Function**: `cleanup-expired-carts`
**Schedule**: Runs daily at 2:00 AM UTC

**What it does**:
1. Finds all DRAFT orders with `updated_at` older than 30 days
2. Deletes associated order items first (foreign key constraint)
3. Deletes the expired orders
4. Logs the number of deleted carts

**Purpose**: Keeps the database clean and prevents accumulation of stale cart data.

### 3. Abandoned Cart Recovery Emails

**Edge Function**: `send-abandoned-cart-emails`
**Schedule**: Runs daily at 10:00 AM UTC

**What it does**:
1. Finds DRAFT orders updated 24+ hours ago
2. Checks if reminder email was already sent (via `admin_notes`)
3. Gets customer email and cart details
4. Sends personalized reminder email via Resend with:
   - Cart items with images (up to 3 shown)
   - Total amount in USD and CDF
   - "Complete Your Order" button
5. Marks cart as reminded to prevent duplicate emails

**Email Frequency**: One reminder per cart to avoid spam.

## Cart Analytics Features

### 1. Cart Value Heatmap

**Location**: Admin Dashboard → Cart Analytics & Recovery

**Features**:
- Color-coded heatmap (blue → yellow → orange → red based on abandoned cart value)
- Shows total abandoned value, cart count, item count, average cart value per category
- Categories: AMAZON, EBAY, WALMART, BESTBUY, CARVANA, CARGURUS, OTHER

**Data Source**: 
- Queries `orders` table for DRAFT and PENDING_PAYMENT status
- Joins with `order_items` to aggregate by `store` (category)

### 2. Customer Lifetime Value (LTV) Prediction

**Location**: Admin Dashboard → Cart Analytics & Recovery

**Features**:
- Enter any user ID to analyze purchase behavior
- AI analyzes completed orders, average order value, abandoned cart behavior, order frequency, category preferences
- Generates predictions:
  - **Predicted 12-Month LTV** (in USD)
  - **Customer Tier**: Bronze (<$500), Silver ($500-$2000), Gold ($2000-$5000), Platinum (>$5000)
  - **Churn Risk**: Low, Medium, High
  - **Top 3 Personalized Recommendations**

**How It Works**:
1. Backend function `predict-customer-ltv` retrieves user order history
2. Calculates behavioral metrics
3. Calls Lovable AI Gateway (google/gemini-2.5-flash)
4. Returns JSON prediction with tier and recommendations

**Edge Function**: `supabase/functions/predict-customer-ltv/index.ts`
**Component**: `src/components/admin/CustomerLTVPanel.tsx`

### 3. Intelligent Cart Merge

**How It Works**:
- When adding item via `mobile-add-cart-item`, checks for existing items with same `product_url`
- If duplicate found: merges quantities, recalculates subtotal, returns `"merged": true`
- If no duplicate: creates new item normally

**Benefits**:
- No duplicate product rows in cart
- Accurate quantity tracking
- Simplified checkout process
- Better cart analytics

**Mobile Integration**:
```typescript
const result = await addToCart(item);
if (result.merged) {
  showToast('Quantity updated in cart');
} else {
  showToast('Added to cart');
}
```

## Cron Job Management

Both automated tasks use PostgreSQL's `pg_cron` extension:

- **Cleanup**: `0 2 * * *` (2 AM daily)
- **Emails**: `0 10 * * *` (10 AM daily)

### View scheduled jobs:
```sql
SELECT * FROM cron.job;
```

### Delete a scheduled job:
```sql
SELECT cron.unschedule('cleanup-expired-carts-daily');
SELECT cron.unschedule('send-abandoned-cart-emails-daily');
```

## Configuration

**Environment Variables Required**:
- `RESEND_API_KEY` - For sending emails
- `EMAIL_FROM_ADDRESS` - Sender email address
- `FRONTEND_BASE_URL` - Website URL for "Complete Order" button
- `SUPABASE_SERVICE_ROLE_KEY` - For admin access in edge functions

## Admin Workflow

**Recommended Process**:
1. Review Cart Value Heatmap to identify high-value abandoned categories
2. Use LTV predictions to segment customers by value tier and risk level
3. Prioritize recovery for:
   - High LTV + High abandoned cart value = Top priority
   - Gold/Platinum tier customers with abandoned carts
   - Low churn risk customers
4. Use AI recommendations to personalize recovery emails

## Monitoring

- Check edge function logs for execution results
- Monitor email delivery in Resend dashboard
- Track conversion rates in Admin Dashboard widget
- Review `admin_notes` field for reminder email timestamps

## Troubleshooting

**Heatmap shows no data**:
- Ensure there are DRAFT or PENDING_PAYMENT orders
- Check that order_items have valid `store` values

**LTV prediction fails**:
- Verify LOVABLE_API_KEY is configured
- Check workspace credit balance
- Ensure user ID exists with order history

**Cart merge not working**:
- Verify product URLs match exactly (case-sensitive)
- Check mobile-add-cart-item edge function logs
