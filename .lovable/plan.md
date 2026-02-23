

# Fix: Cached Products Showing "~0 total"

## Root Cause

The `admin-catalog-items` edge function is **not deployed** -- it returns a 404 error. The database has **22,480 items**, but neither the primary path (edge function) nor the fallback (direct DB query) is surfacing the count because:

1. The edge function call fails with 404
2. The error is caught, and the DB fallback runs
3. The DB fallback likely succeeds but a subtle issue with the query result propagation keeps the count at 0

## Fix

### Step 1: Deploy `admin-catalog-items` edge function
This is the primary fix. The function exists in code at `supabase/functions/admin-catalog-items/index.ts` but was never deployed. Once deployed, the `mode=summary` endpoint will return `total_count: 22480` directly.

### Step 2: Harden the DB fallback in `SummaryCards`
Add explicit error logging to the fallback path so if the edge function ever goes down again, we can see exactly what happens. Also ensure the fallback query result is never silently swallowed.

### Files to change
- **Deploy**: `admin-catalog-items` edge function
- **Edit**: `src/pages/admin/CatalogCache.tsx` -- add `console.log` in the fallback path to confirm it runs and what count it gets

This should immediately fix the "~0 total" display.

