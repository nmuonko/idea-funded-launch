
## Fix: Low Result Count for Searches Like "iphone 12"

### Problem
Searching "iphone 12" returns only 43 products because the DB has 43 matching cached items, which falls below the `DB_SUFFICIENT_THRESHOLD` of 50. This causes the system to skip the fast database path and fall through to slow live provider calls (Amazon/eBay), which may time out or return nothing -- leaving the user with just 43 results after a long wait.

### Root Cause
There's a dead zone between the broadening threshold (30) and the DB fast path threshold (50). When DB returns 30-49 items:
- DB fast path does NOT trigger (needs 50+)
- Frontend broadening does NOT trigger (needs fewer than 30)
- System wastes time calling slow live providers instead of instantly returning cached results

### Fix

**Lower `DB_SUFFICIENT_THRESHOLD` from 50 to 20** in `catalog-search/index.ts`.

This ensures that any search returning 20+ cached items from the 75K+ catalog instantly uses the fast path, skipping slow provider calls. The background provider refresh still runs to keep the cache updated.

This is a one-line change that fixes the issue for ALL searches, not just iPhones.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-search/index.ts` | Change `DB_SUFFICIENT_THRESHOLD` from `50` to `20` |
