
# Increase Mobile App Search Results from 20 to 100

## Problem
The mobile app (Android/iOS) reads `categoryPageSize: 20` from the backend config on startup, then uses that value as the `limit` parameter when calling `catalog-search`. This means only 20 results are returned per search. Since the mobile app build is frozen (no new .aab), the fix must be entirely backend-side.

## Fix

### Change 1: Update `mobile-public-config` (backend config endpoint)
**File:** `supabase/functions/mobile-public-config/index.ts`

- Change `categoryPageSize` from `20` to `100` (matches the backend's `MAX_LIMIT`)
- This value is read by the frozen mobile app on startup and used as the search page size
- The change takes effect immediately for all mobile users without an app update

### What stays the same
- `homePageSize` stays at `20` (home sections should stay compact)
- `catalog-search` backend already supports up to `MAX_LIMIT = 100`, so no changes needed there
- No mobile app rebuild required
