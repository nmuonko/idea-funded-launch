
Root-cause analysis

- The strongest evidence is that the new handoff flow is not being executed at all on the path your installed Android app is using:
  - `mobile-checkout-bridge` has no recent logs.
  - `checkout-handoff-validate` has no recent logs.
  - `public.checkout_handoff_tokens` exists but currently has `0` rows.
- That means the reinstall bug is not being caused by the handoff token validation logic itself. The failure happens earlier, before the bridge flow starts.
- Your installed app is therefore still following an older production checkout path that bypasses:
  - `mobile-checkout-bridge`
  - `?handoff=...`
  - `useTokenFromUrl`
  - `checkout-handoff-validate`
- So the real issue is contract drift in production: the frozen Android app is still consuming an older backend/web checkout entry, while the newer bridge solution exists only in the current code path and is not yet the actual path hit by the installed app.
- This also matches your note that there is no WebView visible now. If the app were using the intended bridge chain, we would see bridge/handoff activity server-side. We do not.

What to build now

1. Lock the frozen-app entry point
- Identify the exact backend function the Play Store build calls when `Payez maintenant` is tapped.
- Do not assume it is `mobile-checkout-bridge`.
- Trace the currently used production chain, likely through one of:
  - `mobile-checkout`
  - `mobile-orders`
  - `mobile-create-payment`
  - legacy payment/redirect fields consumed by the app

2. Move the bridge into the path the frozen app already uses
- Because the mobile build is frozen, the backend must become backward-compatible.
- The function already called by the installed app must generate the handoff URL automatically.
- Return that handoff URL in the legacy response fields the app already opens, so the app does not need to know about a new endpoint.
- In practice: the existing checkout response should resolve to `/checkout?handoff=...&access_token=...` instead of any older direct checkout/login/payment page URL.

3. Keep the flow fully backward-compatible
- Do not require a new request body from the app.
- Accept the old payload the frozen app already sends.
- Inject the bridge internally on the backend.
- Preserve existing response shape, but ensure every checkout/open URL field points to the handoff URL.

4. Verify the published web app is ready for that URL
- Confirm the published checkout path waits for both:
  - auth hydration complete
  - handoff bootstrap complete
- The current code already shows this intent in `ShopProtectedRoute` and `useTokenFromUrl`, so the next step is to ensure the published/live site is actually on this version.
- If live is behind test, publish the web changes so `/checkout?handoff=...` works in production.

5. Add production-grade tracing only on this flow
- Add logs only to the real frozen-app path:
  - incoming checkout request
  - token source
  - legacy response fields returned
  - whether a handoff row was created
  - exact checkout URL emitted
  - handoff validate success/failure
  - route guard redirect reason
- This will prove whether the installed app is opening the bridged URL or an old URL.

Most likely fix direction

- Do not keep treating this as a frontend auth race first.
- Treat it as a production compatibility bug:
  - frozen app still opens an old checkout/login URL
  - backend must transparently swap that old URL for a handoff URL
  - published web checkout must consume that handoff before redirecting

Concrete implementation plan

1. Trace the real production entrypoint
- Inspect `mobile-checkout`, `mobile-orders`, `mobile-create-payment`, and any legacy compatibility wrappers to find which response field the frozen app uses for navigation.
- Compare that to the new `mobile-checkout-bridge` contract.

2. Add internal handoff generation to the legacy path
- Reuse the existing handoff token table and validation function.
- Inside the legacy checkout function, create the handoff token and build the checkout URL there.
- Populate all legacy “open this page” fields with that bridged URL.

3. Preserve old clients automatically
- Keep existing request schema accepted by the frozen app.
- Keep existing response keys, but repoint them to the bridged URL.
- Avoid introducing a required new endpoint on the app side.

4. Confirm live web readiness
- Verify live/published frontend includes:
  - `useTokenFromUrl` handoff detection
  - `checkout-handoff-validate` call
  - `ShopProtectedRoute` waiting logic
  - `AuthContext` URL session bootstrap
- If not, publish those exact changes.

5. Add checkpoint logging on the actual path
- Backend logs:
  - `[mobile-checkout] payer-tap-chain-start`
  - `[mobile-checkout] bridge-created`
  - `[mobile-checkout] emitted-url`
  - `[checkout-handoff] validate`
  - `[checkout-handoff] consumed`
  - `[checkout-handoff] invalid|expired|already-used`
- Web logs:
  - `[TokenFromUrl] handoff-detected`
  - `[TokenFromUrl] handoff-validate-ok|fail`
  - `[ShopProtectedRoute] redirect-to-login reason=...`

6. Validate with reinstall scenario
- Reinstall app
- Log in
- Tap `Payez maintenant`
- Confirm:
  - legacy checkout endpoint is hit
  - handoff row is created
  - returned/opened URL contains `handoff=`
  - handoff is consumed once
  - checkout loads without redirect to login

Technical notes

- Current evidence does not support “bridge validation bug”.
- Current evidence supports “bridge never reached by production app”.
- The `checkout_handoff_tokens` table and validator already exist, so this is mainly a wiring/compatibility issue.
- The console ref warning in `ShopHome` is unrelated.
- Keep the scope locked to:
  `frozen RN app -> existing checkout endpoint -> internal handoff generation -> published /checkout handoff bootstrap`

Expected outcome after this fix

- The frozen Play Store build works again without needing app changes.
- Reinstall scenarios work because checkout no longer depends on pre-existing browser/web session state.
- The backend transparently upgrades the old app path into the new handoff flow.
