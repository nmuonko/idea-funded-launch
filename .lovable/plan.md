

# Instant Homepage Loading: Fix Stale Caches and Auto-Refresh

## Current State

The caching architecture has all the right layers but two critical issues are preventing instant loads:

### Issue 1: Mobile recipe cache is EXPIRED
- `home_cache_mobile_sections` for production was last built **Feb 15** (8 days ago)
- TTL is 7 days (604,800s) -- so it expired and is now stale
- There is **no cron job** calling `home-auto-refresh` to rebuild it automatically
- Result: mobile app users hit a cold path every time, loading takes several seconds

### Issue 2: Cron job points to WRONG project
- The existing `catalog-prewarm-home-12h` cron calls `igmkhxffnyzoogcqvdab.supabase.co` but the actual project is `wydajcvmdoaqvovncotu.supabase.co`
- This means the 12-hour prewarm has been silently failing (hitting a non-existent endpoint)

### Issue 3: No auto-refresh for recipe caches
- `home-auto-refresh` edge function exists and works perfectly -- it checks staleness and rebuilds both mobile and web recipe caches
- But no cron job triggers it, so it never runs automatically

### What already works well
- **Web localStorage cache** (`afrishop_curated:` per category, 1-hour TTL) gives instant rendering on return visits
- **LRU in-memory cache** in `catalogCache.ts` gives sub-1ms repeat lookups within a session
- **Stale-while-revalidate** shows old data instantly while refreshing in background
- **Web recipe cache** (`home_cache_web_feed`) was rebuilt Feb 22 and is still fresh

## Fix Plan

### Step 1: Fix the cron job URL
Update the existing `catalog-prewarm-home-12h` cron to point to the correct project URL (`wydajcvmdoaqvovncotu`).

### Step 2: Add a cron job for `home-auto-refresh`
Create a new cron job that calls the `home-auto-refresh` edge function every 6 hours. This function checks if the mobile/web recipe caches are stale and rebuilds them automatically -- exactly what's missing.

### Step 3: Trigger immediate cache rebuild
Call `home-auto-refresh` manually to rebuild the expired mobile production cache right now, so mobile users get instant loads starting today.

### Step 4: Lower refresh interval
Change `home_refresh_settings` from 168 hours (7 days) to 12 hours for both mobile and web. This ensures the recipe cache stays permanently warm with fresh products, and the 6-hour cron will always catch it before it expires.

## After Fix: How Instant Loading Works

```text
User opens app/website
        |
        v
  [localStorage / LRU cache?] --YES--> Render instantly (<1ms)
        |                                  |
        NO (first visit)                   Background refresh
        |                                  (silent, non-blocking)
        v
  [Backend recipe cache?] --YES--> Render fast (~200ms)
        |                            (pre-built JSON, no DB queries)
        NO (should never happen)
        |
        v
  [Live DB query] --> Slow (~2-3s)
```

With the cron running, the "NO (should never happen)" path truly never happens.

## Technical Details

### Database migration
```sql
-- Fix cron URL to correct project
SELECT cron.unschedule('catalog-prewarm-home-12h');
SELECT cron.schedule(
  'catalog-prewarm-home-12h',
  '0 */12 * * *',
  $$ SELECT net.http_post(
    url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1/catalog-prewarm-home',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  ); $$
);

-- Add new cron for home-auto-refresh (every 6 hours)
SELECT cron.schedule(
  'home-auto-refresh-6h',
  '30 */6 * * *',
  $$ SELECT net.http_post(
    url := 'https://wydajcvmdoaqvovncotu.supabase.co/functions/v1/home-auto-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-cron-key', 'afrishop-internal-cron-2026'
    ),
    body := '{}'::jsonb
  ); $$
);

-- Lower refresh interval from 7 days to 12 hours
UPDATE home_refresh_settings
SET mobile_refresh_hours = 12, web_refresh_hours = 12
WHERE env = 'production';
```

### Edge function update
Update `home-auto-refresh/index.ts` to accept the `x-internal-cron-key` header for cron authentication (currently it has no auth check, which is fine for internal calls but should be hardened).

### Files to edit
- `supabase/functions/home-auto-refresh/index.ts` -- add cron auth header validation
- Database migration for cron jobs and refresh settings

### Immediate action after deploy
- Call `home-auto-refresh` to rebuild the stale mobile cache
- Verify both caches are populated via the admin Health page

