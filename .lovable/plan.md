

# Fix: Force Correct Supabase JS Version in auth-register

## Problem

Despite pinning the import to `@2.49.1`, the `auth-register` edge function still fails with `supabaseAdmin.auth.admin.generateLink is not a function`. The `esm.sh` CDN is serving a cached/incorrect version. The `auth-resend-verification` function works fine with the same import, which confirms this is a caching issue specific to the `auth-register` function's deployment.

## Fix

### File: `supabase/functions/auth-register/index.ts`

Add a cache-busting query parameter to the `esm.sh` import URL to force a fresh resolution:

```typescript
// Change from:
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Change to:
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1?pin=v135";
```

The `?pin=v135` parameter forces `esm.sh` to use a specific build version of its CDN, bypassing any stale cache.

### Redeploy

Redeploy the `auth-register` edge function after the change.

## Expected Result

- `auth.admin.generateLink()` will be available
- Verification emails will be sent immediately upon registration (not just on resend)
- Users registering on `afrishop-usa.com` will receive their verification email right away

## Files Modified

- `supabase/functions/auth-register/index.ts` -- cache-bust esm.sh import

