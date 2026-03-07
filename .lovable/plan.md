## Edge Function Consolidation Refactor — Phase 2 Complete

### Completed: Batches 1–10 (Router Creation + Inlining) + Phase 2 (Routing)

#### Phase 2: Standalone Frontend Calls Routed — 11 calls redirected
- **`mobile-orders`** — added `checkout` (→ mobile-checkout) and `request_quote` (→ mobile-request-quote)
- **`admin-service`** — added `predict_ltv`, `ai_actions_review`, `execute_ai_action`, `ai_order_assistant`, `reloadly_topup`
- **`auth-service`** — added `create_referrer`
- **`email-service`** — added `saved_cart_reminders`

#### Batch 10: Auth & Profile Inlined — 8 Functions Deleted
- **`auth-service`** — 8 standalone functions INLINED and DELETED

#### Batch 9: Cart & Orders Inlined — 11 Functions Deleted
- **`mobile-cart`** — 7 standalone functions INLINED and DELETED
- **`mobile-orders`** — 4 standalone functions INLINED and DELETED

#### Batch 8: Admin & Support Inlined — 13 Functions Deleted
- **`admin-service`** — 10 standalone functions INLINED and DELETED
- **`support-service`** — 3 standalone functions INLINED and DELETED
- **`catalog-service`** — Already inlined in Batch 7

**Net reduction so far: 32 Edge Functions deleted**

### Kept as Proxy (by decision)
- **`payments-core`** — proxies 9 functions (too complex/risky to inline ~3,500 lines of payment logic)
- **`payments-provider`** — proxies 10 functions (same payment complexity concern)
- **`email-service`** — proxies 25 send-* functions (too much HTML template code to inline)

### Remaining Standalone Calls (not routed — kept as-is)
- **`extract-price`** — complex standalone, used by PasteLink tool
- **`health`** — diagnostic endpoint, should stay standalone

### Phase 3 (future): Delete unused orphan functions no longer called by frontend, cron, or other functions
