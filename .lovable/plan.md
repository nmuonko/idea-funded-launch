## Web App → New Supabase Project (ecqpqtirhpumfgbdtvhh) — DONE

### What Was Done

1. **Created `src/lib/supabaseClient.ts`** — Custom client with hardcoded production URL and anon key
2. **Added Vite alias in `vite.config.ts`** — Redirects all `@/integrations/supabase/client` imports to the custom client at build time (avoids touching 99 files)
3. **Added TypeScript path alias** in `tsconfig.json` and `tsconfig.app.json` for type resolution
4. **Updated 14 files** that directly referenced `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY`:
   - `src/lib/api.ts`
   - `src/lib/catalogCache.ts`
   - `src/lib/supabaseHealth.ts`
   - `src/components/SupabaseConfigGuard.tsx`
   - `src/main.tsx`
   - `src/contexts/ShopCartContext.tsx`
   - `src/pages/AcceptInvite.tsx`
   - `src/pages/Cars.tsx`
   - `src/pages/PaymentSuccess.tsx`
   - `src/pages/admin/Orders.tsx`
   - `src/pages/admin/OrderDetail.tsx`
   - `src/pages/admin/PaymentProvidersContent.tsx`
   - `src/pages/shop/SearchResults.tsx`
   - `src/pages/shop/ProductDetails.tsx`
   - `src/pages/shop/CardPayment.tsx`

### Rollback
To revert: remove the alias from `vite.config.ts` and `tsconfig*.json` files. All imports will resolve back to the auto-generated client.

### Notes
- Auth sessions will reset — users must log in again
- The auto-generated `src/integrations/supabase/client.ts` is untouched but bypassed via alias
