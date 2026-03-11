

## Current State

### SHEIN Catalog
- **1,298 active SHEIN items** in the database (not 762 — the frontend may be filtering further)
- **Scraper is broken**: The last run scraped 25 categories and extracted **0 products** from every single one. SHEIN's anti-bot protections are blocking Firecrawl.
- Growth has stalled — 1,122 items were added on March 11 (likely from earlier successful runs), but current runs yield nothing.

### Mobile Homepage
- Controlled by `sectionProfiles.ts` — 10 sections (phones, electronics, vehicles, parts, gaming, clothing, home, toys, sports, refurbished)
- Each section returns **20 items** to the mobile client (30 cached)
- Clothing section uses generic keyword matching across ALL providers (amazon, ebay, shein)
- Phones section also pulls from all providers
- No provider-level filtering exists per section

## Plan

### 1. Fix SHEIN Scraper — Switch Extraction Strategy
The current scraper relies on extracting product URLs from Firecrawl HTML, but SHEIN is returning empty/blocked content. Fix by:
- Adding a **Firecrawl JSON/LLM extraction mode** (like the existing `extract-price` Strategy 5) as primary method
- Increasing `waitFor` to 8-10 seconds for JS rendering
- Adding retry with `actions: [{"type": "wait", "milliseconds": 5000}]` to let SHEIN's lazy-loaded content render
- If Firecrawl continues to fail, fall back to **SHEIN API endpoints** (us.shein.com has public JSON APIs like `/api/productList/...`) which return structured data directly

### 2. Update Mobile Homepage — Provider Preferences per Section
Modify `sectionProfiles.ts`:
- **Clothing section**: Add `preferProviders: ["shein"]` and update backfill logic to query `provider=eq.shein` first
- **Phones section**: Change `preferProviders: ["amazon"]` and update backfill to prioritize `provider=in.(rainforest,amazon)`

### 3. Increase Mobile Homepage Item Counts
Modify `mobileSectionsCache.ts`:
- Increase `ITEMS_PER_SECTION_RESPONSE` from **20 → 40**
- Increase `ITEMS_PER_SECTION_CACHE` from **30 → 60**
- Update `minItems` in section profiles to higher values (clothing: 30, phones: 30, others: 20)

### 4. Update Backfill Logic for Provider Filtering
In both `sectionProfiles.ts` and `mobileSectionsCache.ts`, the `backfillForProfile()` function currently queries all providers. Update it to:
- Check `profile.preferProviders` and use that as the primary provider filter in the DB query
- For clothing: query `provider=eq.shein` first, then fall back to other providers if under target
- For phones: query `provider=in.(rainforest,amazon)` first

### 5. Rebuild Mobile Homepage Cache
After deploying changes, trigger a cache rebuild so the mobile app immediately serves the updated sections with SHEIN clothing and Amazon phones.

### Files to Modify
- `supabase/functions/catalog-shein-scraper/index.ts` — Fix extraction strategy
- `supabase/functions/_shared/sectionProfiles.ts` — Update provider preferences and item counts
- `supabase/functions/_shared/mobileSectionsCache.ts` — Increase items per section, update backfill provider filtering

### Expected Outcome
- SHEIN scraper resumes ingesting products toward 3k+ target
- Mobile homepage clothing section shows SHEIN items exclusively
- Mobile homepage phones section shows Amazon phones exclusively
- Each section displays ~40 items instead of 20

