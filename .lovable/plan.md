## Edge Function Consolidation Refactor — Complete (Batches 1–7)

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

All Batches 2–6 use thin router/proxy pattern with in-code JWT auth gates.

### Batch 7: Catalog Metadata → `catalog-service` (5 actions, inlined logic)
- **Consolidated** `catalog-tabs`, `catalog-categories`, `catalog-nav`, `catalog-providers`, `catalog-prewarm-home` into single `catalog-service` router
- **Inlined** all business logic directly (no proxy/fetch overhead)
- **Auth**: `prewarm` requires admin JWT or cron secret; other actions are public read-only
- **Frontend updated**: `CategoryTabs.tsx`, `HomeRecipes.tsx`, `CatalogSourcesSettings.tsx`
- **Kept standalone** (performance-critical, large): `catalog-search`, `catalog-product`, `catalog-home`, `catalog-category`, `catalog-collection`, `catalog-filters`, `catalog-offers`

### Lovable Cloud Migration — Complete
- **admin_settings**: `edge_function_base_url` updated to `igmkhxffnyzoogcqvdab`
- **11 cron jobs**: Unscheduled old → rescheduled to Lovable Cloud URLs
- **`_cron_call_refresh_worker`**: Fallback URL updated to Lovable Cloud
- **Verification**: Zero cron jobs reference old project `ecqpqtirhpumfgbdtvhh`

### Remaining
- Batch 8: Inline business logic into Batches 2–6 routers (eliminate internal fetch overhead)
