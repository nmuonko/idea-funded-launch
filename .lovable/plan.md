

# Rewire Car Scraper: Firecrawl-Primary with Free Fallback

## Overview

The current `catalog-car-scraper` edge function uses free HTML parsing as primary and Firecrawl as fallback. Since you have a Firecrawl account (now connected), we'll flip this: **Firecrawl becomes the primary scraper** because it reliably renders JavaScript-heavy pages (Carvana, CarGurus) and extracts structured data via its JSON extraction format. Free HTML parsing becomes the fallback for when the Firecrawl API key is missing or quota is exhausted.

## What Changes

### 1. Rewrite `catalog-car-scraper` scraping order

**File: `supabase/functions/catalog-car-scraper/index.ts`**

Current flow: free parse first -> Firecrawl fallback
New flow: **Firecrawl first -> free parse fallback**

- Default `mode` changes from `"free-first"` to `"firecrawl-first"`
- Mode options become: `"firecrawl-first"` (default), `"force-firecrawl"`, `"force-free"`
- `FIRECRAWL_API_KEY` is read via `Deno.env.get('FIRECRAWL_API_KEY')` (already available from the connector)
- If Firecrawl returns 0 listings or errors, fall back to free HTML parsing
- Response `mode_used` reflects which method actually produced results

### 2. Improve Firecrawl extraction quality

In the existing `firecrawlScrape()` function:
- Add `waitFor: 5000` (CarGurus/Carvana are JS-heavy)
- Improve the JSON extraction prompt to be more specific about car fields
- Add `onlyMainContent: true` to reduce noise
- Map extracted data to `catalog_items` format with `attributes_json.source = "firecrawl"`

### 3. Keep everything else the same

No changes needed to:
- Provider un-deprecation (already done in `priceResolver.ts` and `cartHelpers.ts`)
- Provider filter UI (already added to `SearchResults.tsx`)
- Admin manual trigger (already in `CatalogCache.tsx`)
- Upsert logic, auth, jitter delays, budget tracking

## Technical Details

### Updated main handler logic (pseudocode)

```text
1. Read FIRECRAWL_API_KEY from env
2. Determine mode:
   - "firecrawl-first" (default): Try Firecrawl, fall back to free
   - "force-firecrawl": Firecrawl only, error if no key
   - "force-free": Free only (no Firecrawl)
3. If mode includes Firecrawl and key exists:
   -> Call firecrawlScrape() with search URLs
   -> If listings found, upsert and return
4. If Firecrawl failed/skipped:
   -> Call freeScrape() as fallback
   -> Upsert whatever is found
5. Return response with mode_used, counts, sample
```

### Firecrawl call (already using correct API)

The existing code already calls `https://api.firecrawl.dev/v1/scrape` with:
- `Authorization: Bearer ${FIRECRAWL_API_KEY}`
- JSON extraction schema for car listings
- This is correct and uses your Firecrawl account

Only change: increase `waitFor` and refine the extraction prompt.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-car-scraper/index.ts` | Flip default mode to Firecrawl-primary; improve extraction params |

This is a single-file change since all the supporting infrastructure (provider activation, UI filters, admin triggers) was already implemented.

