

# Home Recipes: Unified Curation System for Mobile + Web

## Overview

Replace the current fragmented curation system (home_sections, home_section_seeds, mobileSectionsCache, catalog_home_cache) with a unified **home_recipes** system that cleanly manages both mobile (10 sections) and web (10 pages of 100 items = 1000 pool) through a single admin interface with two "Rebuild Now" buttons.

## Current State (Problems)

1. **Mobile** uses `catalog_home_mobile_sections_cache` (single JSON row) rebuilt ad-hoc from a mixed pool + sectionProfiles keyword filtering. This causes category bleeding and inconsistent item counts.
2. **Web** uses `catalog_home_cache` (a flat items array). No recipe-based control.
3. **Prewarm worker** reads from `home_sections` + `home_section_seeds` tables, writes to `catalog_cache` rows -- but these cached results are NOT read by `catalog-home` for serving. The two systems are disconnected.
4. **Admin Home Curation page** manages `home_sections`/`home_section_seeds` but the prewarm output never reaches the mobile cache.
5. Multiple overlapping cache tables create confusion.

## Architecture Changes

### Phase 1: Database (Migration)

**New tables:**

- `home_recipes` -- one row per mobile section (10) + one row per web page (10) = 20 rows
- `home_recipe_seeds` -- queries for each recipe (~6-12 per recipe)
- `home_cache_mobile_sections` -- single JSON cache row per env (replaces `catalog_home_mobile_sections_cache`)
- `home_cache_web_feed` -- single JSON cache row per env (replaces web portion of `catalog_home_cache`)
- `home_refresh_settings` -- per-env refresh hours + schema versions

**RLS:**
- Cache tables: public SELECT, admin-only write
- Recipe tables + settings: admin-only all operations

**Trigger:** `updated_at` auto-update on `home_recipes`

**Seed data:**
- 10 mobile recipes with 6-12 seed queries each (phones, electronics, vehicles, gaming, clothing, home_garden, toys, sporting_goods, refurbished, parts_accessories)
- 10 web page recipes (page_1 through page_10) with mixed queries
- Default refresh settings (12h mobile, 12h web)

### Phase 2: Shared Builder Module

**New file:** `supabase/functions/_shared/homeRecipeBuilder.ts`

Two exported functions:

**`buildMobileHomepage(env, opts)`**
- Reads enabled mobile recipes from `home_recipes` (target='mobile') in sort order
- For each recipe, runs its enabled seeds against eBay Browse API and/or catalog_items DB
- Each section is built FROM ITS OWN SEEDS ONLY (no cross-category filtering)
- Vehicles: enforces min_price from recipe (default 1500)
- Returns payload matching exact mobile response shape: `{ok, sections[{key, title, title_en, title_fr, items[]}], page, pageSize, hasMore, meta}`
- Items mapped to existing SectionItem schema (id, title, imageUrl, priceUsd, provider, productUrl, etc.)

**`buildWebHomepage(env, opts)`**
- Reads enabled web recipes (target='web', page_1..page_10)
- Each page recipe contributes ~100 items from its seeds
- Combines into 1000-item pool
- Returns payload matching exact web response shape: `{ok, sections[{key:"featured", items}], page, pageSize, totalPages, hasMore, meta}`

Both functions read `home_refresh_settings` for TTL calculation.

### Phase 3: Update catalog-home + catalog-home-v2

**Mobile path change:**
- Replace the current flow (read catalog_home_mobile_sections_cache -> rebuild from pool + sectionProfiles) with:
  1. Read `home_cache_mobile_sections` for env
  2. Check built_at + ttl_seconds + schema_version against `home_refresh_settings`
  3. If fresh: return payload directly
  4. If stale/missing: call `buildMobileHomepage()`, upsert cache, return
  5. Staging->production fallback preserved
  6. DB bootstrap fallback preserved (never "Catalogue Indisponible")

**Web path change:**
- Replace current flow (read catalog_home_cache -> buildFullFeed with hardcoded segments) with:
  1. Read `home_cache_web_feed` for env
  2. If fresh: slice items for requested page, return
  3. If stale/missing: call `buildWebHomepage()`, upsert cache, return
  4. Page slicing: page=N, pageSize=100, totalPages=10

