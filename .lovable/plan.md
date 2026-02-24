

## Fix: "Start Fetching" Button Disabled Due to eBay Rate Limit

### Root Cause

The "Start Fetching" button is **not broken** -- it is intentionally **disabled** because the eBay provider is currently marked as unhealthy in the database.

Current health status:
- Provider: `ebay`
- Status: `unhealthy` (429 rate limited)
- Consecutive failures: 52
- Unhealthy until: **2026-02-24 05:10 UTC** (~59 minutes from now)

The button code explicitly disables itself when eBay is unhealthy:
```
disabled={isFetching || (provider === 'ebay' && !ebayHealthy)}
```

### Options

#### Option A: Wait ~59 minutes
The cooldown will expire automatically and the button will re-enable.

#### Option B: Manually reset the health status (recommended)
Run a database migration to reset eBay's health status so the button works immediately:

```sql
UPDATE provider_health_status
SET healthy = true,
    consecutive_failures = 0,
    reason = NULL,
    unhealthy_until = NULL,
    updated_at = now()
WHERE provider = 'ebay';
```

Then refresh the `/admin/catalog-cache` page. The button will be clickable again.

**Note:** eBay may rate-limit again quickly if their API is still throttling requests. The 52 consecutive failures suggest eBay's API is actively rejecting calls right now.

### Files to modify
- No code changes needed -- this is a data/state issue, not a code bug
- One database update to reset `provider_health_status` for eBay
