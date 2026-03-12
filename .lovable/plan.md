
Goal: stop persistent mobile “Catalogue Indisponible” and false backend/payment warning on installed phone builds by fixing startup-chain compatibility (not just individual endpoints).

What I verified from the current backend:
- `catalog-home` mobile requests are reaching backend and resolving `envRequested=staging` -> `envUsed=production` (logs confirm).
- `catalog-categories` also resolves to production for mobile (logs confirm).
- `mobile-public-config` returns production for mobile in many requests, but still sees mixed staging traffic from non-mobile callers.
- `app-bootstrap` has no runtime logs, which strongly suggests phone GET is not reaching handler (likely preflight/header mismatch or legacy path mismatch).
- The legacy `catalog` proxy function has a narrower CORS header allow-list than other mobile endpoints.

Do I know what the issue is?
- Partially yes: the environment override is working in some endpoints, but the real phone still fails because at least one startup call in its exact chain is still incompatible (most likely legacy route/CORS contract mismatch and/or response-shape mismatch for frozen app expectations).

Implementation plan (next execution pass):
1) Add hard startup diagnostics to every startup endpoint
- Files:  
  - `supabase/functions/app-bootstrap/index.ts`  
  - `supabase/functions/mobile-public-config/index.ts`  
  - `supabase/functions/catalog/index.ts`  
  - `supabase/functions/catalog-home/index.ts`  
  - `supabase/functions/catalog-categories/index.ts`
- Log per request: method, path, query, user-agent, `x-device-id`, `x-afrishop-*`, `access-control-request-headers`, resolved env, status, and compact response summary.
- Include a shared correlation/request ID propagated across forwarded calls.

2) CORS hardening for frozen mobile builds (all startup endpoints)
- Replace static fragile allow-lists with dynamic allow-headers handling:
  - Echo `Access-Control-Request-Headers` when present.
  - Keep broad fallback list including current custom mobile headers.
- Ensure OPTIONS always returns 200/204 with the same CORS policy as GET/POST.

3) Legacy-route compatibility hardening
- In `catalog/index.ts`, forward all startup-relevant legacy paths used by frozen builds (not just `/home` etc.) and preserve env/device headers.
- Add explicit logs in this proxy to prove whether phone is hitting `/catalog/...` vs direct function routes.

4) Response-contract compatibility for old mobile validators
- Extend startup payloads with compatibility aliases (without removing current fields), e.g. explicit production booleans and legacy env fields expected by older app logic.
- Keep catalog usable even when payment diagnostics are degraded (payment warning must not collapse catalog availability).

5) End-to-end proof protocol after deploy
- Capture phone-triggered logs for one retry cycle and produce endpoint-by-endpoint table:
  - URL path actually called
  - request headers received
  - preflight pass/fail
  - response status/body key fields
  - resolved environment
  - catalog readiness vs payment readiness outcomes
- Confirm acceptance criteria: no “Catalogue Indisponible”, no false backend warning, catalog loads, production detected, retry recovers without manual DB steps.

Files to change in implementation:
- `supabase/functions/app-bootstrap/index.ts`
- `supabase/functions/mobile-public-config/index.ts`
- `supabase/functions/catalog/index.ts`
- `supabase/functions/catalog-home/index.ts`
- `supabase/functions/catalog-categories/index.ts`
- (optional shared helper) `supabase/functions/_shared/*` for common CORS + request diagnostics
