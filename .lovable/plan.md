

# Fix: Prevent Checkout from Interfering with Cart State

## Analysis Summary

After reviewing all relevant files, here's what I found:

**Already correct (no changes needed):**
- `Checkout.tsx` processCheckout never calls `clearCart()` or `clearCartOnPaymentSuccess()`
- `clearCartOnPaymentSuccess()` is only called in `PaymentSuccess.tsx` and `PaymentPending.tsx` after confirmed payment
- The backend `mobile-create-order-from-cart` already reuses existing DRAFT orders and recent PENDING_PAYMENT orders (within 30 min) -- it does NOT create a new empty draft each time

**One problem found:**
- `Checkout.tsx` lines 66-73: `restoreFromPendingCheckout()` fires when `items.length === 0`, which can happen **transiently during a sync** (e.g., between setLoading(true) and server response). This overwrites the real cart with a stale localStorage snapshot, making items appear to vanish or revert.

## Plan

### File: `src/pages/shop/Checkout.tsx`

**Remove or guard the `restoreFromPendingCheckout` effect** (lines 65-73).

Replace the current logic:
```typescript
useEffect(() => {
  if (items.length === 0) {
    const restored = restoreFromPendingCheckout();
    if (restored) {
      console.log('[CHECKOUT] Cart restored from pending snapshot');
    }
  }
}, []);
```

With a guarded version that only restores if the cart is truly empty (not just mid-sync):
```typescript
useEffect(() => {
  if (items.length === 0 && !loading) {
    const restored = restoreFromPendingCheckout();
    if (restored) {
      console.log('[CHECKOUT] Cart restored from pending snapshot (cart confirmed empty)');
    }
  }
}, [loading]);
```

This ensures the snapshot is only restored when loading is complete and the cart is genuinely empty -- not during a transient sync state.

### File: `src/contexts/ShopCartContext.tsx`

No changes needed. The `clearCart` function is only called from the cart page's "Clear Cart" button (with confirmation dialog). The `clearCartOnPaymentSuccess` is only called after confirmed payment. Neither is triggered by checkout.

### No backend changes

The `mobile-create-order-from-cart` function already looks for an existing DRAFT order first (line 97-102), then falls back to a recent PENDING_PAYMENT order (lines 116-142). Going back to cart and re-entering checkout will reuse the same order.

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/shop/Checkout.tsx` | Guard `restoreFromPendingCheckout` with `!loading` check to prevent stale snapshot overwriting real cart during sync |

This is a single-line fix. The rest of the checkout flow is already safe.