**Response shapes are 100% unchanged** -- same JSON structure, same field names, same CORS headers.

### Phase 4: Admin Page `/admin/home-recipes`

**Two cards:**

**A) Mobile Homepage Card:**
- Editable `mobile_refresh_hours` field + Save button
- "Rebuild Mobile Homepage Now" button (calls edge function)
- Table of 10 mobile recipes: enable toggle, title_en, title_fr, min/max price, provider toggles
- "Edit Seeds" button per recipe opens modal: list seeds with add/remove/weight/enable

**B) Web Homepage Card:**
- Editable `web_refresh_hours` field + Save button
- "Rebuild Web Homepage Now" button (calls edge function)
- Table of 10 page recipes (page_1..page_10) with "Edit Seeds" modal
- page_1 highlighted as "Most Important"

### Phase 5: Rebuild Edge Functions

**New functions:**
- `admin-rebuild-home/index.ts` -- single function, accepts `{target: "mobile"|"web", env: "production"}`. Admin-only (verify JWT + user_roles). Calls `buildMobileHomepage` or `buildWebHomepage`, upserts appropriate cache table. Returns result summary.

### Phase 6: Auto-Refresh

**New function:** `home-auto-refresh/index.ts`
- Reads `home_refresh_settings` for the given env
- Checks if mobile cache is stale (built_at + ttl exceeded) and mobile_enabled is true -> rebuild
- Checks if web cache is stale and web_enabled is true -> rebuild
- Idempotent, safe to call from cron
- Accepts cron-secret or admin auth

## Files Created/Modified

### New Files
1. `supabase/migrations/YYYYMMDD_home_recipes.sql` -- tables, RLS, seed data
2. `supabase/functions/_shared/homeRecipeBuilder.ts` -- build engine
3. `supabase/functions/admin-rebuild-home/index.ts` -- rebuild endpoint
4. `supabase/functions/home-auto-refresh/index.ts` -- auto refresh
5. `src/pages/admin/HomeRecipes.tsx` -- admin page

### Modified Files
6. `supabase/functions/catalog-home/index.ts` -- use new caches
7. `supabase/functions/catalog-home-v2/index.ts` -- use new caches
8. `src/App.tsx` -- add route
9. `src/components/layout/AdminLayout.tsx` -- add sidebar link
10. `supabase/config.toml` -- new function configs (verify_jwt=false)

### NOT Modified
- Mobile app (Replit) -- zero changes
- Web UI rendering components (ShopHome.tsx etc.) -- zero changes
- Search endpoints -- zero changes
- Cart/checkout/payment flows -- zero changes
- Existing sectionProfiles.ts, titleNormalizer.ts -- kept as fallback but no longer primary

## Non-Regression Guarantees

- Response shapes identical (verified by matching existing interfaces)
- CORS headers unchanged
- Mobile detection logic unchanged
- Environment normalization unchanged
- Error fallback behavior unchanged (always ok:true for mobile)
- Web pagination behavior unchanged (page param, pageSize=100)
- Product object mapping fields compatible (id, title, imageUrl, priceUsd, provider, productUrl, in_stock)

## Technical Details: Recipe Builder Item Fetching

The builder reuses existing infrastructure:
- **eBay**: Direct Browse API calls (same as current `fetchEbayItems` in catalog-home)
- **Amazon/DB**: Query `catalog_items` table filtered by seed query keywords (same as current `backfillForProfile`)
- **Rainforest API**: Optional for live refresh (budget-checked, same as prewarm worker)

For each recipe seed query, the builder:
1. Queries catalog_items with `title.ilike.*{query}*` 
2. Optionally calls eBay Browse API for fresh items
3. Deduplicates, applies min/max price filters from recipe
4. Maps to standard item schema

This avoids the fragile keyword-matching approach of sectionProfiles.ts (where "car" matches "carplay") because items are fetched by seed query intent, not post-hoc classified.

