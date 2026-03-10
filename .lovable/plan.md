## Edge Function Consolidation Refactor — Phase 3 Complete

### Phase 3: Orphan Deletion — 10 Functions Deleted
- **`create-referrer`** — routed via auth-service
- **`execute-ai-action`** — routed via admin-service
- **`get-ai-actions-for-review`** — routed via admin-service
- **`predict-customer-ltv`** — routed via admin-service
- **`ai-order-assistant`** — routed via admin-service
- **`catalog-categories`** — inlined into catalog-service
- **`catalog-tabs`** — inlined into catalog-service
- **`catalog-nav`** — inlined into catalog-service
- **`catalog-providers`** — inlined into catalog-service
- **`catalog-refresh`** — inlined into catalog-service (prewarm action)

### Phase 2: Standalone Frontend Calls Routed — 11 calls redirected
- **`mobile-orders`** — added `checkout` (→ mobile-checkout) and `request_quote` (→ mobile-request-quote)
- **`admin-service`** — added `predict_ltv`, `ai_actions_review`, `execute_ai_action`, `ai_order_assistant`, `reloadly_topup`
- **`auth-service`** — added `create_referrer`
- **`email-service`** — added `saved_cart_reminders`

### Batches 1–10: Inlined — 32 Functions Deleted
- **Batch 10**: auth-service (8 functions)
- **Batch 9**: mobile-cart (7), mobile-orders (4)
- **Batch 8**: admin-service (10), support-service (3)
- **Batch 7**: catalog-service (5 metadata endpoints)

**Total reduction: 42 Edge Functions deleted**

### Kept as Proxy (by decision)
- **`payments-core`** — proxies 9 functions (complex payment logic)
- **`payments-provider`** — proxies 10 functions (payment provider logic)
- **`email-service`** — proxies 25 send-* functions (HTML template code)

### Remaining Standalone (active, not orphaned)
- **Frontend-called**: extract-price, health, admin-apply-vehicle-quote, admin-rebuild-home, catalog-search, catalog-home, catalog-product, catalog-offers, catalog-collection, app-bootstrap, mobile-public-config, mobile-checkout, chat, referral-on-verify, catalog-data-sync, cars-search, cars-add-to-cart
- **Mobile-only**: recently-viewed-*, register-device-token, track-store-visit, mobile-get-shipping-types, mobile-request-quote, request-vehicle-quote, submit-price-confirmation, get-my-price-confirmations, public-shipping-config, product-resolver, claim-guest-confirmations, submit-support-message, support-send-message
- **Cron/webhooks**: auth-email-hook, payment-callback, pawapay-callback, payments-webhook, send-cart-reminder-emails, catalog-amazon-ingest-worker, catalog-car-scraper, catalog-shein-scraper, home-auto-refresh, cleanup-expired-*, escalate-tickets, saved-cart-reminders
- **Admin utilities**: backfill-*, admin-seed-default-catalog, admin-catalog-items, admin-home-*, admin-search-rewrites, admin-auto-learning, admin-confirm-price, admin-review-price-confirmation, admin-refresh-category, admin-set-product-image
- **Internal/AI**: ai-command-center, smart-cart-recovery, smart-recommendations, smart-ticket-analysis, analyze-submission, notify-new-submission, transcribe-audio, invalidate-settings-cache, market-*-proxy, catalog-filters, catalog-category
- **Proxy targets**: All send-* (25), payment-decision, payment-status, payments-check-intent, payments-create-intent, mobile-verify-payment, verify-payment, mobile-retry-payment, reconcile-payment-status, generate-payment-receipt, select-payment-provider, get-payment-providers, update-payment-provider, admin-set-active-provider, admin-test-provider, pawapay-create-payment, pawapay-verify-payment, stripe-create-checkout-session, stripe-verify-checkout-session, mobile-create-payment
