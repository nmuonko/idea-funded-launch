## Edge Function Consolidation Refactor — In Progress

### Completed: Batches 1–7 (Router Creation) + Batch 8 (Admin & Support) + Batch 9 (Cart & Orders) + Batch 10 (Auth & Profile)

#### Batch 10: Auth & Profile Inlined — 8 Functions Deleted
- **`auth-service`** — 8 standalone functions INLINED and DELETED:
  - `auth-register`, `auth-login`, `auth-me`, `auth-check-verified`, `auth-resend-verification`
  - `mobile-profile`, `mobile-profile-update`, `update-profile`

#### Batch 9: Cart & Orders Inlined — 11 Functions Deleted
- **`mobile-cart`** — 7 standalone functions INLINED and DELETED
- **`mobile-orders`** — 4 standalone functions INLINED and DELETED

#### Batch 8: Admin & Support Inlined — 13 Functions Deleted
- **`admin-service`** — 10 standalone functions INLINED and DELETED
- **`support-service`** — 3 standalone functions INLINED and DELETED
- **`catalog-service`** — Already inlined in Batch 7

**Net reduction so far: 32 Edge Functions deleted**

### Remaining: Routers still using proxy pattern
- **`email-service`** — proxies 25 send-* functions
- **`payments-core`** — proxies 9 functions
- **`payments-provider`** — proxies 10 functions

### Phase 2 (future): ~20 standalone functions still called directly from frontend
### Phase 3 (future): Delete any unused orphan functions
