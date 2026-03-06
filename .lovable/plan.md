

## Plan: Revert Everything to Lovable Cloud

The web app's Vite alias was already removed, but **tsconfig.json** and **tsconfig.app.json** still redirect `@/integrations/supabase/client` to the custom `src/lib/supabaseClient.ts`. This means TypeScript IDE resolution still points to the old file. Additionally, `supabase/config.toml` references the old project ID (but that file is auto-managed and shouldn't be edited). Here's what needs to change:

### Changes

1. **Remove tsconfig path overrides** — In both `tsconfig.json` and `tsconfig.app.json`, remove the `@/integrations/supabase/client` path alias so imports resolve to the real auto-generated Lovable Cloud client.

2. **Delete `src/lib/supabaseClient.ts`** — No longer needed; the auto-generated client at `src/integrations/supabase/client.ts` handles everything.

3. **Fix remaining `SUPABASE_URL` / `SUPABASE_ANON_KEY` imports** — Any file still importing these named exports from the client needs to use `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` directly (already done for most files in prior fixes, but will verify completeness).

4. **Update hardcoded `afrishop-usa.com` in edge functions** — Replace with `Deno.env.get('FRONTEND_BASE_URL')` fallback. Affected files (~25 edge functions). The `FRONTEND_BASE_URL` secret should be set to your published domain. This is cosmetic for now (emails/callbacks) but important for production correctness.

5. **Update `payment-callback/index.ts`** — Replace hardcoded `https://afrishop-usa.com/payment-success` and `/payment-fail` URLs with dynamic `FRONTEND_BASE_URL`.

### Not changing
- `supabase/config.toml` — auto-managed by Lovable Cloud
- Database migrations — user will handle separately

