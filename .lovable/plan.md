

# Fix Broken eBay Item Links in Admin Orders

## Problem
When clicking on item links in the admin Orders page, eBay links show "page not found." The URLs stored in the database look like:
- `https://www.ebay.com/itm/v1|225470519349|0`

The pipe characters (`|`) get URL-encoded to `%7C`, producing invalid eBay URLs. The correct URL should be:
- `https://www.ebay.com/itm/225470519349`

## Root Cause
eBay's Browse API uses a variation ID format (`v1|<itemId>|<variationId>`), and this raw format is being passed directly into the URL when creating order items. The numeric item ID needs to be extracted first.

## Fix (2 files)

### 1. `src/contexts/ShopCartContext.tsx` -- Fix URL construction
When building the eBay product URL from a product ID, extract the numeric item ID from the `v1|...|...` format before constructing the URL.

```
Before:  productUrl = `https://www.ebay.com/itm/${cleanId}`
         // cleanId = "v1|225470519349|0" -> broken URL

After:   Extract "225470519349" from "v1|225470519349|0", then
         productUrl = `https://www.ebay.com/itm/225470519349"
```

Add a small helper that checks if the ID starts with `v1|` and splits on `|` to get the second segment (the actual eBay listing ID).

### 2. Fix existing broken URLs in Live database
Run a SQL update on the **Live** environment to correct the 4 affected order items for Hattie's order. This converts URLs like `https://www.ebay.com/itm/v1|225470519349|0` to `https://www.ebay.com/itm/225470519349`.

The SQL will use a regex to extract the numeric ID from the `v1|...|...` pattern in the `product_url` column.

### 3. Also fix the edge function that may produce these URLs
Review `catalog-product/index.ts` and `catalog-refresh-seeded/index.ts` to ensure the `productUrl` field returned for eBay items uses a clean URL format (`/itm/<numericId>`) rather than the raw API ID format.

## No new dependencies needed.

