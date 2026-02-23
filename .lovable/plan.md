
# Deploy All Edge Functions

## Problem

The project has approximately 170 edge functions in `supabase/functions/`, but only ONE (`admin-catalog-items`) is registered in `supabase/config.toml`. Without `verify_jwt = false` in the config, the platform's default JWT verification rejects requests before they even reach the function code -- causing 401 or 404 errors across the entire backend.

Every function already handles authentication manually in code (via `verifyAndGetUser`, `getClaims`, `getUser`, or custom header checks), so the platform-level JWT check is redundant and broken with the signing-keys system.

## Fix

### Step 1: Register all ~170 functions in `supabase/config.toml`

Add a `[functions.<name>]` entry with `verify_jwt = false` for every function directory under `supabase/functions/` (excluding `_shared/` which is a shared library, not a deployable function).

This is the complete list (168 functions):

```text
accept-invitation, admin-ai-assistant, admin-apply-vehicle-quote,
admin-auto-learning, admin-backfill-unified-categories, admin-bootstrap-catalog,
admin-bulk-delete-orders, admin-cache-clear, admin-catalog-items,
admin-catalog-settings, admin-confirm-price, admin-delete-order,
admin-get-carts, admin-home-sections, admin-home-seed-suggestions,
admin-home-seeds, admin-invite-user, admin-order-action,
admin-rebuild-home, admin-refresh-category, admin-reset-section,
admin-review-price-confirmation, admin-search-relevancy-run,
admin-search-rewrites, admin-seed-default-catalog, admin-set-active-provider,
admin-set-product-image, admin-system-health, admin-test-provider,
admin-update-item-status, ai-command-center, ai-order-assistant,
analyze-submission, app-bootstrap, auth-check-verified, auth-login,
auth-me, auth-register, auth-resend-verification, backfill-cart-images,
backfill-product-images, cars-add-to-cart, cars-search, cart-guest-snapshot,
cart-sync-from-client, catalog-categories, catalog-category,
catalog-collection, catalog-debug-search, catalog-debug, catalog-filters,
catalog-health, catalog-home-legacy, catalog-home-v2, catalog-home,
catalog-nav, catalog-offers, catalog-prewarm-home, catalog-prewarm-worker,
catalog-product, catalog-providers, catalog-refresh-seeded,
catalog-refresh-worker, catalog-refresh, catalog-search,
catalog-smoke-home, catalog-smoke-product, catalog-tabs, chat,
claim-guest-confirmations, cleanup-expired-caches, cleanup-expired-carts,
cleanup-expired-data, create-bank-transfer-view-link,
create-manual-transfer-session, create-payment-link, create-referrer,
debug-ebay-item, debug-ebay, escalate-tickets, execute-ai-action,
extract-price, generate-payment-receipt, get-ai-actions-for-review,
get-bank-transfer-settings, get-bank-transfer-view,
get-manual-transfer-page, get-my-price-confirmations,
get-payment-providers, get-product-info, health, home-auto-refresh,
invalidate-settings-cache, market-item-details-proxy,
market-search-proxy, merge-guest-cart, mobile-add-cart-item,
mobile-checkout, mobile-create-order-from-cart, mobile-create-payment,
mobile-delete-cart-item, mobile-get-cart, mobile-get-order-by-id,
mobile-get-orders, mobile-get-shipping-types, mobile-health,
mobile-order-status, mobile-profile-update, mobile-profile,
mobile-public-config, mobile-request-quote, mobile-retry-payment,
mobile-update-cart-item, mobile-verify-payment,
notify-large-bank-transfer, notify-new-submission,
notify-support-agent, pawapay-callback, pawapay-create-payment,
pawapay-diagnostics, pawapay-health, pawapay-verify-payment,
payment-callback, payment-decision, payment-health, payment-status,
payments-check-intent, payments-create-intent, payments-webhook,
predict-customer-ltv, product-resolver, public-shipping-config,
recently-viewed-list, recently-viewed-upsert,
reconcile-payment-status, referral-on-verify, register-device-token,
reloadly-topup, request-vehicle-quote, saved-cart-reminders,
search-expand-query, select-payment-provider,
send-abandoned-cart-emails, send-abandoned-cart-recovery,
send-admin-payment-notification, send-application-emails,
send-confirmation-email, send-customer-email,
send-delivery-notification, send-feedback-email,
send-fraud-alert-email, send-order-assistance-email,
send-order-confirmation, send-order-delivered-email, send-order-email,
send-order-processing-email, send-order-shipped-email,
send-payment-confirmation-email, send-payment-confirmation,
send-push-notification, send-quote-email,
send-quote-response-notification, send-shipping-notification,
send-shipping-update, send-test-email, send-ticket-notification,
smart-cart-recovery, smart-recommendations, smart-ticket-analysis,
stripe-create-checkout-session, stripe-health,
stripe-verify-checkout-session, submit-bank-transfer-proof,
submit-price-confirmation, submit-support-message,
support-chat-bot, support-send-message, support-start,
track-store-visit, transcribe-audio, update-payment-provider,
update-profile, upload-manual-transfer-proof, verify-maisha-payment,
verify-payment, web-maisha-callback
```

### Step 2: Deploy all functions

After updating the config, trigger a batch deployment of all 168 functions. Due to the project's scale (~170 functions), deployment may need to happen in batches to avoid timeouts.

## Technical Details

### File: `supabase/config.toml`

Replace the current 4-line file with a complete config that registers every function. The format is:

```toml
project_id = "wydajcvmdoaqvovncotu"

[functions.accept-invitation]
verify_jwt = false

[functions.admin-ai-assistant]
verify_jwt = false

... (repeated for all 168 functions)
```

### Deployment note

Given the project's known scale constraints (~170 functions causing deployment timeouts), the deployment will be done in batches of ~40 functions at a time to maximize reliability.

## Summary
- **Edit**: `supabase/config.toml` -- add all 168 function entries with `verify_jwt = false`
- **Deploy**: All 168 edge functions in batches
