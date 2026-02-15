
# Fix Plan: Payment Flow Issues (5 Items)

## Issue 1: `select-payment-provider` Returns 4xx/5xx Instead of HTTP 200

**Problem**: This function returns HTTP 400, 404, 410, 500, 503 for application-level errors. This violates the project's "Never 4xx/5xx" mobile API standard, causing generic fetch failures on mobile clients instead of localized error messages.

**Affected lines** (in `select-payment-provider/index.ts`):
- Line 72: `}, 400)` (missing checkout session)
- Line 83: `}, 400)` (invalid provider)
- Line 94: `}, 400)` (phone required)
- Line 114: `}, 404)` (session not found)
- Line 145: `}, 400)` (invalid session status)
- Line 163: `}, 410)` (session expired)
- Line 339: `}, 500)` (create attempt error + raw error leak)
- Line 387: `}, 503)` (provider not available)
- Line 398: `}, 503)` (secrets missing)
- Line 501: `}, 400)` (pawapay failed)
- Line 520: `}, 503)` (config missing)
- Line 528: `}, 500)` (pawapay exception)
- Line 553: `}, 400)` (USD required)
- Line 566: `}, 503)` (stripe not available)
- Line 655: `}, 500)` (stripe failed)
- Line 673: `}, 500)` (stripe exception)
- Line 761: `}, 400)` (unknown provider)
- Line 775: `}, 500)` (catch-all)

**Fix**: Change all non-2xx status codes to `200`. Add `ok: false` field to every error response for consistency. Keep `success: false` for backward compatibility.

---

## Issue 2: Raw Error Messages Leaked to Client

**Problem**: Several locations expose raw database/provider error strings to the client, which is a security risk (exposes internal structure) and violates the error sanitization standard.

**Locations in `select-payment-provider/index.ts`**:
- Line 338: `error: createAttemptError.message` -- raw DB error sent to client
- Line 498: `message: depositResult.error || 'Mobile money payment failed.'` -- raw pawaPay error used as user message

**Locations in `mobile-checkout/index.ts`**:
- Line 739: `error: stripeResult.error || 'Failed to create Stripe payment intent.'` -- raw Stripe error
- Line 753: `error: stripeError.message` -- raw exception message
- Line 763: `error: 'Card payment provider not configured.'` -- internal config detail

**Fix**: Replace all raw error leaks with generic bilingual messages. Log the raw error server-side only. Use the existing `sanitizePaymentError()` helper where applicable.

---

## Issue 3: `mobile-checkout` Returns 4xx/5xx for Application Errors

**Problem**: Same issue as #1 but in `mobile-checkout/index.ts`. Several error paths return HTTP 400, 410, 500, 503 instead of 200.

**Key affected lines**:
- Line 543: `}, 410)` (session not found)
- Line 558: `}, 400)` (session already completed)
- Line 581: `}, 410)` (session expired by time)
- Line 601: `}, 400)` (payment method not supported)
- Line 664: `}, 400)` (card payments disabled)
- Line 741: `}, 500)` (Stripe init failed)
- Line 753: `}, 500)` (Stripe exception)
- Line 763: `}, 503)` (card not available)
- Line 841: `}, 400)` (no valid preference)
- Line 895: `}, 400)` (empty cart)
- Line 970: `}, 400)` (profile incomplete)
- Line 993: `}, 400)` (phone required)

**Fix**: Change all to HTTP 200 with `ok: false` in the JSON body. Same pattern as Issue 1.

---

## Issue 4: `pawapay-callback` Signature Verification is Incomplete

**Problem**: The `verifySignature` function (line 324-382) checks that HTTP headers are present and the `keyId` matches a fetched public key, but does NOT perform actual cryptographic verification of the signature. The comment on line 373-376 explicitly says "For now... we'll trust it." This means any request with the correct header format and a valid-looking `keyId` would pass verification.

**Fix**: Implement full RFC-9421 signature verification:
1. Parse the `Signature-Input` header to extract covered components (e.g., `@method`, `@target-uri`, `content-digest`)
2. Reconstruct the signature base string from those components
3. Import the public key (RSA/ECDSA as specified by `algorithm` field)
4. Verify the signature cryptographically using `crypto.subtle.verify()`
5. If crypto verification fails, fall back to IP allowlist check (existing behavior)

This is the most complex change and requires careful testing against pawaPay's sandbox.

---

## Issue 5: Delete Legacy `mobile-initiate-maisha-payment` Edge Function

**Problem**: This function still exists at `supabase/functions/mobile-initiate-maisha-payment/index.ts` (616 lines). It contains hardcoded payment limits ($5,000 USD / 30M CDF) and references to the removed MaishaPay provider. It is no longer called from the primary checkout flow (replaced by `select-payment-provider`), but remains deployed and accessible.

**Fix**: Delete the `supabase/functions/mobile-initiate-maisha-payment/` directory and remove the deployed function. Also remove the legacy `web-maisha-callback` function if it is no longer in use (needs verification against `config.toml` and any remaining references).

---

## Summary of Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/select-payment-provider/index.ts` | All error responses changed to HTTP 200 with `ok: false`; raw error messages replaced with generic bilingual strings |
| `supabase/functions/mobile-checkout/index.ts` | All error responses changed to HTTP 200 with `ok: false`; raw error leaks sanitized |
| `supabase/functions/pawapay-callback/index.ts` | Full RFC-9421 cryptographic signature verification implemented in `verifySignature()` |
| `supabase/functions/mobile-initiate-maisha-payment/` | Directory deleted |

## Implementation Order

1. Issues 1 + 2 together (select-payment-provider -- response stability + error sanitization)
2. Issue 3 (mobile-checkout -- response stability + error sanitization)
3. Issue 5 (delete legacy function -- low risk, high cleanup value)
4. Issue 4 (pawapay-callback signature -- highest complexity, requires sandbox testing)

## Risk Assessment

- Issues 1-3: Low risk. Only changes HTTP status codes and error message strings. No logic changes.
- Issue 5: Low risk. Function is unused by current flows.
- Issue 4: Medium risk. Cryptographic implementation must match pawaPay's exact signing algorithm. Recommend testing in sandbox before production deployment.
