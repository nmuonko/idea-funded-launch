

## Problem

The auth logs show a clear sequence: `admin.createUser` with `email_confirm: true` succeeds (status 200), but the immediate `signInWithPassword` still fails with "Email not confirmed." This means GoTrue is ignoring the `email_confirm` flag — likely because the server-level auto-confirm setting keeps getting reset on GoTrue restarts.

Two critical gaps in the `auth-service` edge function:

1. **`handleRegister` (line 211-219)**: After creating a user, if `signInWithPassword` fails with "Email not confirmed," it silently returns success WITHOUT a session token. The mobile app then can't log in.
2. **`handleLogin` (line 238-260)**: Has zero handling for "Email not confirmed" — it maps ALL errors to generic "Invalid email or password," hiding the real issue and never auto-confirming.

The web `AuthContext.tsx` retry logic (line 343) only helps the web app, not the mobile app which calls `auth-service` directly.

## Fix

### 1. Add auto-confirm retry in `handleRegister` (auth-service edge function)

After `signInWithPassword` fails on line 211, check if the error is "Email not confirmed." If so, explicitly confirm the user via the Admin API (`PUT /auth/v1/admin/users/{id}` with `{ email_confirm: true }`), then retry `signInWithPassword`.

```
Line 211-219 becomes:
  const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword(...)
  
  if (signInError?.message?.includes('Email not confirmed')) {
    // Force-confirm via admin API and retry
    await supabaseAdmin.auth.admin.updateUser(userId, { email_confirm: true });
    const retry = await supabase.auth.signInWithPassword({ email, password });
    if (!retry.error && retry.data?.session) {
      return jsonRes({ success, token, session, ... }); // full session response
    }
  }
```

### 2. Add auto-confirm retry in `handleLogin` (auth-service edge function)

In `handleLogin` (line 246-250), detect "Email not confirmed" specifically. When hit, use the service client to confirm the user and retry sign-in:

```
Line 246-250 becomes:
  if (error) {
    if (error.message?.includes('Email not confirmed') || error.message?.includes('email_not_confirmed')) {
      const admin = createServiceClient();
      // Find and confirm the user
      const { data: { users } } = await admin.auth.admin.listUsers();
      const u = users?.find(x => x.email?.toLowerCase() === email);
      if (u) {
        await admin.auth.admin.updateUser(u.id, { email_confirm: true });
        const retry = await supabase.auth.signInWithPassword({ email, password });
        if (!retry.error && retry.data?.session) {
          // return success response with session
        }
      }
    }
    // ... existing error handling
  }
```

### 3. Redeploy the edge function

Deploy `auth-service` after changes so both mobile and web benefit from the server-side auto-confirm.

### Technical Notes

- The fix is entirely in `supabase/functions/auth-service/index.ts` — one file
- Both register and login paths get the same self-healing pattern
- This makes the fix infrastructure-resilient: even if GoTrue config resets, the edge function will always force-confirm on the spot
- The web `AuthContext.tsx` retry logic remains as an additional safety net

