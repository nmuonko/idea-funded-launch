
# Plan: Fix Infinite Loading Spinner in Card Payment Flow

## Problem Summary
When users attempt to pay with a card on the web app, the page shows an infinite loading spinner. The payment never completes and users are stuck.

## Root Cause Analysis

After investigating the code, I identified several issues in `src/pages/shop/CardPayment.tsx`:

### Issue 1: No Timeout on Stripe Initialization
The `getStripePromise()` function fetches configuration from `app-bootstrap` and then calls `loadStripe()`, but there's no timeout. If either operation hangs, the component stays in loading state forever.

### Issue 2: Improper Error Handling for `loadStripe()`
```typescript
stripePromise = loadStripe(publishableKey);  // Returns a Promise
return stripePromise;  // Returns before the Promise resolves
```
If `loadStripe()` returns a Promise that rejects (e.g., invalid key, network issue), the error is never caught. The `try/catch` block only catches synchronous errors, not async rejections from the returned Promise.

### Issue 3: Stale Promise Caching
The global `stripePromise` variable is cached indefinitely. If the first initialization attempt fails (e.g., network timeout), subsequent calls will return the same failed/pending promise without retrying.

### Issue 4: Missing console.log statements
There are no debug logs to help diagnose where the loading is getting stuck.

---

## Solution

### 1. Add proper await and error handling for `loadStripe()`
Currently: `stripePromise = loadStripe(publishableKey); return stripePromise;`
Fix: `stripePromise = loadStripe(publishableKey); return await stripePromise;` wrapped in try-catch

### 2. Add timeout protection
Add a 15-second timeout on the entire initialization flow to prevent infinite waiting.

### 3. Reset cached promise on failure
If loading fails, reset `stripePromise` to `null` so future attempts can retry.

### 4. Add comprehensive error logging
Add console.log statements throughout the flow to help debug issues.

---

## Technical Implementation

### File: `src/pages/shop/CardPayment.tsx`

**Changes to `getStripePromise()` function:**

```typescript
let stripePromise: Promise<Stripe | null> | null = null;
let stripeLoadAttempted = false;

async function getStripePromise(): Promise<Stripe | null> {
  // Return cached instance if already loaded successfully
  if (stripePromise && stripeLoadAttempted) {
    try {
      const cached = await stripePromise;
      if (cached) return cached;
    } catch {
      // Cached promise failed, allow retry
      stripePromise = null;
    }
  }

  stripeLoadAttempted = true;
  
  try {
    console.log('[CardPayment] Fetching bootstrap config...');
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-bootstrap`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );
    
    if (!response.ok) {
      console.error('[CardPayment] Failed to fetch bootstrap config:', response.status);
      return null;
    }
    
    const data = await response.json();
    console.log('[CardPayment] Bootstrap config received');
    
    const stripeProvider = data?.payments?.providers?.find((p: any) => p.id === 'stripe');
    const publishableKey = stripeProvider?.publishable_key;
    
    if (!publishableKey) {
      console.error('[CardPayment] Stripe publishable key not found in config');
      return null;
    }
    
    console.log('[CardPayment] Loading Stripe with key:', publishableKey.substring(0, 15) + '...');
    
    // Store the promise and await it to catch any rejections
    stripePromise = loadStripe(publishableKey);
    const stripeInstance = await stripePromise;
    
    if (!stripeInstance) {
      console.error('[CardPayment] Stripe failed to initialize');
      stripePromise = null;
      return null;
    }
    
    console.log('[CardPayment] Stripe initialized successfully');
    return stripeInstance;
    
  } catch (error) {
    console.error('[CardPayment] Error loading Stripe:', error);
    stripePromise = null;
    stripeLoadAttempted = false;
    return null;
  }
}
```

**Changes to `useEffect` in CardPayment component:**

```typescript
useEffect(() => {
  let cancelled = false;
  
  const init = async () => {
    console.log('[CardPayment] Initializing...', { orderId, hasClientSecret: !!clientSecret });
    
    if (!orderId || !clientSecret) {
      console.error('[CardPayment] Missing orderId or clientSecret');
      setError('Invalid payment session. Please try again.');
      setLoading(false);
      return;
    }
    
    try {
      // Add timeout protection
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Initialization timeout')), 15000)
      );
      
      const stripeInstance = await Promise.race([
        getStripePromise(),
        timeoutPromise
      ]);
      
      if (cancelled) return;
      
      if (!stripeInstance) {
        setError('Failed to initialize payment. Please try again later.');
        setLoading(false);
        return;
      }
      
      setStripe(stripeInstance);
      setLoading(false);
      console.log('[CardPayment] Ready to accept payment');
      
    } catch (err: any) {
      console.error('[CardPayment] Initialization error:', err);
      if (!cancelled) {
        setError(err.message === 'Initialization timeout' 
          ? 'Payment initialization timed out. Please refresh and try again.'
          : 'Failed to initialize payment. Please try again later.');
        setLoading(false);
      }
    }
  };
  
  init();
  
  return () => { cancelled = true; };
}, [orderId, clientSecret]);
```

---

## Expected Outcome

After implementing these changes:
1. Users will see helpful error messages instead of infinite loading
2. If Stripe fails to load, users get a clear "try again" message within 15 seconds
3. Console logs will help diagnose any remaining issues
4. Failed initialization attempts will be retried instead of returning stale failures

## Files to Modify
- `src/pages/shop/CardPayment.tsx` - Fix the Stripe initialization logic

