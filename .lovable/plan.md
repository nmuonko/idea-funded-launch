

## Plan: Point Web App to New Supabase Project

### Current State
- **82 files** import `supabase` from `@/integrations/supabase/client` (auto-generated, cannot edit)
- **16 files** reference `VITE_SUPABASE_URL` directly for edge function URLs
- New project `ecqpqtirhpumfgbdtvhh`: **162 edge functions deployed**, **21 secrets set**, **542k+ catalog items** — all good

### What Needs to Change

**Step 1: Create custom Supabase client** (`src/lib/supabaseClient.ts`)
- Hardcode the new project URL (`https://ecqpqtirhpumfgbdtvhh.supabase.co`) and its anon key
- Import `Database` types from existing `@/integrations/supabase/types`
- Same auth config (persistSession, autoRefreshToken)

**Step 2: Update all 82 file imports**
- Change `from '@/integrations/supabase/client'` → `from '@/lib/supabaseClient'`

**Step 3: Update edge function URL references**
- In `src/lib/api.ts`, `SearchResults.tsx`, `ProductDetails.tsx`, `ShopCartContext.tsx`, `PaymentSuccess.tsx`, `AcceptInvite.tsx`, `Orders.tsx`, `OrderDetail.tsx`, `PaymentProvidersContent.tsx` — replace `import.meta.env.VITE_SUPABASE_URL` with the new project's URL constant
- Update `SupabaseConfigGuard.tsx` and `supabaseHealth.ts` accordingly

**Step 4: Clean up diagnostics**
- Update `main.tsx` dev logging to reflect new config

### What's Already Done (No Action Needed)
- Edge functions: 162 deployed on new project
- Secrets: 21 configured (EBAY, STRIPE, PAWAPAY, RAINFOREST, RESEND, etc.)
- Database: catalog_items at parity, RLS policies active, RPC functions exist
- pg_cron: 18 jobs already pointing to new project URL

### Risks & Rollback
- **Auth sessions will reset** — users must log in again (different auth project)
- **Rollback**: one find-and-replace to revert imports back to `@/integrations/supabase/client`

