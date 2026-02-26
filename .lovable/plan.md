

## Fix: "Cannot read properties of undefined (reading 'invoke')" Email Error

### Problem
When admin applies a vehicle quote, the email notification fails with:
```
Cannot read properties of undefined (reading 'invoke')
```

The `supabase.functions.invoke("send-quote-email", ...)` call on line 397 of `admin-apply-vehicle-quote/index.ts` doesn't work because the Supabase client created with `createClient(url, serviceRoleKey)` in Deno edge functions does not reliably expose the `.functions` property. This has been failing silently (caught as non-fatal) every time a quote is applied.

### Solution

Replace `supabase.functions.invoke("send-quote-email", ...)` with a direct `fetch()` call to the edge function URL. This is the standard pattern for calling one edge function from another in this environment.

### File to Modify

**`supabase/functions/admin-apply-vehicle-quote/index.ts`** (lines 396-404)

Replace:
```typescript
const { data: emailResult, error: emailError } = await supabase.functions.invoke("send-quote-email", {
  body: {
    quoteRequestId,
    quotedShippingUsd: finalShippingUsd,
    quotedTotalUsd: finalTotalUsd,
    adminNotes: adminNotes || undefined,
  },
});
```

With:
```typescript
const emailResponse = await fetch(
  `${supabaseUrl}/functions/v1/send-quote-email`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
      quoteRequestId,
      quotedShippingUsd: finalShippingUsd,
      quotedTotalUsd: finalTotalUsd,
      adminNotes: adminNotes || undefined,
    }),
  }
);
const emailResult = await emailResponse.json();
const emailError = emailResponse.ok ? null : { message: emailResult?.error || `HTTP ${emailResponse.status}` };
```

And update the success check below it (line 406) from:
```typescript
if (!emailError && emailResult?.success) {
```
to:
```typescript
if (!emailError && (emailResult?.success || emailResponse.ok)) {
```

This is one small change in one file. The quote application logic, pricing, and everything else remain untouched.

