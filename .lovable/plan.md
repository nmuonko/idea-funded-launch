

# Fix: `admin-system-health` BOOT_ERROR

## Problem
The `admin-system-health` edge function crashes on startup because it imports `verifyAdminAuth` and `authErrorResponse` from `_shared/auth.ts`, but those exports don't exist.

## Changes to `supabase/functions/admin-system-health/index.ts`

### 1. Fix imports (lines 1-3)
Remove `createClient` and broken imports. Replace with working exports from `_shared/auth.ts`:

```
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { verifyAndGetUser, errorResponse, handleCors, createAdminClient } from "../_shared/auth.ts";
```

### 2. Fix auth block (lines 69-78)
Replace the broken `verifyAdminAuth` call with `verifyAndGetUser` + admin role check against `user_roles` table, and use `createAdminClient()` instead of manual client creation:

```typescript
const { user } = await verifyAndGetUser(req);

const adminClient = createAdminClient();
const { data: roleData } = await adminClient
  .from('user_roles')
  .select('role')
  .eq('user_id', user.id)
  .eq('role', 'admin')
  .maybeSingle();

if (!roleData) {
  return errorResponse('Unauthorized: admin role required', 403);
}

const supabase = adminClient;
```

### 3. Redeploy
Redeploy the `admin-system-health` edge function after applying changes.

