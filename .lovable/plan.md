
# Fix: Trigger Web Recipe Cache Rebuild

## Root Cause

The seeds and min_price were updated correctly in the test database, but:

1. The **recipe web cache** (`home_cache_web_feed`) is **empty** -- it was never rebuilt after the seed changes
2. When the recipe cache is empty, `catalog-home` **falls back to the legacy cache** (`catalog_home_cache`), which contains 891 stale items from Feb 6 -- all cheap car accessories fetched with the old generic seeds
3. The stale legacy cache keeps getting served because the code serves expired cache as "stale-while-revalidate"

## Fix (3 small changes)

### 1. Clear the stale legacy cache (Database)

Delete the old `catalog_home_cache` entries so the function stops serving stale car accessories as a fallback:

```sql
DELETE FROM catalog_home_cache WHERE true;
```

### 2. Trigger a web recipe rebuild

Call the `home-auto-refresh` edge function (or `buildWebHomepage`) to populate `home_cache_web_feed` with items matching the new specific seeds ("iPhone 15 Pro Max", "MacBook Pro", etc.) filtered at `min_price_usd >= 25`.

### 3. Also apply changes to Production database

The **production** database still has:
- `min_price_usd = NULL` (no price filter)
- Old generic seeds ("iPhone", "Samsung Galaxy", etc.)
- Two duplicate homepage recipes

After publishing, run these SQL updates in the Live environment:
- Set `min_price_usd = 25` on homepage recipes
- Replace old seeds with specific ones
- Clear both caches
- Trigger rebuild

## Technical Steps

| Step | Action |
|------|--------|
| Clear test legacy cache | `DELETE FROM catalog_home_cache` |
| Trigger test rebuild | Call `home-auto-refresh` edge function |
| Verify test preview | Check Accueil tab shows phones/laptops/TVs instead of car mounts |
| Publish to production | Deploy code changes |
| Update production DB | Run seed/price SQL updates in Live environment |
| Clear production cache | Delete both cache tables in Live |
| Trigger production rebuild | Call `home-auto-refresh` on production |

No code file changes are needed -- only database cleanup and cache rebuild.
