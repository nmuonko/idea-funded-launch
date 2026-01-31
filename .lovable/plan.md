
# Fix eBay Product Images - Complete ID Format Normalization

## Problem Summary

eBay items are showing only 1 image instead of 25+ because of ID format mismatches:

1. **`catalog-product` only handles colon format** (`ebay:v1|...`), NOT underscore format (`EBAY_V1|...`)
2. **mediaCache passes original ID unchanged** to catalog-product, which defaults to rainforest provider for unrecognized formats
3. **Log evidence**: `provider=rainforest error=INVALID_ID` for eBay IDs

## Technical Solution

### Step 1: Fix ID Parsing in catalog-product/index.ts

Update `parseProductId` to handle underscore separator in addition to colon:

```typescript
function parseProductId(url: URL): { provider: string | null; productId: string | null; rawId: string; idError: string | null } {
  let provider: string | null = null;
  let productId: string | null = null;

  const id = (url.searchParams.get("id") || "").trim();
  const lowerCaseId = id.toLowerCase();
  
  // Handle colon separator: "ebay:v1|..."
  if (id && id.includes(":")) {
    const parts = id.split(":", 2);
    provider = (parts[0] || "").trim().toLowerCase() || null;
    productId = (parts[1] || "").trim() || null;
  }
  // Handle underscore separator: "ebay_v1|..." or "EBAY_V1|..."
  else if (lowerCaseId.startsWith("ebay_")) {
    provider = "ebay";
    productId = id.slice(5); // Keep original case for item ID
  }
  else if (lowerCaseId.startsWith("rainforest_")) {
    provider = "rainforest";
    productId = id.slice(11);
  }
  else if (lowerCaseId.startsWith("amazon_")) {
    provider = "rainforest"; // Treat amazon as rainforest
    productId = id.slice(7);
  }
  // Fallback to query params or default
  else {
    provider = (url.searchParams.get("provider") || "").trim().toLowerCase() || null;
    productId = (url.searchParams.get("asin") || url.searchParams.get("itemId") || "").trim() || null;
    if (!productId && id) {
      productId = id.toUpperCase();
      provider = "rainforest";
    }
  }

  // Normalize for rainforest
  if (provider === "rainforest" && productId) {
    productId = productId.toUpperCase();
  }

  const rawId = provider && productId ? `${provider}:${productId}` : productId || id || "";
  
  // Validation
  let idError: string | null = null;
  if (!productId) {
    idError = "Product ID is required";
  } else if (provider === "rainforest") {
    idError = validateAsin(productId);
  }

  return { provider, productId, rawId, idError };
}
```

### Step 2: Normalize ID in mediaCache before calling catalog-product

Update `fetchAndCacheMedia` to construct a normalized ID with colon format:

```typescript
export async function fetchAndCacheMedia(
  supabase: SupabaseClient,
  provider: string,
  itemId: string,
  compositeId: string,
  settings: MediaCacheSettings
): Promise<MediaCacheRecord | null> {
  // ...existing code...
  
  // Normalize composite ID to colon format for catalog-product
  const normalizedId = `${provider}:${itemId}`;
  
  const productUrl = `${supabaseUrl}/functions/v1/catalog-product?id=${encodeURIComponent(normalizedId)}`;
  // ...rest of function
}
```

### Step 3: Clear Stale Media Cache Entries

Run SQL to delete incorrect cache entries:

```sql
DELETE FROM catalog_item_media 
WHERE provider = 'ebay' 
  AND image_count <= 2;
```

### Step 4: Add Environment Header to mediaCache Fetch

Add the required environment header to bypass catalog disabled checks:

```typescript
const response = await fetch(productUrl, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    "x-afrishop-environment": "production", // Required to bypass catalog disabled check
  },
  signal: controller.signal,
});
```

## Files to Modify

1. **`supabase/functions/catalog-product/index.ts`**
   - Update `parseProductId()` to handle underscore separator format
   - Support uppercase variants (EBAY_V1|...)

2. **`supabase/functions/_shared/mediaCache.ts`**
   - Normalize composite ID to colon format before API call
   - Add environment header to fetch request

## Expected Outcome

After these fixes:
- eBay items with 25+ photos will correctly show all images
- Media cache will properly store all image URLs
- Product detail pages will display full galleries
- The `catalog-product` endpoint will correctly route eBay IDs regardless of input format

## Testing Plan

1. Deploy fixes
2. Clear stale media cache entries with SQL
3. Open the specific eBay item (157299757552)
4. Verify:
   - `catalog-product` logs show `provider=ebay` (not rainforest)
   - Response includes `imageCount > 1`
   - Frontend displays multiple images in gallery
