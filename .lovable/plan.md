

# Payment Integration Testing Plan

## Objective
Run comprehensive simulation-based tests for both Stripe and PawaPay payment providers, verifying the full checkout orchestration without creating live charges. Provide proof via API responses, backend logs, database state, and UI screenshots.

---

## Testing Scope

### Providers to Test
1. **Stripe** (Card payment via Checkout Session)
2. **PawaPay** (Mobile money via USSD)

### Coverage Areas
- Order creation from cart
- Payment session initiation
- Provider selection and routing
- Webhook/callback handling
- Order status transitions (`PENDING_PAYMENT` → `PAID`)
- Cart clearing post-payment
- Idempotency (duplicate request handling)

---

## Test Execution Strategy

### Phase 1: Database Setup Verification
**Actions:**
- Query `payment_providers` table to confirm both `stripe` and `pawapay` are `is_enabled = true`
- Query `admin_settings` to retrieve payment thresholds and configuration
- Check `orders` and `payment_attempts` tables for baseline state

**Proof Artifacts:**
- Database snapshots showing enabled providers and configuration

---

### Phase 2: Stripe Payment Simulation

#### 2.1 Order Creation
**API Call:** `POST /functions/v1/mobile-orders` with `action=checkout`
- Create a test cart with 1-2 items (total < $5,000 to stay within auto-redirect limits)
- Backend should create order in `PENDING_PAYMENT` status

**Expected Response:**
```json
{
  "ok": true,
  "order_id": "uuid-here",
  "status": "PENDING_PAYMENT"
}
```

#### 2.2 Payment Session Initiation
**API Call:** `POST /functions/v1/select-payment-provider`
```json
{
  "order_id": "uuid-from-step-1",
  "payment_method": "card"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "mode": "redirect",
  "redirect_url": "https://checkout.stripe.com/...",
  "provider": "stripe",
  "reference": "AFRI-..."
}
```

**Database State After:**
- `payment_attempts` table has new row with `provider = 'stripe'`, `status = 'pending'`
- `orders.payment_status` remains `PENDING_PAYMENT`

#### 2.3 Simulate Stripe Webhook
**API Call:** `POST /functions/v1/payments-webhook?provider=stripe`
- Send mock `checkout.session.completed` event with valid signature (or bypass signature check for testing)
- Include session ID matching the `provider_deposit_id` in `payment_attempts`

**Expected Backend Actions:**
- Look up order via session ID
- Update `orders.payment_status` to `PAID`
- Update `payment_attempts.status` to `completed`
- Trigger email notification (if configured)

**Database State After:**
- `orders.payment_status = 'PAID'`
- `payment_attempts.status = 'completed'`

---

### Phase 3: PawaPay Payment Simulation

#### 3.1 Order Creation
**API Call:** `POST /functions/v1/mobile-orders` with `action=checkout`
- Create a fresh test cart (different items from Stripe test)
- Backend creates order in `PENDING_PAYMENT` status

#### 3.2 Payment Session Initiation
**API Call:** `POST /functions/v1/select-payment-provider`
```json
{
  "order_id": "uuid-from-step-1",
  "payment_method": "mobile_money"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "mode": "manual",
  "provider": "pawapay",
  "reference": "AFRI-...",
  "ussd_code": "*123#" // or similar
}
```

**Database State After:**
- `payment_attempts` table has new row with `provider = 'pawapay'`, `status = 'pending'`

#### 3.3 Simulate PawaPay Callback
**API Call:** `POST /functions/v1/pawapay-callback`
- Send mock callback payload with `status = 'COMPLETED'`
- Include `depositId` matching the `provider_deposit_id` in `payment_attempts`

**Expected Backend Actions:**
- Validate signature (or skip for simulation)
- Look up order via `depositId`
- Update `orders.payment_status` to `PAID`
- Update `payment_attempts.status` to `completed`

**Database State After:**
- `orders.payment_status = 'PAID'`
- `payment_attempts.status = 'completed'`

