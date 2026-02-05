

# Fix: Mobile Login Fails While Web Login Works

## Problem Identified

Based on the auth logs, I can see:
- **18:49:58Z** - Login SUCCESS from web preview (kadimisha@gmail.com)
- **18:47:14Z** - Login FAIL from production with "Invalid login credentials"  
- **18:46:08Z** - Login SUCCESS from production (same email, 1 minute earlier)

The mobile app is calling `supabase.auth.signInWithPassword()` **directly** (not through the edge function), and the failure is happening at the Supabase Auth level.

## Root Cause

Looking at the mobile architecture you shared, the `loginApi()` function calls:
```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email,      // ← NOT NORMALIZED
  password,
});
```

The email is NOT being normalized (trimmed/lowercased) before calling Supabase, while the web app likely has this built-in.

## Solution

Update the mobile app's `auth.ts` file to normalize the email:

### File: `src/api/auth.ts` (Mobile App)

```typescript
export async function loginApi(email: string, password: string): Promise<AuthResponse> {
  const supabase = getSupabaseClient();
  
  // ═══════════════════════════════════════════════════════════════
  // CRITICAL FIX: Normalize email, keep password EXACTLY as entered
  // ═══════════════════════════════════════════════════════════════
  const normalizedEmail = email.trim().toLowerCase();
  
  console.log('[AUTH] login_attempt email=' + normalizedEmail.substring(0, 3) + '***');
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,  // ← Normalized
    password: password,       // ← Case-sensitive, no changes
  });
  
  if (error) {
    console.error('[AUTH] login_failed code=' + error.status + ' msg=' + error.message);
    
    if (error.message.includes('confirm') || error.message.includes('verify')) {
      throw new Error('EMAIL_NOT_CONFIRMED');
    }
    throw new Error(error.message);
  }
  
  console.log('[AUTH] login_success userId=' + data.user.id);
  
  const user = await getMeApi();
  return { token: data.session.access_token, user };
}
```

## Why This Works

1. **Email normalization** - Mobile keyboards often add spaces or keep uppercase. Supabase stores emails lowercase, so "Kadimisha@Gmail.com " won't match "kadimisha@gmail.com"

2. **Password untouched** - Passwords are case-sensitive, so we keep them exactly as entered

3. **Same Supabase project** - The logs confirm both web and mobile are hitting the same project (igmkhxffnyzoogcqvdab)

## Additional Verification

To confirm the mobile app is using the correct Supabase project, add this at startup:

```typescript
// src/lib/supabase.ts - Add verification
const projectId = SUPABASE_URL.split('//')[1].split('.')[0];
console.log('[SUPABASE_CLIENT] project=' + projectId);

if (projectId !== 'igmkhxffnyzoogcqvdab') {
  console.error('[SUPABASE_CLIENT] ⚠️ WRONG PROJECT!');
}
```

## What I'll Update

Since the mobile app code is external, I'll update the **MOBILE_APP_INTEGRATION.md** with the exact fix and code snippets needed. The mobile team can apply these changes directly.

