# Locked Prices: Refresh Ahead, Re-Quote Silently

**Goal:** What the user sees IS what they pay. No more "price drift" blocking at the "Passer la commande" button. Prices stay fresh in the background; if a drift slips through, the cart is silently re-quoted and the user notified — checkout never stalls.

## How it will work

```text
                ┌────────────────────────────────────┐
   every 6h →   │ cron-refresh-stale-prices          │
                │  finds catalog_items where         │
                │  last_price_check_at older than 6h │──► price-checker (batched)
                │  OR needs_price_review = true      │     updates price_usd
                └────────────────────────────────────┘
                                  │
                                  ▼
              catalog_items.price_usd is always ≤ 6h old
                                  │
                                  ▼
  User browses / adds to cart  ──► sees the fresh price
                                  │
                                  ▼
  Click "Passer la commande" ──► mobile-checkout
                                    • If any line price drifted: silently
                                      re-quote that line (no 409, no block)
                                    • Return priceAdjustments[] to UI
                                    • Continue to payment
                                  │
                                  ▼
                            Toast: "Prix mis à jour" (only if any line changed)
```

## What will change

### 1. New cron edge function `cron-refresh-stale-prices`
- Auth: requires `x-cron-secret` or service-role (per existing security memory).
- Selects up to 200 catalog items per run where `last_price_check_at IS NULL OR < now() - 6h OR needs_price_review = true`.
- Prioritizes items currently in active carts and hot products.
- Calls existing `price-checker` in batches of 25 with `mode: 'items'`.
- Logs counts to `system_audit_log` for visibility.

### 2. Schedule it with pg_cron
- Runs every 6 hours (`0 */6 * * *`).
- Uses `pg_net` to invoke the function with the cron secret header.

### 3. Patch `supabase/functions/mobile-checkout/index.ts` (lines 1365–1440)
- Keep the freshness check (still call `price-checker` for items > 6h old).
- Replace the **409 PRICE_DRIFT_DETECTED block** with a **silent re-quote**:
  - For each flagged line, update the `order_items.unit_price_usd` and `line_total_usd` to the refreshed `last_known_live_price_usd` (recompute with markup + shipping using the existing pricing module).
  - Recompute the order's `total_usd` / `total_cdf`.
  - Clear `needs_price_review`.
  - Continue to payment provider — no early return.
- Add `priceAdjustments: [{ itemId, name, oldPrice, newPrice }]` to the success response so the UI can notify.

### 4. Frontend `src/pages/shop/Checkout.tsx`
- When `data.priceAdjustments?.length > 0`, show a non-blocking toast: *"Prix mis à jour pour X article(s)"*. Checkout still proceeds.
- Remove the now-unused PRICE_DRIFT_DETECTED branch I added in the previous turn (it becomes a no-op safety net).

## Out of scope
- No changes to add-to-cart price lock (already exists per memory).
- No changes to hot-product fixed pricing (those don't drift).
- No frontend "review your cart" page — we no longer interrupt checkout.

## Risk / tradeoff acknowledged
On the rare line that drifts upward between display and checkout, the user pays the new price silently (with a toast). This matches your instruction "always re-quote silently in cart." If you'd rather we absorb the drift instead (user pays what they saw), say the word and I'll flip step 3 to keep the locked price.
