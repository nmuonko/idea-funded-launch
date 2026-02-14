

# Add eBay Product Variants

## Problem

eBay products never show variant selectors (Color, Size, Style) because the backend `normalizeItemDetail` function in `ebayAdapter.ts` does not extract variant data from the eBay API response.

## How eBay Variants Work

The eBay Browse API uses a two-step approach for multi-variation items:

1. `getItem` returns a `primaryItemGroup` field containing an `itemGroupHref` URL
2. Calling that URL (`getItemsByItemGroup`) returns all variation members with their images, prices, and dimension values (e.g., Color: Red, Size: Large)

Currently, the codebase uses `primaryItemGroup` only for extracting additional images -- it completely ignores the `itemGroupHref` and never fetches variant members.

## Technical Plan

### File: `supabase/functions/_shared/ebayAdapter.ts`

**Change 1: Update `CatalogItem` type to include variants**

Add a `variants` field to the eBay adapter's `CatalogItem` interface (line 21-35) matching the shape used by catalog-product:

```typescript
export interface CatalogItem {
  // ... existing fields
  variants?: Array<{
    asin?: string;       // reuse 'asin' field for eBay itemId
    title?: string;
    dimensions?: Array<{ name: string; value: string }>;
    image?: string;
    link?: string;
    price?: { value: number; currency: string };
    isCurrent?: boolean;
  }>;
}
```

**Change 2: Add `fetchItemGroupVariants` function**

Create a new helper that calls the eBay `getItemsByItemGroup` endpoint:

```typescript
async function fetchItemGroupVariants(
  token: string,
  itemGroupHref: string,
  currentItemId: string,
  marketplace: string
): Promise<CatalogItem["variants"]>
```

This function will:
- Call the `itemGroupHref` URL with the existing OAuth token
- Parse the response `items` array
- Extract each item's `itemId`, `title`, `image`, `price`, and variation aspects (`localizedAspects` or `itemGroupAdditionalImages`)
- Map eBay's variation aspects into `dimensions` (e.g., `[{name: "Color", value: "Red"}]`)
- Mark the current item with `isCurrent: true`
- Limit to 30 variants max (same as Amazon)

**Change 3: Update `normalizeItemDetail` to extract variants**

After the existing image extraction (line 725), add variant extraction:

```typescript
// Extract variants from item group if available
let variants: CatalogItem["variants"] = undefined;
if (item.primaryItemGroup?.itemGroupHref) {
  // Need a token to fetch - get it from the outer scope or parameter
  variants = await fetchItemGroupVariants(
    token, 
    item.primaryItemGroup.itemGroupHref,
    item.itemId,
    marketplace
  );
}
```

Then include `variants` in the returned object.

**Change 4: Thread `token` and `marketplace` through to `normalizeItemDetail`**

The function signature needs updating to receive the OAuth token:

```typescript
async function normalizeItemDetail(
  item: any, 
  supabase?: any,
  token?: string,
  marketplace?: string
): Promise<CatalogItem>
```

Update callers at lines 535 and 692 to pass the token.

### File: `supabase/functions/catalog-product/index.ts`

**No changes needed** -- the eBay live fetch section (line 600) already includes `variants` in the response if `item.variants` is populated, and the caching logic at line 618-621 already handles caching eBay variants.

## eBay `getItemsByItemGroup` Response Shape

The API returns:

```json
{
  "items": [
    {
      "itemId": "v1|123|456",
      "title": "iPhone 15 - Red",
      "image": { "imageUrl": "..." },
      "price": { "value": "999.00", "currency": "USD" },
      "localizedAspects": [
        { "name": "Color", "value": "Red" },
        { "name": "Storage", "value": "128GB" }
      ]
    },
    ...
  ]
}
```

Each item maps to one variant option with its specific color/size/etc.

## Expected Behavior After Fix

| eBay Product | Before | After |
|---|---|---|
| Multi-variation listing | No variant selectors | Shows Color, Size, Style selectors |
| Single item listing | No variant selectors | No variant selectors (correct - no variants) |
| Variant click | N/A | Optimistic update (uses existing Amazon variant logic) |

## Files Modified

- `supabase/functions/_shared/ebayAdapter.ts` -- add variant type, fetch function, and extraction in normalizeItemDetail
- No frontend changes needed (per the no-frontend-modification rule, and the existing variant UI already works for any provider)

