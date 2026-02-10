

# Fix: Verification Email Not Being Sent

## Root Cause

The edge function logs show:
```
Failed to send verification email (non-blocking): supabaseAdmin.auth.admin.generateLink is not a function
```

The `@supabase/supabase-js@2` import via `esm.sh` is resolving to a version that does not expose `auth.admin.generateLink()`. This method was added in later v2 releases. The fix is to pin the import to a recent version that includes this method.

## Fix

### File: `supabase/functions/auth-register/index.ts`

Update the Supabase JS import from:
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```
to a pinned version that supports `generateLink`:
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
```

### File: `supabase/functions/auth-resend-verification/index.ts`

Same import version pin if it also uses an unpinned `@2` import.

## Why This Fixes It

- `auth.admin.generateLink()` was introduced in a specific minor version of `@supabase/supabase-js` v2
- Using the bare `@2` tag may resolve to an older cached version on `esm.sh` that predates this method
- Pinning to `@2.49.1` (or similar recent version) guarantees the method exists

## Files Modified

- `supabase/functions/auth-register/index.ts` -- pin supabase-js version
- `supabase/functions/auth-resend-verification/index.ts` -- pin supabase-js version (if needed)

## After Fix

- Redeploy both edge functions
- Test registration with a new email to confirm the verification email is sent

