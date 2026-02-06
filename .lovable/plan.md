
# Fix: Vehicles Showing Toys/Parts — Recipe Cache Not Being Served to Mobile

## Root Cause

The recipe-based cache (which contains correct vehicle items like Honda CR-V, Toyota RAV4, GMC Yukon at $5,500+) is stored under `env=production`. But the mobile app sends `env=staging` in its headers. The recipe cache lookup does NOT fall back to production, so it misses and falls through to the **legacy** mixed-pool keyword-filtering path, which is the original cause of category bleeding (vehicles section gets car lights, backup cameras, etc.).

**Evidence from logs:**
```
[MOBILE_SECTIONS_CACHE] hit=true env=staging schema=4
[CATALOG_HOME] cache_hit client=mobile poolSize=888 cacheEnvUsed=staging
```
The mobile app is being served from the OLD `catalog_home_mobile_sections_cache` (staging), not from the new `home_cache_mobile_sections`.

**Evidence from DB:**
The recipe cache contains 30 vehicle items — all real cars (Honda CR-V $5,500-$31,495, Toyota RAV4 $6,800-$38,500). The builder works correctly. The issue is purely that catalog-home never reaches this data for mobile requests.

## Fix (Surgical, 1 File)

**File:** `supabase/functions/catalog-home/index.ts`

In the recipe cache section (around line 1045-1145), add a production fallback when the requested env has no recipe cache data. This mirrors the existing legacy fallback pattern already at lines 1304-1313.

### Changes:

1. After `readMobileCache(env)` returns empty/miss and `env !== "production"`, try `readMobileCache("production")` as fallback
2. Same for web cache path: after `readWebCache(env)` returns empty and `env !== "production"`, try `readWebCache("production")`
3. Log the fallback so it's observable

```text
// Pseudocode for the mobile path fix:
let mobileCache = await readMobileCache(env);

// Production fallback (same pattern as legacy cache at line 1304)
if ((!mobileCache.hit || !mobileCache.payload) && env !== "production") {
  console.log(`[CATALOG_HOME] recipe_cache_fallback_to_production env=${env}`);
  mobileCache = await readMobileCache("production");
}

// Then proceed with existing freshness + schema version check...
```

### What This Fixes:
- Mobile app (which sends env=staging) will now read from the recipe cache (env=production)
- Vehicles section will show real SUVs/cars from curated seeds instead of mixed-pool keyword-filtered junk
- All 10 sections served from per-section seed builds (no category bleeding)

### What Does NOT Change:
- Response shapes (identical JSON structure)
- Web homepage (already works — sends env=production)
- Cart, checkout, payments — zero changes
- Mobile app code — zero changes
- Legacy fallback still exists as safety net if recipe cache is completely empty

### Deployment:
- Redeploy `catalog-home` and `catalog-home-v2`
- No database migration needed
- No admin UI changes needed
