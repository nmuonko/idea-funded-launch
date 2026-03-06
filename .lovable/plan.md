## Edge Function Consolidation Refactor — Complete (Batches 1–6)

### Batch 1: Decoupling and Cleanup
- Decoupled `supabaseClient.ts` → uses env vars
- Updated `config.toml` to production project ID
- Removed diagnostic logging from `SupabaseConfigGuard` and `main.tsx`
- Deleted 25 legacy/debug functions

### Batch 2: Cart and Orders → `mobile-cart` (7 actions), `mobile-orders` (4 actions)
### Batch 3: Payments → `payments-core` (8 actions), `payments-provider` (6 actions)
### Batch 4: Email → `email-service` (25 email types)
### Batch 5: Auth/Profile → `auth-service` (8 actions)
### Batch 6: Admin/Support → `admin-service` (10 actions), `support-service` (3 actions)

All use thin router/proxy pattern. Original functions preserved as proxy targets for mobile backward compatibility.

### Remaining
- Batch 7: Catalog consolidation (`catalog-prewarm-home` still called directly)
