

## Fix: Register `catalog-data-sync` in config.toml

### Root Cause
The `catalog-data-sync` edge function is **missing from `supabase/config.toml`**. Without this registration, the function never gets deployed, so the old (or non-existent) version runs and the export is stuck at 1,000 items.

### Changes

#### 1. `supabase/config.toml`
Add the missing function entry:
```toml
[functions.catalog-data-sync]
verify_jwt = false
```

This single line will cause the function to be deployed with the current POST-based pagination code that already exists in `supabase/functions/catalog-data-sync/index.ts`.

### After the Fix
1. The function auto-deploys once registered
2. Go to Test admin panel and click **"Export All Items (JSON)"**
3. The export will now paginate through all ~28 pages and download the full ~27,728 items

### Files to modify
- `supabase/config.toml` -- Add `[functions.catalog-data-sync]` with `verify_jwt = false`

