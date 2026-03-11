

# Auto-Cancel Stale Orders with Cart Recovery Emails

## Strategy
- **2 reminder emails** (not 3) spaced at 2h and 14h after order creation
- **Auto-cancel** after 24 hours if no payment completed
- Bilingual French-first emails (matching existing AfriShop standard)

## Implementation

### 1. Database Migration
Add tracking columns to `orders` table:
- `cart_reminder_1_sent_at timestamptz` — tracks first reminder
- `cart_reminder_2_sent_at timestamptz` — tracks second reminder

### 2. New Edge Function: `order-recovery-cron`
Triggered every 30 minutes by pg_cron. Three actions per run:

**Action A — Send Reminder 1** (orders 2+ hours old, no reminder sent):
```
WHERE status IN ('PENDING_PAYMENT','DRAFT')
  AND has items > 0
  AND created_at < now() - interval '2 hours'
  AND cart_reminder_1_sent_at IS NULL
```
→ Send bilingual email via Resend REST API (reuse existing `_shared/email.ts`)
→ Update `cart_reminder_1_sent_at = now()`

**Action B — Send Reminder 2** (orders 14+ hours old, reminder 1 sent, reminder 2 not sent):
```
WHERE cart_reminder_1_sent_at IS NOT NULL
  AND cart_reminder_2_sent_at IS NULL
  AND created_at < now() - interval '14 hours'
```
→ Send second bilingual email
→ Update `cart_reminder_2_sent_at = now()`

**Action C — Auto-cancel** (orders 24+ hours old, still unpaid):
```
WHERE status IN ('PENDING_PAYMENT','DRAFT')
  AND created_at < now() - interval '24 hours'
  AND no successful payment_attempts exist
```
→ Update status to `CANCELLED`, set `cancel_reason = 'auto_expired'`

### 3. Email Templates
- Bilingual (French first, English below) matching existing AfriShop email style
- Include order items summary, total, and a direct "Complete Your Order" link
- Email 1: Friendly reminder tone
- Email 2: Urgency tone ("your order will expire in 10 hours")
- Pull `support_whatsapp` and `support_email` from settings table

### 4. Cron Job (pg_cron)
Schedule `order-recovery-cron` to run every 30 minutes:
```
*/30 * * * *
```

### 5. Throttling
- 600ms delay between emails (matching existing Resend rate limit pattern)
- Cap at 20 emails per run to avoid overloading

### Files Changed
- `supabase/functions/order-recovery-cron/index.ts` — new edge function
- SQL migration — add tracking columns + cron job
- `supabase/config.toml` — add function config with `verify_jwt = false`

