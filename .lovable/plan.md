# Option B — Unify mobile + web homepage feed

Make the frozen mobile app render the **exact same products in the exact same order** as the web app, sourced from a single cache. Removes the divergent code paths that cause banner placeholders and different product sets on mobile.

## Root cause

The mobile homepage currently has **three competing sources**:
1. `mobile-public-config.home.sections` → frozen app reads independent collections (`electronics_trending`, `best_sellers_electronics`, `deals_electronics`).
2. `catalog-home` strict_sections cache (`n_mobile_sections_cache`) — separately curated.
3. `catalog-home` web recipe cache — what the web actually shows.

Web app uses #3 with the homepage image policy + 725-ID Amazon banner blocklist. Mobile usually hits #1/#2, which lack those filters → banner placeholders + different ordering.

## Changes

### 1. `supabase/functions/catalog-home/index.ts`
- Capture `originalClientType` before forcing `clientType = "web"` for mobile homepage requests.
- **Delete the entire `if (clientType === "mobile")` block** (~lines 1602-1723) covering: strict_sections call, recipe-cache primary read, recipe-cache stale fallback. All three are gone.
- Keep the `else { /* WEB recipe cache */ }` branch but remove the `else` wrapper so it runs unconditionally.
- After the response is built (in the `serve()` wrapper at the bottom), if `originalClientType === "mobile"`, run the body through `flattenMobilePayload(body, locale, true)` to:
  - Strip `banners`, `promos`, `ads`, `hero`, `promotions`
  - Drop imageless items via `hasValidImage()`
  - Merge sections into a single `for_you` section preserving order
  - Set `meta.client = "mobile"`, `meta.flattened = true`
- Remove now-unused imports/helpers (`serveMobileSections`, `readMobileCache` if unused elsewhere — keep if referenced by Tier 3 bootstrap).

### 2. `supabase/functions/_shared/mobileSectionsCache.ts`
- Bump `MOBILE_SECTIONS_SCHEMA_VERSION` (currently 27 → 28) so any old cached payloads are invalidated and ignored on read.

### 3. `supabase/functions/mobile-public-config/index.ts`
- Replace `home.sections` (3 sections: trending/best/deals) with **one** section:
  ```ts
  { key: "for_you", label_fr: "Pour vous", label_en: "For you",
    collectionKey: "web_homepage_mirror", maxItems: 60 }
  ```
- The frozen app already renders sections from this config; one section = continuous grid.
- Leave `collections` map intact for backward compatibility but the frozen app will now mostly call `catalog-home` directly via the bootstrap config.

### 4. Cache invalidation
After deploy, trigger `catalog-prewarm-home` once to repopulate the web cache so mobile immediately gets fresh items.

## Validation

Two parallel curls must return the same item IDs in the same order (page 1):
```
curl ".../catalog-home?client=web&page=1"          → sections[0].items[*].id
curl ".../catalog-home?client=mobile&flat=1&page=1" → sections[0].items[*].id
```
IDs and order must match. Mobile response also has `meta.client="mobile"`, `meta.flattened=true`, and zero entries in `banners/promos/ads`.

## Non-regression guarantees

- Frozen-app contract preserved: HTTP 200 + JSON shape (`{ok, sections, meta}`) unchanged.
- Categories (`?category=phones` etc.) still hit the per-recipe web cache — unaffected.
- Section browse (`?section=...`) still delegates to `catalog-category` — unaffected.
- Tier 3 DB bootstrap still runs if cache is empty (prevents "Catalogue Indisponible").
- Web app unchanged — same code path, same response.

## Files touched
- `supabase/functions/catalog-home/index.ts`
- `supabase/functions/_shared/mobileSectionsCache.ts`
- `supabase/functions/mobile-public-config/index.ts`
