

# Fix: Catalog Email Report Value Discrepancy

## Problem
The daily email report estimates total catalog value by sampling only 1,000 item prices and extrapolating. This produces wildly inaccurate numbers ($414M vs the real $229M) because the sample is not representative of the full catalog.

The dashboard already uses the correct approach: the `get_catalog_price_stats()` database function which computes an exact `SUM()` and `AVG()` across all active items.

## Fix
Replace the sampling approach in the email report with the same RPC function the dashboard uses.

### File: `supabase/functions/catalog-daily-report/index.ts`

**Current (broken)**: Lines 40-48 fetch 1,000 prices and estimate:
```
supabase.from("catalog_items").select("price_usd")...limit(1000)
// then: avgPrice * activeCount = inflated estimate
```

**New (accurate)**: Call the existing `get_catalog_price_stats` RPC:
```
supabase.rpc("get_catalog_price_stats")
// Returns exact { total_value, avg_price } from SUM/AVG across all rows
```

Changes:
1. Replace the `valueSampleRes` query with an RPC call to `get_catalog_price_stats`
2. Read `total_value` and `avg_price` directly from the RPC result instead of estimating
3. Remove the sampling/estimation logic (lines 57-63)
4. Change the email label from "Est. Total Value" to "Total Catalog Value" since it's now exact

No other files need changes. The dashboard is already correct.

