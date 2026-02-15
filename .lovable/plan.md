

# Fix: Homepage Shows Wrong Products (Sandbox vs Live Mismatch)

## Root Cause Analysis

The problem has **two layers**:

### 1. Seed Data is NOT Synced Between Environments
- **Test** has 12 homepage seeds (iPhone 15 Pro Max, PlayStation 5, Apple Watch, Nike sneakers, etc.) with proper `sort_order` values (1-12)
- **Live** has only 7 homepage seeds (iPhone, Samsung Galaxy, laptop computer, etc.) with `sort_order = 0` for ALL of them (backfill never ran on Live)
- Database **data never syncs** on publish -- only schema does. So the seeds you configure in the Admin Portal (which writes to Test) never reach Live.

### 2. The Admin "Rebuild" Targets the Wrong Data
- When you click "Rebuild" in the Admin Portal, `admin-rebuild-home` calls `buildWebHomepage("production")`
- This reads seeds from the **same database the edge function runs on** (which is Live/production)
- But the admin UI reads/writes seeds from the **Test** database
- So you're editing seeds on Test but rebuilding cache from Live's old seeds

**Result**: Sandbox shows phones (from Test seeds like "iPhone 15 Pro Max"), Live shows shoes/random items (from Live's old/different seeds).

## Solution

Since the constraint is **no frontend modification**, the fix must happen entirely in the backend:

### A. Sync seed data from Test to Live (one-time manual step)
You need to run a SQL script on the **Live** environment (Cloud View > Run SQL, with Live selected) that copies the current seed configuration from Test. I will generate this script by reading the current Test seed data and producing INSERT/UPDATE statements.

### B. Fix the Admin Portal rebuild to use the correct data source
Currently the admin-rebuild-home edge function always reads seeds from whichever database it runs on. After publish, edge functions run against the Live database. The admin UI also needs to push seed changes to Live when saving.

**Option chosen**: Modify the admin seed save/edit/reorder logic in `HomeRecipes.tsx` to also write seed changes to the Live database via an edge function call, ensuring both environments stay in sync.

### C. Create a `sync-home-seeds` edge function
A new edge function that, when called by the admin UI after any seed change, copies the full seed configuration for a recipe from the calling environment to the target cache rebuild. This ensures "what you see in admin = what shows on live."

## Implementation Steps

### Step 1: New Edge Function `sync-home-seeds`
Create `supabase/functions/sync-home-seeds/index.ts` that:
- Accepts admin auth + recipe_id (or "all")
- Reads all seeds for the given recipe(s) from the database
- Rebuilds the web + mobile cache using `buildWebHomepage` / `buildMobileHomepage`
- This already works correctly since the edge function runs against the same DB it reads seeds from

**The real fix**: The problem is that Test and Live have DIFFERENT seed data. The edge function on Live reads Live seeds, which are old/wrong.

### Step 2: Provide a Data Migration Script for Live
Generate SQL that:
1. Deletes all existing `home_recipe_seeds` on Live for web recipes
2. Inserts the current Test seeds (with correct sort_order, max_items, required_terms, excluded_terms)
3. Triggers a cache rebuild

This must be run manually on Live via Cloud View > Run SQL.

### Step 3: Automate Future Syncs
Modify the `admin-rebuild-home` edge function to accept an optional `seeds` payload. When the Admin Portal triggers a rebuild, it also sends the current seed configuration, and the edge function:
1. Upserts those seeds into the database (so Live always gets the latest seed config)
2. Then rebuilds the cache from those freshly-synced seeds

This means every time admin clicks "Rebuild" or edits seeds, both the seed data AND the cache on Live are updated.

### Step 4: Fix the backfill on Live
The `sort_order` on Live is still all `0`. The data sync in Step 2 will fix this, but we also need to ensure the migration doesn't fail on publish. (This was already addressed by the previous migration consolidation.)

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/admin-rebuild-home/index.ts` | Accept optional `seeds[]` payload; upsert seeds into DB before rebuilding cache |
| `src/pages/admin/HomeRecipes.tsx` | On rebuild, send current seeds alongside the rebuild request so they get synced to Live |
| Manual SQL on Live | Copy current Test seed data to Live database |

## Manual Step Required
After the code changes are published, you will need to run a one-time SQL script on the Live environment to sync the seed data. I will provide this script with the exact INSERT statements based on your current Test configuration.

## Expected Result After Fix
- Admin edits seeds in portal (Test DB) -> clicks Rebuild -> seeds are synced to Live DB -> cache is rebuilt from correct seeds -> Live homepage shows the right products
- No more mismatch between sandbox and live
- Future seed changes automatically propagate to Live on rebuild

