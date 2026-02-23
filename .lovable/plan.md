

# Fix Three Issues: Product Galleries, Logout Page, and Support Inbox

## Issue 1: Products Show Only 1 Image (Root Cause Found)

### Problem
Every product in `catalog_items` has `images: []` (empty JSON array) -- only `image_url` (single thumbnail) is populated. The DB-first path in `catalog-product` uses `mapDbItemToResponse()` which reads from `item.images`, finds it empty, and falls back to just `image_url`. Result: **1 image per product**.

For Amazon: The Rainforest API is returning 402 (payment required), so the live fallback that would fetch full galleries is broken. The DB-first path returns only the single cached `image_url`.

For eBay: The live `getEbayItem()` call correctly fetches multiple images from the eBay Browse API (primary + additionalImages + product catalog images). However, this data is **not saved back** to `catalog_items.images` during the builder/search ingestion -- only `image_url` (single image) is stored.

### Root Cause
The catalog builder and search ingestion only save `image_url` (single string) to `catalog_items`. The `images` JSON column is never populated during ingestion. When the product detail page loads, it hits the DB-first path and gets only 1 image.

### Fix (Two-Part)

**Part A: Fix eBay detail page (immediate)**
When `catalog-product` fetches a live eBay item and gets multiple images, it currently caches to `catalog_items` with `images: ebayItem.images`. But the **DB-first path** that serves cached items reads `item.images` which is the empty array from the original ingestion. The fix: after the live eBay fetch successfully returns images, update `catalog_items.images` with the full gallery so future DB-first hits serve all images.

Currently, this already happens at line 690-706:
```typescript
const toCache = { ...images: ebayItem.images || [] ... };
await db.from("catalog_items").upsert(toCache, { onConflict: "id" });
```
But the issue is the `id` mismatch -- the upsert uses `fullProductId` (e.g., `ebay:v1|123|0`) but catalog_items uses a UUID `id`. The upsert silently does nothing because of the ID format mismatch.

**Fix:** Change the upsert to use `onConflict: "provider,provider_product_id"` so the image array actually gets saved.

**Part B: Populate images during builder ingestion**
In `catalog-refresh-worker`, the builder creates `upsertRows` for `catalog_items` but only sets `image_url` (single image from search results). eBay search results (`item_summary/search`) only return 1 image per item. This is expected -- search results don't include full galleries.

**Fix:** No action needed here. The gallery enrichment should happen on the detail page (Part A). Once Part A works, the first visit to a product detail populates the gallery, and all subsequent visits get the cached gallery from DB-first path.

**Part C: Amazon gallery fallback**
Since Rainforest API is returning 402, Amazon products can never get live galleries. For products already in `catalog_items` with a `raw` column containing image data, `mapDbItemToResponse` should extract images from `raw.images` or `raw.processedImages` when `item.images` is empty.

**Fix:** In `mapDbItemToResponse()`, add a fallback to extract images from the `raw` JSON column (which may contain Rainforest image data from prior successful fetches):
```typescript
// If images array is empty, try extracting from raw data
if (allImages.length === 0 && raw) {
  if (raw.processedImages && Array.isArray(raw.processedImages)) {
    allImages = raw.processedImages.filter(url => typeof url === 'string');
  } else if (raw.images && Array.isArray(raw.images)) {
    allImages = raw.images
      .map(i => i?.large || i?.hi_res || i?.link || (typeof i === 'string' ? i : null))
      .filter(Boolean);
  }
}
```

---

## Issue 2: Logout Shows "Admin Sign In" Page

### Problem
When customers sign out from the shop (Header or Account page), `signOut()` navigates to `/`. But the `Auth.tsx` page at `/auth` is an admin-only sign-in page. The issue is that sign-out navigates to `/` (home page), which is correct. However, the user reports seeing the Admin Sign In page after logout.

This likely happens when an admin signs out from the admin panel -- `AdminLayout.tsx` calls `navigate('/')` after sign out, which is correct (goes to home). But if users manually navigate to `/auth` (the admin login page) after signing out from the shop, they see "Admin Sign In" which is confusing.

### Actual Root Cause
Looking at `Header.tsx` line 76: `navigate('/')` -- this goes to the home page, which is correct. The issue is the `/auth` route itself only shows "Admin Sign In" with no way for customers to know it's admin-only. But since customers use `/shop-auth`, the real problem is likely:
- The user may be reaching `/auth` through a redirect or bookmark
- Or the `ProtectedRoute` for admin routes may be redirecting to `/auth` which shows "Admin Sign In"

**Fix:** After sign out, always navigate to the shop home `/` (already done). Additionally, the `/auth` page should clearly indicate it's for administrators only, or better yet, redirect non-admin users trying to access `/auth` to `/shop-auth`.

---

## Issue 3: Refine Support Inbox

### Current State
The Support Inbox (`SupportInbox.tsx`, 586 lines) works but has UX issues:
- N+1 query pattern: For each conversation, it makes a separate query for customer profile and agent profile (slow with many conversations)
- No unread message indicator
- No message preview in conversation list
- No search/filter capability
- No mobile responsiveness (fixed 320px sidebar)
- Conversations don't show the last message preview
- No sound/visual notification for new messages

### Proposed Refinements
1. **Last message preview** in conversation list (show first ~50 chars of latest message)
2. **Unread indicator** -- track if there are customer messages since last agent view
3. **Batch profile loading** -- fetch all profiles in one query instead of N+1
4. **Mobile responsive** -- collapsible sidebar for mobile view
5. **Search conversations** by customer name or email

---

## Technical Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Fix eBay upsert `onConflict` to save images; Add raw image fallback in `mapDbItemToResponse` |
| `src/pages/Auth.tsx` | Add redirect: if non-admin lands on `/auth`, show message or redirect to `/shop-auth` |
| `src/components/layout/Header.tsx` | Ensure sign-out always navigates to `/` (already correct) |
| `src/pages/admin/SupportInbox.tsx` | Add last message preview, batch profile loading, unread indicators, mobile responsiveness |

## Implementation Order
1. Fix product galleries (highest impact -- affects all product pages)
2. Fix logout/auth page routing
3. Refine support inbox

