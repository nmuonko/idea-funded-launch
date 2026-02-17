

## Fix: Abandoned Cart Email Shows "0 Items" + "Complete Your Order" Links to Admin Login

### Problem Analysis

Two bugs identified in the cart abandonment email system:

1. **"0 items" with a price**: The email shows "You left 0 items" because `order_items` rows may be empty for the DRAFT order (items stored differently or not yet persisted as `order_items`), but `total_usd` on the order still has a cached value. The email should skip sending when there are 0 items, since showing "0 items" with a dollar total is confusing and unhelpful.

2. **"Complete Your Order" button goes to Admin Login**: The link in `send-abandoned-cart-recovery` points to `/orders`, which is wrapped in `ProtectedRoute` -- this redirects unauthenticated users to `/auth`, which is the **Admin Sign In** page. The link should instead point to `/cart` (the shop cart page), which properly redirects unauthenticated shop users to `/shop-auth` (customer login).

### Changes

#### A) `supabase/functions/send-abandoned-cart-recovery/index.ts`

1. **Skip emails when itemCount is 0**: Add a guard after computing `itemCount` (line 102) to skip the cart if `itemCount === 0` -- no point emailing about an empty cart.

2. **Fix CTA link**: Change the link URL from `/orders` to `/cart` (line 150), so clicking "Complete Your Order" takes customers to their cart page, not the admin login portal.

#### B) `supabase/functions/send-abandoned-cart-emails/index.ts`

1. **Skip emails when itemCount is 0**: Same guard -- skip sending if `order_items` is empty (line 89).

2. **Link already correct**: This function already links to `/cart` (line 123), so no URL change needed. But add the same 0-item guard for consistency.

### Technical Details

**File: `supabase/functions/send-abandoned-cart-recovery/index.ts`**
- After line 102 (`const itemCount = ...`), add:
  ```typescript
  if (itemCount === 0) {
    console.log('[send-abandoned-cart-recovery] Skipping cart with 0 items:', cart.id);
    continue;
  }
  ```
- Line 150: Change `/orders` to `/cart`:
  ```
  href="${Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com'}/cart"
  ```

**File: `supabase/functions/send-abandoned-cart-emails/index.ts`**
- After line 89 (`const itemCount = ...`), add:
  ```typescript
  if (itemCount === 0) {
    console.log('[send-abandoned-cart-emails] Skipping cart with 0 items:', cart.id);
    continue;
  }
  ```

### Verification
- Emails will no longer be sent for orders with 0 items
- "Complete Your Order" button will navigate to the shop cart page, not the admin login
- No other files or settings need to change

