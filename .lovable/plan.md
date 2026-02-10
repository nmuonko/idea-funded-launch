

# Fix: Allow Unverified Users to Resend Verification from Sign-In

## The Problem

Users who registered but never received a verification email (due to the earlier bug) are stuck:
- They **can't sign in** because their email isn't confirmed
- They **can't re-register** because the email already exists
- They have **no way to reach** the "Resend Verification" button

Currently, when they try to sign in, they just see a toast message saying "Please check your email" -- but there's no email to check.

## The Fix

### 1. `src/pages/shop/ShopAuth.tsx` - Detect "Email not confirmed" and show verification screen

Update `handleSignIn` to detect the "Email not confirmed" error from the auth system. When this happens, instead of just showing a toast, switch the UI to the verification screen (`mode = 'verify'`) where the user can click "Resend Verification."

```typescript
// In handleSignIn, after calling signIn():
const { error, userId } = await signIn(email, password, rememberMe);

if (error) {
  // Check if this is an unverified email error
  if (error.message?.includes('Email not confirmed')) {
    // Switch to verification screen so user can resend
    setMode('verify');
    return;
  }
  // Other errors are already handled by AuthContext toast
  return;
}
```

### 2. `src/contexts/AuthContext.tsx` - Return the error so the caller can react to it

The current `signIn` function already returns `{ error, userId }` when sign-in fails (line 359), so the error object is available. However, the `ShopAuth` sign-in handler doesn't currently check the returned error object. The `signIn` function will still show a helpful toast, but now `ShopAuth` will also redirect to the verify screen.

Update the "Email not confirmed" toast message to be more actionable:

```typescript
// Change from:
userMessage = 'Please check your email and confirm your account before signing in.';

// Change to:
userMessage = 'Your email is not yet verified. Please verify your email to sign in.';
```

### 3. Verification screen already works

The verification screen at `mode === 'verify'` (lines 757-796 in ShopAuth.tsx) already has:
- A "Resend Verification" button that calls `auth-resend-verification`
- The email variable is already populated from the sign-in form
- A "Back to Sign In" link

No changes needed to the verification screen itself.

## Flow After Fix

```text
User tries to sign in
       |
       v
   Email not confirmed?
      / \
    Yes   No
     |     |
     v     v
  Show     Normal
  verify   sign-in
  screen   flow
     |
     v
  User clicks
  "Resend Verification"
     |
     v
  Verification email
  sent successfully
```

## Files Modified

- `src/pages/shop/ShopAuth.tsx` -- detect "Email not confirmed" error in sign-in handler, redirect to verify screen
- `src/contexts/AuthContext.tsx` -- improve the toast message for unverified email error
