

# Fix: Robust isInCart Check + Correct Quote Request

## Issues Found

### 1. `isInCart` check is fragile but partially works

**Root cause**: Cart items from the server have `productId` set to the full `productUrl` (e.g., `https://www.ebay.com/itm/123456`). But `product.id` is just the raw ID (e.g., `123456`). The current check compares both `product.id` and `product.productUrl`, so the `productUrl` match should work in most cases.

However, the check can still break if URL formats differ (tracking params, URL encoding). A more robust approach is to also check if `productUrl` contains `product.id`.

**Fix**: Update `isInCart` to use a contains-based match as fallback:
```typescript
const isInCart = product && items.some(item => 
  item.productId === product.productUrl || 
  item.productId === product.id ||
  item.productUrl === product.productUrl ||
  (product.id && item.productId?.includes(product.id))
);
```

### 2. `mobile-request-quote` is actually fine for web

After reading the edge function code, it is platform-agnostic despite the name:
- It authenticates the user via JWT
- Finds the user's DRAFT order
- Auto-detects vehicle items (`is_vehicle = true`) from the cart
- Creates quote requests with dedup protection
- Sends admin notification email

The `{ locale }` body is sufficient because the function reads vehicle items from the cart automatically. No product payload is needed -- the cart already has all the data.

**However**, the function name is confusing. We can either:
- (A) Rename it (breaks mobile) -- NOT recommended
- (B) Keep using it from web as-is -- recommended, since the logic is shared

**No backend changes needed.**

### 3. Minor: Reset `quoteRequested` when product changes

Currently `quoteRequested` persists across product navigation. It should reset when the product changes.

## Changes

### File: `src/pages/shop/ProductDetails.tsx`

1. **Fix `isInCart`** (line 337-339): Use a more robust matching strategy that checks `productUrl` match AND a fallback `includes` check on `product.id`:

```typescript
const isInCart = product && items.some(item => {
  if (item.productUrl && product.productUrl && item.productUrl === product.productUrl) return true;
  if (item.productId === product.id) return true;
  if (product.id && item.productId?.includes(product.id)) return true;
  return false;
});
```

2. **Reset `quoteRequested` on product change** (inside the existing `useEffect` that resets state on route change, around line 170-176): Add `setQuoteRequested(false)`.

3. **Keep `mobile-request-quote` call as-is** -- the function works correctly for both platforms. The `{ locale }` payload is sufficient since the function auto-detects vehicle items from the user's cart.

## No Backend Changes

The `mobile-request-quote` edge function already:
- Reads vehicle items from the user's cart (no need to send product info in the body)
- Deduplicates quote requests (checks `quote_requests` table before inserting)
- Sends admin email notifications
- Returns success with quote IDs

## Files Modified
- `src/pages/shop/ProductDetails.tsx` -- fix `isInCart` matching, reset `quoteRequested` on navigation
