
# Fix: Show Friendly Error Messages from Registration Edge Function

## Problem

When a user tries to register with an email that already exists, the edge function correctly returns a 409 status with a friendly message ("This email is already registered. Please sign in instead."). However, `supabase.functions.invoke()` treats any non-2xx response as an error, setting `response.error` with the generic message "Edge Function returned a non-2xx status code" while still placing the actual response body in `response.data`.

The frontend code checks `response.error` first (line 455) and shows the generic error toast, never reaching the `response.data` check that contains the friendly message.

## Fix

### File: `src/contexts/AuthContext.tsx`

Update the error handling block (lines 455-463) to check if `response.data` contains a structured error message before falling back to the generic `response.error.message`.

```typescript
// Before:
if (response.error) {
  console.error('[Auth] Registration edge function error:', response.error);
  toast({
    title: 'Error',
    description: response.error.message || 'Registration failed. Please try again.',
    variant: 'destructive',
  });
  return { error: response.error };
}

// After:
if (response.error) {
  console.error('[Auth] Registration edge function error:', response.error);
  // Check if the response body has a friendly message (non-2xx responses still include data)
  const errorMessage = response.data?.message || response.error.message || 'Registration failed. Please try again.';
  toast({
    title: 'Error',
    description: errorMessage,
    variant: 'destructive',
  });
  return { error: new Error(errorMessage) };
}
```

## Result

- "Email already registered" will show: "This email is already registered. Please sign in instead."
- Other edge function errors with structured responses will also show their friendly messages
- Generic fallback remains for truly unexpected errors

## Files Modified

- `src/contexts/AuthContext.tsx` -- improve error handling to extract friendly messages from edge function responses
