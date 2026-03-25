

# Fix Hot Product Pricing on Product Detail Page + Create Email Campaign Function

## Problem

Two issues:

1. **Product detail page shows separate markup/shipping prices instead of "Included"** when arriving from an external link (email, shared URL). The `isFixedPrice` detection relies on `location.state` (only available via in-app navigation from `/hot-products`). The DB fallback query exists but has a timing gap — on first render `hotProductPrice` is `null`, so `isFixedPrice` is `false` and the regular price breakdown shows. Also, if a user lands via a URL with no `location.state`, they see the raw catalog price, not the admin-set hot product price.

2. **The `send-hot-products-email` edge function doesn't exist** — the admin campaign "Approve & Send" button calls it but it was never created.

---

## Plan

### Step 1: Add `?hot=1` URL param support to ProductDetails

When links in emails point to `/product/{provider}/{id}?hot=1`, the product detail page should immediately know to check for hot product pricing before rendering the price breakdown.

**File**: `src/pages/shop/ProductDetails.tsx`
- Read `?hot=1` from URL search params
- If present, set a `pendingHotLookup` flag so the price breakdown shows a loading state until the `hot_products_showcase` query completes
- This eliminates the flash of regular pricing

### Step 2: Fix the hot product price detection to also use URL param

**File**: `src/pages/shop/ProductDetails.tsx` (useEffect at line 522)
- When `?hot=1` is in the URL OR `location.state.isFixedPrice` is set, query `hot_products_showcase` for the price
- Ensure `isFixedPrice` is true as soon as the query confirms the product is in the showcase
- If the query finds no match (product removed from showcase), fall back to regular pricing gracefully

### Step 3: Create the `send-hot-products-email` edge function

**File**: `supabase/functions/send-hot-products-email/index.ts`

This function:
- Receives `{ campaignId }` in the body
- Loads the campaign from `hot_product_campaigns` table
- Loads all users with emails
- Builds an HTML email with the campaign products in a grid (image, title, price, "Order Now" button)
- The "Order Now" button links to `/product/{provider}/{id}?hot=1` so the product detail page auto-detects fixed pricing
- Sends emails in batches with rate limiting (same pattern as `send-bulk-announcement`)
- Updates campaign status to `sent` with `sent_count`

### Step 4: Update HotProducts admin page email links

**File**: `src/pages/admin/HotProducts.tsx`
- Ensure the campaign product links use `?hot=1` parameter
- No other changes needed — the approve/send flow already invokes the edge function

---

## Technical Details

- The `?hot=1` param is a lightweight signal — actual price is still fetched server-side from `hot_products_showcase`
- Email HTML uses table-based layout for email client compatibility
- Rate limiting: 600ms between sends, retry on rate limit (same as existing bulk sender)
- The edge function uses the shared `sendEmail` utility from `_shared/email.ts`
- No mobile/RN code is touched

