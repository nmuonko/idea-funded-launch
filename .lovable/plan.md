

## Diagnosis Summary

**All backend edge functions are returning HTTP 200 with valid data** when tested directly:
- `catalog-home` → 200, returns 12 sections with 112 items
- `mobile-public-config` → 200, returns correct `catalogApiBaseUrl` pointing to `igmkhxffnyzoogcqvdab`
- `app-bootstrap` → 200, returns payment config

The `environments` table was already fixed by the previous migration (both `production` and `staging` rows now have `catalog_mode = 'native'` and the correct `api_base_url`).

## Root Cause: `config.toml` Project ID Mismatch

The file `supabase/config.toml` line 1 reads:
```
project_id = "ecqpqtirhpumfgbdtvhh"
```
But the actual Lovable Cloud project is `igmkhxffnyzoogcqvdab`. This is a leftover from your backend migration attempt. This file controls how Lovable deploys edge functions. **If the deployment pipeline uses this project ID, functions may have been deployed to the old project (`ecqpqtirhpumfgbdtvhh`) instead of the current one (`igmkhxffnyzoogcqvdab`).**

The functions we're testing via curl may be **stale versions** that were deployed before the migration. Any edits or redeployments since then may have gone to the wrong project.

## Secondary Issue: 7-Day Cache on `catalog-home`

`catalog-home` returns `Cache-Control: public, max-age=604800` (7 days). If any 404 error was returned during the migration window, the Android HTTP cache or any intermediate proxy could be serving the cached 404 for up to 7 days.

## Plan

### Step 1: Redeploy all critical mobile-facing edge functions
Force-redeploy to ensure the current Lovable Cloud project has the latest function code:
- `catalog-home`
- `mobile-public-config`
- `app-bootstrap`
- `catalog-product`
- `catalog-search`
- `catalog-category`
- `mobile-cart`
- `mobile-orders`

### Step 2: Reduce `catalog-home` cache duration
Change `Cache-Control: public, max-age=604800` to `max-age=300` (5 minutes) in `catalog-home/index.ts`. This prevents 404s from being cached for a week.

### Step 3: Add cache-busting headers
Add `Surrogate-Control: no-store` and `Pragma: no-cache` to error responses in `catalog-home` so that failed responses are never cached by any layer.

### Step 4: Verify after deployment
Test each redeployed function via curl to confirm they return 200.

### Technical note on `config.toml`
This file is auto-managed by Lovable Cloud and cannot be edited directly. The stale `project_id` should not affect curl-based testing (which uses the correct project), but may affect automated deployments. The redeployment in Step 1 will ensure functions are on the correct project regardless.