---

### Phase 4: Idempotency & Error Handling

#### 4.1 Duplicate Session Request
**API Call:** Retry `select-payment-provider` with same `order_id` from Stripe test
**Expected Response:**
```json
{
  "ok": true,
  "mode": "redirect",
  "redirect_url": "https://checkout.stripe.com/...",
  "reference": "AFRI-..." // Same reference as before
}
```
- Should return existing session, not create new one

#### 4.2 Already-Paid Order
**API Call:** Send another webhook for an already-paid order
**Expected Behavior:**
- Backend logs "Order already in terminal state"
- No status changes in database
- Returns HTTP 200 to provider

---

### Phase 5: UI Screenshot Verification

#### 5.1 Checkout Page
- Navigate to `/checkout` in browser
- Add items to cart
- Select payment method (card vs mobile money)
- Capture screenshot showing provider selection UI

#### 5.2 Payment Pending Page (PawaPay)
- Navigate to `/payment-pending?reference=AFRI-...`
- Capture screenshot showing "Check Your Phone" instructions

#### 5.3 Payment Success Page
- Navigate to `/payment-success-shop?order_id=...`
- Capture screenshot showing order confirmation

---

## Proof Deliverables

### 1. API Response Evidence
- Raw JSON responses from each edge function call
- HTTP status codes
- Key fields: `order_id`, `reference`, `provider`, `status`, `redirect_url`

### 2. Backend Logs
- Edge function logs for:
  - `mobile-orders` (order creation)
  - `select-payment-provider` (session initiation)
  - `payments-webhook` (Stripe finalization)
  - `pawapay-callback` (PawaPay finalization)
- Look for structured log entries with `[CHECKOUT_EDGE]` prefix
- Confirm no errors or signature validation failures

### 3. Database State
- **Before tests:**
  - Count of existing orders and payment attempts
- **After Stripe test:**
  - New order with `payment_status = 'PAID'`
  - Corresponding `payment_attempts` row with `provider = 'stripe'`
- **After PawaPay test:**
  - New order with `payment_status = 'PAID'`
  - Corresponding `payment_attempts` row with `provider = 'pawapay'`
- **Queries to run:**
  ```sql
  SELECT id, payment_status, total_usd, created_at FROM orders ORDER BY created_at DESC LIMIT 5;
  SELECT order_id, provider, status, provider_deposit_id FROM payment_attempts ORDER BY created_at DESC LIMIT 5;
  ```

### 4. UI Screenshots
- Checkout page with provider selection
- Payment pending page (PawaPay)
- Payment success page
- All screenshots annotated with provider and test phase

---

## Technical Implementation Notes

### Edge Functions to Test
- `mobile-orders` (router handling `checkout` action)
- `select-payment-provider`
- `payments-webhook` (Stripe)
- `pawapay-callback`

### Authentication
- Use valid `Authorization: Bearer <jwt>` for authenticated endpoints
- Skip JWT for webhook endpoints (signature-based auth)

### Simulation Mode
- For Stripe: Use test mode keys (already configured in secrets)
- For PawaPay: Mock callback payload without hitting live API
- Bypass signature verification where necessary for testing

### Files to Inspect
- `supabase/functions/mobile-orders/index.ts`
- `supabase/functions/select-payment-provider/index.ts`
- `supabase/functions/payments-webhook/index.ts`
- `supabase/functions/pawapay-callback/index.ts`
- `src/pages/shop/Checkout.tsx`
- `src/pages/shop/ShopPaymentSuccess.tsx`

---

## Success Criteria

✅ Both Stripe and PawaPay flows complete without errors  
✅ Orders transition from `PENDING_PAYMENT` → `PAID`  
✅ `payment_attempts` records created with correct provider metadata  
✅ Idempotency prevents duplicate sessions  
✅ Already-paid orders reject further webhooks gracefully  
✅ UI routes correctly display payment instructions and confirmation  
✅ Backend logs show structured entries with no signature/auth failures  

