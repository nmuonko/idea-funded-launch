

# Root Cause: Two Issues Found

## Finding 1: `auth-me` Edge Function Does Not Exist

The Replit audit shows the mobile app calls `GET /functions/v1/auth-me` at startup (call #6 in the chain, from `src/api/auth.ts:195`). **There is no `auth-me` edge function in this project.** The Supabase gateway returns a 401/404 error for this call. The mobile app likely interprets this as "Backend connection failed", which cascades into showing all warnings (catalog unavailable, payment unavailable, etc.).

Only `auth-service` exists, which uses POST with `action: "me"` — a completely different contract.

## Finding 2: Echo of `env: "staging"` Triggers "Not in Production Mode"

The latest fix echoes `env: "staging"` back in response bodies to match what the mobile sends. But the mobile app's health check almost certainly requires `env === "production"` to consider the backend healthy. The error message "Not in production mode" directly confirms this — the app sees `env: "staging"` and flags it as a problem.

**Evidence from live logs:**
- Real device `48553513-ff5f-4044-a408-90b9fa36bbac` (okhttp/4.12.0) is hitting all endpoints
- All responses return 200 with valid data
- `mobile-public-config` returns `responseEnv: staging` — yet the app still shows errors
- `catalog-home` returns 327 items in 10 sections — valid data, but labeled `envUsed: staging`

## Fix Plan

### Step 1: Create `auth-me` Edge Function

Create `supabase/functions/auth-me/index.ts` as a thin compatibility shim that:
- Handles GET requests (mobile contract)
- If valid Bearer token: extracts user, fetches profile, returns user data
- If no/invalid token: returns `{ ok: true, authenticated: false }` (HTTP 200, not 401)
- Uses `buildCorsHeaders` / `corsPreflightResponse` from `_shared/mobileCors.ts`
- Add to `config.toml` with `verify_jwt = false` (validate JWT in code)

### Step 2: Revert Env Echo — Always Return `env: "production"`

Undo the echo fix across all endpoints. The mobile app's health check requires `env === "production"`:

- **`mobile-public-config/index.ts`**: Remove `getRequestedEnv` usage, set `env: "production"` in all response paths
- **`catalog-categories/index.ts`**: Set `env: "production"` instead of `responseEnv`
- **`mobileSectionsCache.ts`**: Set `meta.envUsed` to `"production"` instead of `envRequested`
- **`catalog-home/index.ts`**: Pass `"production"` through response labeling

The internal data resolution stays on production (via `getEnvironmentFromRequest` override). Only the response label changes.

### Step 3: Deploy All Modified Functions

Deploy: `auth-me`, `mobile-public-config`, `catalog-categories`, `catalog-home`, plus any shared modules.

### Step 4: Test Full Mobile Startup Chain

Simulate the exact mobile startup sequence with `okhttp` headers, `x-device-id`, and `?env=staging`:
1. `GET /mobile-public-config?env=staging` → expect `env: "production"`, `catalogEnabled: true`
2. `GET /catalog-categories?env=staging` → expect `env: "production"`, valid tabs
3. `GET /catalog-home?env=staging&page=1&pageSize=20&mode=auto` → expect `envUsed: "production"`, items
4. `GET /auth-me` (no token) → expect 200, `authenticated: false`
5. `GET /app-bootstrap?env=staging` → expect 200, payments configured

### Files to Change

- **Create**: `supabase/functions/auth-me/index.ts`
- **Edit**: `supabase/functions/mobile-public-config/index.ts` (revert echo)
- **Edit**: `supabase/functions/catalog-categories/index.ts` (revert echo)
- **Edit**: `supabase/functions/_shared/mobileSectionsCache.ts` (revert echo)
- **Edit**: `supabase/config.toml` (add auth-me entry)

### Why Previous Fixes Failed

1. **Env override fix** (force production data): Correct for data, but response still showed env values that triggered warnings
2. **Env echo fix** (return "staging"): Wrong direction — the mobile health check requires `env === "production"`, not matching the request
3. **Missing `auth-me`**: Never addressed — the function simply doesn't exist, causing auth startup to fail and cascade into all other warnings

