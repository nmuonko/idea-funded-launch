

## Forward MaishaMarket Callbacks from pawaPay

### What we're doing
Adding a routing layer in the `pawapay-callback` handler so that MaishaMarket-tagged callbacks are forwarded to MaishaMarket's own endpoint instead of being processed locally.

### Where the change goes
**File:** `supabase/functions/pawapay-callback/index.ts`

Insert forwarding logic at **line 790** — right after Zod validation succeeds and `validatedPayload` is available, but before the payout check and any AfriShop database lookups.

### Logic

```typescript
// ===== Multi-App Routing =====
const callbackMetadata = validatedPayload.metadata || [];
const appField = callbackMetadata.find((m: any) => m.fieldName === 'app');
const appValue = appField?.fieldValue || 'afrishop'; // backward compat

if (appValue === 'maishamarket') {
  console.log(`[${traceId}] Forwarding callback to MaishaMarket`, {
    depositId: validatedPayload.depositId,
    payoutId: validatedPayload.payoutId,
    status: validatedPayload.status,
  });
  try {
    const forwardRes = await fetch(
      'https://xuoihucaummfcbgazrja.supabase.co/functions/v1/pawapay-callback',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), // forward original payload
      }
    );
    const forwardData = await forwardRes.json();
    return new Response(JSON.stringify({ forwarded: true, ...forwardData }), {
      status: forwardRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (forwardErr: any) {
    console.error(`[${traceId}] MaishaMarket forward failed:`, forwardErr.message);
    // Return 200 so pawaPay doesn't retry — MaishaMarket can reconcile later
    return new Response(JSON.stringify({ forwarded: false, error: 'forward_failed' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
```

### Safety
- **Default to `'afrishop'`** when metadata is missing — all legacy transactions process normally
- Returns HTTP 200 even on forward failure to prevent pawaPay retries
- No changes to any existing AfriShop processing logic
- Security verification (signature/IP) still runs before this — MaishaMarket callbacks get the same security checks

### Deployment
Redeploy `pawapay-callback` edge function after the change.

