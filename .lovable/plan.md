

## Fix Car Scraper Quality + Make Vehicles Searchable

### Issues Identified

1. **Sold/expired vehicle links**: The Firecrawl Search API returns web-indexed results that may include sold/expired listings. The scraper does not filter these out.
2. **Count not respected**: User requests 10, gets 21. The `targetItems` cap is applied in Stage 0, but Stages A and B keep appending beyond the target.
3. **Links not pointing to detail pages**: Some URLs point to search result pages or the provider homepage instead of individual vehicle detail pages (VDP).
4. **Synthetic/fake URLs**: Stages A and B generate synthetic URLs like `https://www.cargurus.com/listing/md-0` which don't resolve to real pages.
5. **Search on afrishop-usa.com excludes vehicles**: The `search_catalog_items_ranked` database function hardcodes `WHERE ci.provider IN ('amazon', 'ebay')`, so cached CarGurus/Carvana items never appear in user searches.

---

### Plan

#### 1. Fix the search function to include car providers (database migration)

Update `search_catalog_items_ranked` to include `cargurus` and `carvana` in the provider filter so vehicle searches on the main site return cached car listings.

```sql
-- Change: provider IN ('amazon', 'ebay')
-- To:     provider IN ('amazon', 'ebay', 'cargurus', 'carvana')
```

Also update the home/section queries in these files that hardcode `provider=in.(amazon,ebay)`:
- `supabase/functions/_shared/sectionProfiles.ts` (line 318)
- `supabase/functions/_shared/mobileSectionsCache.ts` (line 158)
- `supabase/functions/_shared/mobileCatalogHandler.ts` (line 380)
- `supabase/functions/catalog-home/index.ts` (line 480)
- `supabase/functions/catalog-home-v2/index.ts` (line 337)

These will be updated to `provider=in.(amazon,ebay,cargurus,carvana)`.

#### 2. Fix count enforcement in scraper (`catalog-car-scraper/index.ts`)

- After Stage 0 completes, trim `allListings` to `targetItems` before proceeding.
- Only enter Stage A/B if `allListings.length < targetItems`.
- After each stage, enforce `allListings = allListings.slice(0, targetItems)`.
- Final upsert uses only the trimmed list.

#### 3. Filter out sold/expired listings (`catalog-car-scraper/index.ts`)

Add sold/expired detection in the search result parser (Stage 0) and markdown parser (Stage A):
- Drop listings where the title or description contains keywords: "sold", "no longer available", "expired", "off market", "pending sale", "unavailable".
- Track drops with `dropReasons["sold_or_expired"]`.

#### 4. Validate detail-page URLs (`catalog-car-scraper/index.ts`)

- In Stage 0 (search results): Validate that URLs point to individual listing/vehicle pages, not search/listing pages. For CarGurus, valid VDP URLs contain `/listing/` or a numeric ID param. For Carvana, valid VDP URLs contain `/vehicle/`. Drop URLs that are clearly search pages (contain `inventorylisting`, `cars?`, or end at the root path).
- Remove synthetic URL generation entirely from Stages A and B. If a listing has no real detail-page URL, drop it with reason `no_detail_url` instead of fabricating a fake link.

#### 5. Improve search query for better results (`catalog-car-scraper/index.ts`)

Refine the Firecrawl search query to target active/available listings:
- Change query from `"tesla model 3 site:cargurus.com"` to `"tesla model 3 for sale site:cargurus.com"` to bias toward active listings rather than sold/review pages.

---

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-car-scraper/index.ts` | Count cap, sold filter, URL validation, remove synthetic URLs, improve query |
| DB migration (new) | Update `search_catalog_items_ranked` to include car providers |
| `supabase/functions/_shared/sectionProfiles.ts` | Add car providers to `provider=in.(...)` |
| `supabase/functions/_shared/mobileSectionsCache.ts` | Add car providers to `provider=in.(...)` |
| `supabase/functions/_shared/mobileCatalogHandler.ts` | Add car providers to `provider=in.(...)` |
| `supabase/functions/catalog-home/index.ts` | Add car providers to `provider=in.(...)` |
| `supabase/functions/catalog-home-v2/index.ts` | Add car providers to `provider=in.(...)` |

### Expected Outcome
- Requesting 10 cars returns exactly 10 (or fewer if insufficient valid results exist).
- All returned links open real vehicle detail pages on the provider site.
- Sold/expired vehicles are filtered out before storage.
- Searching "tesla model 3" on the main site returns cached CarGurus/Carvana vehicles alongside Amazon/eBay results.

