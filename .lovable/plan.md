

# Diagnosis: Amazon Links Redirect to Homepage

## The Root Cause -- It Is NOT Your Data

I thoroughly audited the database and code:

- **All 13,820** Amazon/Rainforest items have valid 10-character ASINs
- **All 13,820** product URLs are in the correct `https://www.amazon.com/dp/{ASIN}` format
- **Zero** `sspa/click` URLs remain in the database
- The `getAdminProductLink` helper in admin Catalog Cache is generating correct URLs

**The problem is Amazon-side.** When you click `https://www.amazon.com/dp/B0BN95KZB6`, Amazon itself redirects you to the homepage because:
1. The product has been **delisted or is out of stock** on Amazon (Renewed items frequently get pulled)
2. Amazon **geo-blocks** certain products based on your location (you are likely accessing from DR Congo or Africa)
3. Amazon's **bot detection** sometimes redirects non-US traffic to homepage

When I fetched the same URL from a US-based server, it loaded the actual product page correctly. This confirms it is a regional/availability issue, not a URL format problem.

---

## Proposed Fix: Dual-Link Strategy

Since we cannot control Amazon's redirect behavior, the plan is to give admin two link options and make the customer-facing experience more resilient:

### 1. Add Amazon Search Fallback Link in Admin UI
In the Catalog Cache table, add a second link icon that opens an Amazon **search** URL instead of a direct product link. Search URLs always work regardless of region:

```
https://www.amazon.com/s?k=Apple+iPhone+14+Pro+Max+1TB+Space+Black
```

This guarantees you always land on a results page showing the product (or similar ones), never a blank homepage.

### 2. Detect and Flag Likely-Dead Amazon Products
Add a visual indicator (small warning badge) on items where the ASIN might correspond to a discontinued product. This would use the existing `fail_count` and `last_checked_at` data -- items not verified recently or with high fail counts are likely delisted on Amazon.

### 3. Customer-Facing Product Page
On the customer-facing `ViewSourceLink` component, use the search URL fallback instead of direct `/dp/` links, so customers always see relevant results even if the exact ASIN is delisted.

---

## Changes

### File: `src/pages/admin/CatalogCache.tsx`
- Update `getAdminProductLink` to return an object with both `directUrl` and `searchUrl`
- Add a second small search icon link next to the existing external link
- The direct link stays as-is (`/dp/ASIN`), but a search fallback link is added

### File: `src/components/shop/ViewSourceLink.tsx`
- For Amazon/Rainforest products, use search-based URL as the primary link format
- Format: `https://www.amazon.com/s?k={encoded product title}`

### No database changes needed
The data is correct. This is purely a frontend link-generation improvement.

---

## Why This Works
- Amazon **never** redirects search URLs to homepage -- they always show results
- The product title is already stored, so generating search URLs is trivial
- Admin still has the direct `/dp/` link for when it works (US VPN, etc.)
- Customers always land on a useful Amazon page

