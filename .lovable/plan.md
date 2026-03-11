

## Problem Analysis

The screenshot shows a "Backend Warning" dialog on the mobile app with: "Backend connection failed / Not in production mode / Mobile Money unavailable / Card payments unavailable." This is a **payment health check** from the React Native app.

### Root Causes Found

**1. Duplicate `payment_settings` rows causing non-deterministic behavior**
The `payment_settings` table has **two rows** with conflicting values:
- Row `deb44ffd` (newer, Jan 17): `stripe_enabled = false`, `mobile_money_max_usd = 5000`
- Row `9c543883` (older, Jan 14): `stripe_enabled = true`, `mobile_money_max_usd = 3000`

All edge functions (`app-bootstrap`, `mobile-checkout`, `payment-decision`) query with `.limit(1)` — which row they get is non-deterministic. When the `stripe_enabled: false` row is picked, Stripe appears disabled.

**2. Mobile app connecting to staging environment**
The edge function logs show mobile requests use `envUsed=staging` instead of `production`. This triggers the "Not in production mode" warning in the app's health check.

**3. No syntax error exists**
I verified `catalog-category/index.ts` and `catalog-home/index.ts` — there is no duplicate `enrichedItems` declaration. The functions are deploying and executing correctly per the logs.

---

## Plan

### Database Fix: Clean up duplicate payment_settings
- **Delete** the duplicate row (`deb44ffd`) that has `stripe_enabled: false`
- **Update** the remaining row (`9c543883`) to use the higher `mobile_money_max_usd: 5000` limit (preserving the best of both rows)

### Code Fix: Make payment_settings queries deterministic
- In `app-bootstrap/index.ts`: Change `.limit(1).maybeSingle()` to `.order('updated_at', { ascending: false }).limit(1).maybeSingle()` so it always picks the most recently updated row
- In `mobile-checkout/index.ts` and `payment-decision/index.ts`: Same fix — add `.order('updated_at', { ascending: false })` before `.limit(1)`

### Deploy
- Redeploy `app-bootstrap`, `mobile-checkout`, `payment-decision`

---

## Technical Details

The `payment_settings` table has no `environment` column, so there's no way to differentiate rows by env. The correct fix is to consolidate to a single row and ensure all queries are deterministic with `ORDER BY updated_at DESC`.

The "Not in production mode" warning is likely triggered by the mobile app sending requests that resolve to staging. This is controlled by the React Native app's environment detection (not in this web repo), but ensuring the backend returns correct payment configuration will resolve the payment-related warnings.

