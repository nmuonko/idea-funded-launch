

# Fix Support Contact Data Source Mismatch

## The Problem

There are **3 disconnected sources** for support contact info, causing the US number vs DRC number confusion:

1. **Admin panel** (`SupportContactSettings.tsx`) reads/writes to the `settings` table -- this shows the US number `+13092068948`
2. **Backend edge functions** (`mobile-public-config`, `send-order-assistance-email`) read from the `bank_transfer_settings` table -- a completely different table
3. **Frontend components** (`ShopFooter.tsx`, `GetApp.tsx`) use **hardcoded values** from `supportConfig.ts` (`243973141627`) -- ignoring both database tables entirely

So when you update the phone number in the admin panel, it saves to `settings`, but nothing reads from there. The mobile app gets its number from `bank_transfer_settings`, and the website uses a hardcoded DRC number.

## The Fix

### 1. Create a `useSupportContact` hook
A new React hook that fetches `support_whatsapp` and `support_email` from the `settings` table (with the hardcoded values as fallback). This replaces all hardcoded imports.

### 2. Update the admin page to write to BOTH tables
`SupportContactSettings.tsx` currently only writes to `settings`. It should also update `bank_transfer_settings` so the mobile app (which reads from there via `mobile-public-config`) stays in sync.

### 3. Update frontend components to use the hook
- `ShopFooter.tsx` -- replace hardcoded `SUPPORT_WHATSAPP_E164` with hook
- `GetApp.tsx` -- replace hardcoded `SUPPORT_WHATSAPP_E164` with hook

### 4. Update edge functions to read from `settings` table
- `mobile-public-config/index.ts` -- read from `settings` instead of `bank_transfer_settings`
- `send-order-assistance-email/index.ts` -- read from `settings` instead of `bank_transfer_settings`

### 5. Keep `supportConfig.ts` as fallback only
The hardcoded values remain as fallback defaults if the database query fails, but are no longer imported directly by components.

## Files to Create
- `src/hooks/useSupportContact.ts` -- hook to fetch support contact from DB

## Files to Edit
- `src/pages/admin/SupportContactSettings.tsx` -- also write to `bank_transfer_settings`
- `src/components/shop/ShopFooter.tsx` -- use hook instead of hardcoded import
- `src/pages/GetApp.tsx` -- use hook instead of hardcoded import
- `supabase/functions/mobile-public-config/index.ts` -- read from `settings` table
- `supabase/functions/send-order-assistance-email/index.ts` -- read from `settings` table

## Result
After this fix, changing the WhatsApp number or email in the admin "Support Contact" page will immediately take effect across the website, mobile app, and all email notifications -- from a single source of truth.

