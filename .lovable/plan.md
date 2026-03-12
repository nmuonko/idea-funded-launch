

# Root Cause: Backend Returns `env: "production"` but Mobile App Expects `env: "staging"`

## Evidence

The logs prove ALL endpoints are working and returning 200 OK with valid data:
- `catalog-home`: 327 items in 10 sections, `envUsed=production`
- `catalog-categories`: 10 tabs, 22 subtabs, `env=production`
- `mobile-public-config`: full config with `catalogEnabled=true`, `env=production`

Yet the mobile app still shows "Catalogue Indisponible." The Replit audit confirms the mobile app has `ENV_OVERRIDE = 'staging'` **hardcoded** and sends `?env=staging` with every request.

**The mismatch**: The mobile app sends `env=staging` and likely validates that the response contains `env: "staging"`. Our backend override forces production data but ALSO changes the response `env` field to `"production"`. The mobile app sees `env: "production"` when it expected `"staging"` and rejects the response.

## Fix: Echo `env: "staging"` in Response Bodies for Mobile Requests

Use production data internally, but label the response as `"staging"` to match the frozen mobile app's contract. The data is identical (production data), only the label changes.

### Step 1: `environmentResolver.ts` — Return both internal env and response env

Add a new function `getResponseEnvForMobile()` that returns the original requested env (staging) for use in response bodies, while `getEnvironmentFromRequest()` continues returning "production" for DB queries.

### Step 2: `mobile-public-config/index.ts` — Use "staging" in response body

Change `env: envName` in the response to echo the originally-requested env for mobile clients, so the response contains `env: "staging"` while data comes from production.

### Step 3: `catalog-home` — `serveMobileSections` uses `envRequested` in response meta

The `envRequested` is already passed through but `envUsed` in `meta` shows "production". For mobile, set `meta.envUsed` to `envRequested` so the mobile app sees consistency.

### Step 4: `catalog-categories/index.ts` — Echo requested env in response

Return `env: "staging"` (the requested value) instead of the resolved production env.

### Files to Change

- `supabase/functions/_shared/environmentResolver.ts` — add helper to track original requested env
- `supabase/functions/mobile-public-config/index.ts` — echo requested env in response
- `supabase/functions/_shared/mobileSectionsCache.ts` — use `envRequested` in response meta for mobile
- `supabase/functions/catalog-categories/index.ts` — echo requested env in response
- `supabase/functions/catalog-home/index.ts` — pass through requested env for response labeling

