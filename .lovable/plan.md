## Edge Function Consolidation Refactor — In Progress

### Completed: Batches 1–7 (Router Creation) + Batch 8 (Inlining)

#### Batch 8: True Inlining — Business Logic Moved Into Routers
- **`admin-service`** — 10 standalone functions INLINED and DELETED:
  - `admin-order-action`, `admin-delete-order`, `admin-bulk-delete-orders`, `admin-update-item-status`
  - `admin-invite-user`, `admin-system-health`, `admin-get-carts`, `admin-ai-assistant`
  - `admin-reset-section`, `admin-catalog-settings`
- **`support-service`** — 3 standalone functions INLINED and DELETED:
  - `support-start`, `support-chat-bot`, `notify-support-agent`
- **`catalog-service`** — Already inlined in Batch 7 (no proxy)

**Net reduction: 13 Edge Functions deleted** (business logic now lives directly in routers)

### Remaining: Routers still using proxy pattern
- **`auth-service`** — proxies 8 functions (`auth-register`, `auth-login`, `auth-me`, `auth-check-verified`, `auth-resend-verification`, `mobile-profile`, `mobile-profile-update`, `update-profile`)
- **`email-service`** — proxies 25 send-* functions
- **`mobile-cart`** — proxies 7 functions (`mobile-get-cart`, `mobile-add-cart-item`, `mobile-update-cart-item`, `mobile-delete-cart-item`, `cart-sync-from-client`, `merge-guest-cart`, `cart-guest-snapshot`)
- **`mobile-orders`** — proxies 4 functions (`mobile-create-order-from-cart`, `mobile-get-orders`, `mobile-get-order-by-id`, `mobile-order-status`)
- **`payments-core`** — proxies 9 functions
- **`payments-provider`** — proxies 10 functions

### Phase 2 (future): ~20 standalone functions still called directly from frontend
### Phase 3 (future): Delete any unused orphan functions
