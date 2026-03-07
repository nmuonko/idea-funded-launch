

## Status: Consolidation is Partial — Routers Exist but Old Functions Not Removed

The refactor created **9 thin router functions** that proxy requests to the original granular functions via `forwardToFunction()`. The frontend was updated to call these routers. However, **all ~155 original individual functions still exist** as separate folders under `supabase/functions/`, meaning Lovable Cloud is deploying **~164 functions total** (old ones + new routers).

### What was done
- 9 router functions created: `admin-service`, `auth-service`, `catalog-service`, `email-service`, `mobile-cart`, `mobile-orders`, `payments-core`, `payments-provider`, `support-service`
- Frontend updated to call routers for most operations (315 of ~455 invoke calls use routers)
- Routers use `forwardToFunction()` to internally HTTP-call the original individual functions

### What was NOT done
- **No individual functions were deleted** — all ~155 original folders remain
- **No business logic was inlined** into routers — they're pure HTTP proxies
- **~140 invoke calls** in the frontend still call standalone functions directly (e.g., `mobile-checkout`, `mobile-request-quote`, `admin-apply-vehicle-quote`, `saved-cart-reminders`, `create-referrer`, `ai-order-assistant`, `reloadly-topup`, `admin-rebuild-home`, `health`, etc.)

### The problem
Since the routers just proxy to the originals via HTTP, **both must be deployed**. This means function count actually increased. The routers add latency (extra HTTP hop) without reducing sprawl.

### What true consolidation would require

**Phase 1 — Inline router-proxied logic** (~60 functions): Move the business logic from functions like `admin-order-action`, `admin-delete-order`, `send-order-email`, `mobile-get-cart`, etc. directly into their respective router's `index.ts`. Then delete the old folders.

**Phase 2 — Route remaining standalone calls through routers** (~20 functions): Functions still called directly from the frontend (like `mobile-checkout`, `admin-apply-vehicle-quote`, `saved-cart-reminders`) need to either be absorbed into a router or kept as standalone.

**Phase 3 — Delete unused functions**: Any function no longer called by frontend, cron, or another function can be removed.

This is a large-scale refactor (~60-80 function inlines + deletions) that would need to be done in batches to avoid breaking the live app. Want me to proceed with a phased plan for this?

