

# Plan: Fix Cart Recovery "Envoyer les rappels" Button

## Root Cause

The error "Failed to send a request to the Edge Function" indicates the deployed `email-service` function is likely running a stale version that doesn't include the `handleCartRecovery` inline handler. The function boots successfully (26ms) and returns proper 401 for unauthenticated requests, but the cart recovery code path was never reached — zero logs for `cart_recovery`.

## Fix

### 1. Redeploy the `email-service` edge function
The current code in `supabase/functions/email-service/index.ts` is correct and complete — it has the `handleCartRecovery` handler, proper auth gating, and Resend integration. It just needs to be redeployed so the live version matches the code.

### 2. Test the function
After deployment, invoke the function with `preview: true` to verify it responds correctly and can query eligible orders.

## No code changes needed
The `email-service/index.ts` and `CartRecoveryDialog.tsx` code are both correct. This is purely a deployment sync issue.

