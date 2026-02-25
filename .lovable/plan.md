

## Fix: CarGurus/Carvana Scraper Returning 0 Items

### Root Cause (confirmed from live logs)

The scraper **is getting data** from Firecrawl -- Stage A returns **32,472 bytes of markdown** and **30 links**. The markdown parser finds **21 title+price combos** from the text. However, **all 21 are dropped** with reason `missing_url` because none of the 30 returned links match the strict URL filter patterns (`/vehicle/`, `/listing/`, `inventoryListing`, `listingId=`, `/vdp/`).

CarGurus links returned by Firecrawl use different URL patterns (e.g., `/Cars/`, `#listing/`, query-based patterns) that don't match the hardcoded filters.

After Stage A yields 0 usable listings, Stage B times out (18s), then the free fallback gets blocked (403). Total: ~19 seconds wasted, 0 results.

### Solution: Use Firecrawl Search API Instead of Site Scraping

Instead of scraping CarGurus/Carvana directly (which fights anti-bot protections and requires fragile HTML parsing), use **Firecrawl's Search endpoint** (`/v1/search`) to search the open web for listings. This:
- Bypasses anti-bot blocking entirely (no direct site scraping)
- Returns structured results with titles, URLs, and descriptions
- Is faster (no render waiting needed)
- Provides real listing URLs that work

### Implementation Details

**File: `supabase/functions/catalog-car-scraper/index.ts`**

1. Add a new **primary stage** using Firecrawl Search API:
   - Query: `"tesla model 3 site:cargurus.com"` (or `site:carvana.com`)
   - Extract title, price, URL from search results
   - Each result includes `url`, `title`, `description` -- parse price from description
   - Optionally use `scrapeOptions: { formats: ['markdown'] }` to get page content for richer extraction
   - Limit to `target_items` results to minimize API usage

2. Keep existing Stage A (markdown scrape) as **fallback** if search returns insufficient results, but fix the URL matching:
   - Broaden the URL filter to accept any link containing the provider domain (not just specific path patterns)
   - If no listing URLs match, generate synthetic URLs from the provider domain + product IDs found in markdown

3. Keep Stage B (heavy extract) as last resort but reduce its timeout to 12s

4. Remove the free direct-fetch fallback for car providers (it's consistently blocked and wastes time)

5. Add price extraction from search result descriptions using existing `parseUsd` helper

**File: `src/pages/admin/CatalogCache.tsx`**

6. Update the error/success toast to show the actual mode used and diagnostics from the response (already partially done, just needs the search mode label)

### Technical Flow (after fix)

```text
Request: "tesla model 3" on CarGurus
  |
  v
Stage 0 (NEW - Primary): Firecrawl Search
  POST /v1/search { query: "tesla model 3 site:cargurus.com", limit: 10 }
  -> Returns structured results with real URLs, titles, descriptions
  -> Parse prices from descriptions
  -> If enough results -> done (fast, ~3-5s)
  |
  v (if insufficient)
Stage A (Fallback): Firecrawl Markdown Scrape (with relaxed URL matching)
  -> Broader URL filter + synthetic URL generation
  |
  v (if still insufficient)  
Stage B (Last Resort): Firecrawl Extract (12s timeout)
```

### Expected Outcome
- Fetches should return actual car listings (non-zero)
- Response time drops from ~19s to ~3-8s for the common case
- No more "Provider blocked" errors since we're not hitting anti-bot systems
- Clear diagnostics if search returns no results

