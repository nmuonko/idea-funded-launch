

# Fix: Mobile App "Catalogue Indisponible" Error

## Problem Identified

The mobile app is showing "Catalogue Indisponible" (Catalog Unavailable) because the `catalog-home` edge function's CORS headers don't include the headers that mobile Supabase clients send. The web app works because browsers may handle CORS differently, but mobile apps (React Native) are stricter.

**Current CORS headers in `catalog-home`:**
```typescript
"Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment"
```

**Missing headers that mobile clients send:**
- `x-supabase-client-platform`
- `x-supabase-client-platform-version`
- `x-supabase-client-runtime`
- `x-supabase-client-runtime-version`

## Solution

Update the CORS headers in `catalog-home` to match the headers used in `auth-me` (which was already fixed for mobile).

## Changes Required

### 1. Update `supabase/functions/catalog-home/index.ts`

Update the `corsHeaders` constant (around line 49-55):

```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};
```

### 2. Redeploy the Edge Function

Deploy the updated `catalog-home` function to apply the CORS fix.

## Technical Details

| Aspect | Details |
|--------|---------|
| Root Cause | Missing mobile-specific Supabase headers in CORS Allow-Headers |
| Affected Clients | Mobile apps (React Native with @supabase/supabase-js) |
| Fix Scope | One-line change to CORS headers |
| Risk | None - only adds allowed headers, doesn't change functionality |

