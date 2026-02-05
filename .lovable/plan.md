
# Fix: Mobile "Catalogue Indisponible" - Multiple Endpoints Missing CORS Headers

## Problem Identified

The `catalog-home` function was fixed, but the mobile app calls multiple catalog endpoints on startup. These other endpoints are **missing the mobile-specific CORS headers**, causing the mobile app to fail:

| Endpoint | Current Headers | Status |
|----------|-----------------|--------|
| `catalog-home` | ✅ Has mobile headers | Fixed |
| `mobile-public-config` | ❌ Missing mobile headers | **Broken** |
| `catalog-search` | ❌ Missing mobile headers | **Broken** |
| `catalog-product` | ❌ Missing mobile headers | **Broken** |

The mobile app likely calls `mobile-public-config` first to bootstrap, and if that fails with a CORS error, the entire catalog becomes unavailable.

## Root Cause

Mobile Supabase clients (React Native) send these headers that need to be explicitly allowed:
- `x-supabase-client-platform`
- `x-supabase-client-platform-version`
- `x-supabase-client-runtime`
- `x-supabase-client-runtime-version`

## Solution

Update CORS headers in all mobile-facing catalog endpoints to include the mobile-specific headers.

## Changes Required

### 1. Update `supabase/functions/mobile-public-config/index.ts` (Line 12-16)

```typescript
// FROM:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
};

// TO:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
};
```

### 2. Update `supabase/functions/catalog-search/index.ts` (Line 71-74)

```typescript
// FROM:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
};

// TO:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
```

### 3. Update `supabase/functions/catalog-product/index.ts` (Line 33-37)

```typescript
// FROM:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id",
  "Cache-Control": "public, max-age=300",
};

// TO:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "public, max-age=300",
};
```

### 4. Redeploy All Three Functions

Deploy the updated functions to apply the CORS fixes.

## Technical Details

| Aspect | Details |
|--------|---------|
| Root Cause | Multiple catalog endpoints missing mobile CORS headers |
| Most Critical | `mobile-public-config` - called first on app startup |
| Fix Scope | Add 4 mobile-specific headers to 3 edge functions |
| Risk | None - only adds allowed headers, no functionality changes |

## Why This Will Work

1. `mobile-public-config` is the **first endpoint** called when the mobile app starts
2. If this CORS fails, the app cannot get configuration and shows "Catalogue Indisponible"
3. Even if `catalog-home` works, the app needs config first to know what to display
4. Fixing all three endpoints ensures the complete mobile flow works
