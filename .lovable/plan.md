

## Plan: Cart Recovery Dialog + Fix Forwarding + Dynamic Support Links

### Problem Analysis

1. **Cart Recovery button does nothing visible** — it forwards to `send-abandoned-cart-recovery` via function-to-function call, which silently fails (logs show only "shutdown"). The forwarded function also uses `Resend` SDK import (`esm.sh/resend`) instead of the shared `_shared/email.ts` helper, and only targets `DRAFT` orders (not `PENDING_PAYMENT`).

2. **No admin configuration UI** — the button fires immediately with no control over timing, language, or preview of affected users.

3. **Email content is English-only**, has no WhatsApp/email support links, and the support number is hardcoded.

4. **Payment flow** — needs end-to-end verification.

---

### What Will Be Built

#### 1. Cart Recovery Configuration Dialog (Frontend)

Replace the instant-fire button with a dialog that opens when clicking "Rappels paniers":

- **Time threshold selector**: dropdown — 2h, 6h, 12h, 24h, 48h, 72h (default 48h)
- **Language selector**: FR (default), EN, SW, LN
- **Preview count**: before sending, show how many users match the criteria (orders in `PENDING_PAYMENT` or `DRAFT` with items, older than selected threshold, not already reminded)
- **"Preview" button** → fetches count from a new endpoint
- **"Send Reminders" button** → triggers the actual send

Location: New component `src/components/admin/CartRecoveryDialog.tsx`

#### 2. Rewrite `send-abandoned-cart-recovery` Edge Function

Inline the logic into `email-service` (like `order_assistance`) to avoid function-to-function forwarding failures:

- Accept `{ type: 'abandoned_cart_recovery', hoursThreshold: number, language: string, preview: boolean }`
- If `preview: true` → return `{ count: N }` without sending
- If `preview: false` → query orders with status `PENDING_PAYMENT` or `DRAFT` (with items), older than `hoursThreshold`, not already reminded (`cart_reminder_sent_at IS NULL`)
- **Dynamic support contact**: fetch `support_whatsapp` and `support_email` from `settings` table
- **Bilingual email template** with:
  - Cart items preview (first 3 items with images)
  - Total in USD and CDF
  - "Complete Your Order" CTA button → links to `/cart`
  - "Need Help?" section with two buttons:
    - WhatsApp link: `https://wa.me/{dynamic_whatsapp}?text=...`
    - Email link: `mailto:{dynamic_email}?subject=...`
  - Footer in selected language
- After sending, update `cart_reminder_sent_at` on the order
- Log to `customer_email_logs`
- Return `{ sent: N, skipped: N }`

#### 3. Update `email-service/index.ts`

- Add `abandoned_cart_recovery` to `INLINE_TYPES` (handle inline instead of forwarding)
- Add the new `handleCartRecovery` function inline
- Remove from `TYPE_TO_FUNCTION` forwarding map

#### 4. Update Admin Orders Page

- Replace direct `handleSendCartRecovery` with dialog open
- Import and render `CartRecoveryDialog`

#### 5. Payment Flow Verification

- Review `Checkout.tsx`, `CardPayment.tsx`, `PaymentPending`, `PaymentCallback`, `PaymentSuccess` for any errors
- Test edge functions `mobile-checkout`, `select-payment-provider`, `verify-payment` via logs
- Ensure no broken imports or auth issues

---

### Files to Create/Edit

| File | Action |
|---|---|
| `src/components/admin/CartRecoveryDialog.tsx` | Create — dialog with threshold, language, preview, send |
| `supabase/functions/email-service/index.ts` | Edit — inline cart recovery logic, remove forwarding |
| `src/pages/admin/Orders.tsx` | Edit — wire dialog instead of direct invoke |

### Email Template Languages

**French (default):**
- Subject: "Votre panier vous attend! 🛒"
- Body: "Bonjour {name}, vous avez {N} articles dans votre panier..."
- CTA: "Finaliser ma commande"
- Help: "Besoin d'aide? Contactez-nous"

**English:**
- Subject: "Your cart is waiting! 🛒"
- Body: "Hi {name}, you have {N} items in your cart..."

Support links rendered as clickable buttons pulling WhatsApp number and email from `settings` table dynamically at send time.

