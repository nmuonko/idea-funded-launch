
# Add Catalog Persistence for Paste-Link Extractions

## What This Does
When a user pastes a link and Firecrawl (or any other method) successfully extracts price/title/image, the result gets saved permanently to the `catalog_items` table. This means the next user who pastes the same link (or searches for that product) gets an instant, zero-credit response from the catalog.

## What Stays the Same
- Rainforest API for Amazon lookups (kept as-is)
- eBay APIs for eBay lookups (kept as-is)
- Direct HTML fetch, mirror scraping, all existing fallbacks (kept as-is)
- Firecrawl as final fallback (already in 3 places, kept as-is)
- Car/vehicle manual quote logic (kept as-is)
- Hot cache and price cache writes (kept as-is)

## What Changes

### Single change: `supabase/functions/extract-price/index.ts`

**Add a `saveToCatalogItems` helper function** that upserts successful extractions into `catalog_items`:

```text
saveToCatalogItems(supabase, {
  store,            // e.g. 'amazon', 'walmart', 'ebay'
  productId,        // extracted via extractProductIdFromUrl()
  url,              // the pasted URL
  price,            // extracted price in USD
  title,            // product title
  imageUrl,         // product image
  source            // 'paste_link'
})
```

Uses `ON CONFLICT (provider, provider_product_id) DO UPDATE` to avoid duplicates and refresh stale data.

**Call it in all 5 existing success paths** (after cache writes, non-blocking):
1. After Rainforest API success (Amazon) -- ~line 1335
2. After mirror scraping success (Amazon) -- ~line 1388
3. After Firecrawl success for Amazon -- ~line 1414
4. After Firecrawl success for HTTP errors -- ~line 1612
5. After Firecrawl success for bot-blocked stores -- ~line 1768

Each call is fire-and-forget (`.catch(() => {})`) so it never blocks the response.

**Skip catalog save when:**
- No product ID can be extracted from the URL (generic/unknown stores)
- Store is a car dealership (carvana, cargurus, tesla_used, edmunds) -- prices change too fast
- Price is zero or missing

## Result

```text
Paste-link fallback chain (unchanged):
1. Hot cache (free)
2. Price cache (free)
3. Catalog lookup (free) <-- NOW POPULATED BY PASTE-LINK
4. Direct fetch / Rainforest / eBay API
5. Mirror scraping
6. Firecrawl (1 credit)
7. Manual input UI

After ANY successful extraction:
- Saved to hot_cache (existing)
- Saved to price_cache (existing)
- Saved to catalog_items (NEW) -- permanent, searchable
```

## Credit Impact
- Zero additional Firecrawl credits used -- this only adds persistence to already-successful extractions
- Over time, the catalog grows organically from user paste-links, reducing future Firecrawl calls to zero for popular products
