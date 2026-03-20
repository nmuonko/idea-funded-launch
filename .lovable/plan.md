
Issue restated: after reinstalling the separate React Native app, tapping “Payez maintenant” can still bounce the user back to login even though earlier fixes worked in normal use. That points to a cold-start auth/session restoration problem in the frozen mobile build, not the web app.

What I found:
- `auth-me` is now fixed and its logs show the user authenticates successfully.
- The mobile integration contract says the app signs out on:
  - any HTTP `401`
  - any response body containing JWT-style auth errors
- Several backend payment wrapper endpoints still return raw `401` and require a strict `Bearer ` prefix:
  - `supabase/functions/payments-provider/index.ts`
  - `supabase/functions/payments-core/index.ts`
- Those wrappers do not use the hardened shared auth helper from `supabase/functions/_shared/auth.ts`, which already supports:
  - raw JWTs without `Bearer`
  - alternate auth headers
  - query/body token fallbacks
- This matches the reinstall symptom: first payment request after cold install can happen before the RN session/header is fully restored, so one of these wrappers returns `401`, and the app’s global handler signs the user out.

Do I know what the issue is?
Yes — the remaining regression is most likely in the payment wrapper layer, not in `auth-me` or the web frontend.

Implementation plan:
1. Harden the remaining payment wrapper auth gates
- Update `payments-provider/index.ts` and `payments-core/index.ts` to stop using strict `startsWith('Bearer ')` checks.
- Replace their custom auth parsing with the shared `_shared/auth.ts` token extraction/verification pattern.

2. Eliminate destructive auth responses for frozen mobile builds
- Change those wrapper endpoints to never return raw `401/403` for mobile-facing auth failures.
- Return HTTP `200` with a structured JSON body like:
  - `ok: false`
  - `success: false`
  - `authenticated: false`
  - stable error code such as `AUTH_REQUIRED` / `AUTH_ERROR`

3. Preserve backward-compatible forwarding behavior
- Keep forwarding headers/body exactly as today for downstream functions.
- Ensure raw JWTs and alternate token placements survive wrapper forwarding during cold-start/reinstall flows.

4. Add targeted diagnostics for the next test
- Add compact logs in the two wrapper functions showing:
  - whether a token was found
  - token source (`header`, `query`, `body`)
  - whether auth failed before forwarding
  - which wrapped payment route was hit
- This gives a definitive trace if one more edge case remains.

5. Verify the full payment chain most likely used by the frozen app
- Focus on the wrapper-based flow:
  - `payments-provider` → `select-payment-provider` / `mobile-create-payment`
  - `payments-core` → payment status / retry / verify routes
- Confirm every mobile-facing payment hop now follows the “never 401 to mobile” rule.

Files to change:
- `supabase/functions/payments-provider/index.ts`
- `supabase/functions/payments-core/index.ts`
- possibly small shared-response reuse from `supabase/functions/_shared/auth.ts`

Expected outcome:
- Reinstall/cold-start payment attempts will no longer trigger forced logout if the app sends a raw JWT, delayed session token, or transiently malformed auth header.
- The mobile app should stay signed in and receive a retryable JSON error instead of being redirected to login.

Technical note:
This is the backend equivalent of the “auth not fully ready on first load” problem from mobile clients, but because the `.aab` is frozen, the safe fix is to make the payment wrapper endpoints tolerant to session hydration timing and token formatting differences.
