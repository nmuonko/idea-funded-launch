

# Fix: Make Paste Link Work for ALL Store Links

## Problem
The Rainforest API for Amazon is timing out (5s limit, but calls take 4.3s+). When it times out, there's no further fallback. For non-Amazon stores that block scraping, only the mirror (r.jina.ai) is tried -- no Firecrawl fallback exists despite the API key being configured.

## Solution
Two changes to the `extract-price` edge function:

### 1. Increase Rainforest timeout (Amazon)
Change the Rainforest API timeout from 5000ms to 8000ms. Logs show successful calls take ~4300ms, so 5000ms is too tight and causes intermittent `AbortError` failures.

### 2. Add Firecrawl as universal fallback (all stores)
Create a new `extractViaFirecrawl2` function that uses the already-connected Firecrawl API to scrape **any** URL (Amazon, eBay, Walmart, etc.) and extract price, title, and image. This replaces the old `extractViaFirecrawl` which only returned a price number.

Insert this fallback into **two places**:
- **Amazon flow**: After Rainforest fails and before returning "not indexed" error
- **Non-Amazon flow**: After mirror scraping fails and before returning "scrape blocked" error

The Firecrawl scrape requests HTML format, then parses it for JSON-LD structured data, Open Graph meta tags, and price patterns -- the same extraction logic already used for direct scraping.

## Fallback Chain (After Fix)

**Amazon links:**
1. Hot cache / price cache lookup
2. Catalog database lookup (ASIN match)
3. Rainforest API live lookup (8s timeout)
4. Mirror scraping (r.jina.ai)
5. **Firecrawl scrape (NEW)**
6. Manual price input UI

**All other stores:**
1. Hot cache / price cache lookup
2. Direct HTML fetch
3. Mirror scraping (r.jina.ai)
4. Catalog database fallback
5. **Firecrawl scrape (NEW)**
6. Manual price input UI

## Technical Details

**File modified:** `supabase/functions/extract-price/index.ts`

- New function `extractViaFirecrawlFull(url, timeout)` -- calls `https://api.firecrawl.dev/v1/scrape` with `formats: ['html']`, then runs `extractFromJsonLd()` + `extractFromMetaTags()` + `extractFromSelectors()` on the returned HTML to get price, title, and image
- Rainforest timeout: `5000` changed to `8000`
- Two insertion points for the Firecrawl fallback before final error responses

No new secrets needed -- `FIRECRAWL_API_KEY` is already configured.

