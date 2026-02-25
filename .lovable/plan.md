

# Route All Ingestion Data to Live Environment

## Problem
Currently, edge functions use `SUPABASE_URL` from their runtime environment. When you trigger scraping or ingestion from the admin panel (which runs in Test), data gets written to the Test database. You want ALL catalog data to always go to Live -- never Test.

## Solution
Store the Live database credentials as secrets and modify all ingestion functions to write catalog data exclusively to the Live database, regardless of which environment triggers them.

## Steps

### 1. Add Two New Secrets
- `LIVE_SUPABASE_URL` = the Live Supabase project URL
- `LIVE_SUPABASE_SERVICE_ROLE_KEY` = the Live service role key

These will be used by all ingestion functions to create a dedicated "write client" for the Live database.

### 2. Create a Shared Helper: `_shared/liveWriteClient.ts`
A small utility that:
- Reads `LIVE_SUPABASE_URL` and `LIVE_SUPABASE_SERVICE_ROLE_KEY` from env
- If both exist, creates and returns a Supabase client pointing to Live
- If missing, falls back to the local `SUPABASE_URL` client (so Live-deployed functions still work normally since they ARE the live environment)

### 3. Modify Ingestion Edge Functions (5 files)
Each function will import the shared helper and use the Live write client for all `catalog_items` upserts:

| Function | Change |
|----------|--------|
| `catalog-car-scraper/index.ts` | Use Live client for `upsertListings()` |
| `catalog-refresh-worker/index.ts` | Use Live client for catalog_items upserts |
| `catalog-amazon-ingest-worker/index.ts` | Use Live client for catalog_items upserts |
| `catalog-prewarm-worker/index.ts` | Use Live client for catalog_items upserts |
| `_shared/ebayFetcher.ts` | Use Live client for catalog_items upserts |

Auth checks and non-catalog reads will still use the local environment client (so admin JWT validation works correctly in both environments).

### 4. Update `catalog-data-sync/index.ts`
The "push-to-live" mode becomes unnecessary since data now goes directly to Live. We'll keep it but also make the `import` mode use the Live write client, so importing from the admin panel also writes to Live.

### 5. Update Admin UI (`CatalogCache.tsx`)
- The summary cards currently query the local (Test) database. Update them to show a note that counts reflect the Test environment, or optionally add a toggle to view Live counts via a read query.
- No changes needed to fetch triggers since the edge functions themselves will handle routing to Live.

## What This Means for You
- Trigger ingestion from Test admin panel --> data goes to Live
- Cron jobs on Live --> data goes to Live (same as before)
- Cron jobs from Test (via `edge_function_base_url` pointing to Live) --> data goes to Live
- The Test `catalog_items` table will stop growing -- only Live accumulates new data
- Summary counts in the admin panel will reflect whichever environment you're viewing from

## Technical Details

### Shared helper (pseudocode)
```text
function getLiveWriteClient():
  liveUrl = Deno.env.get("LIVE_SUPABASE_URL")
  liveKey = Deno.env.get("LIVE_SUPABASE_SERVICE_ROLE_KEY")
  if both exist:
    return createClient(liveUrl, liveKey)
  else:
    // Fallback: we ARE live, use local env
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
```

### car-scraper change (key section)
```text
// In upsertListings(), replace:
//   const supabase = createClient(SUPABASE_URL, ...)
// With:
//   const writeClient = getLiveWriteClient()
//   writeClient.from("catalog_items").upsert(...)
```

Same pattern applied to all 5 ingestion functions.

