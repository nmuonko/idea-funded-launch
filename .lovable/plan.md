

## Fix: Vehicle Quote Request Crash and Markup Review

### Problem 1: Runtime Error (CRITICAL)
The edge function logs show the exact error:
```
ERROR: supabase.from(...).upsert(...).select(...).single is not a function
```

The vehicle IS being detected correctly now (logs show "Found 1 vehicle items requiring quote"), but the code crashes when trying to save the quote request. The `.upsert().select().single()` chain is not supported by the Supabase client version used in edge functions.

### Problem 2: Markup Fee
Current settings: vehicle markup = 10%, general markup = 20%. The 10% vehicle markup IS being applied. If the displayed fee seems wrong, it may be because the cart was initially calculated with the 20% general markup before being re-detected as a vehicle.

### Fix

**File: `supabase/functions/request-vehicle-quote/index.ts`**

Replace the `.upsert().select().single()` chain (lines 238-245) with a two-step approach:
1. Perform the upsert WITHOUT `.select().single()`
2. Then query the record separately to get the ID and status

```text
// BEFORE (crashes):
const { data: upsertedQuote, error: upsertError } = await supabase
  .from('quote_requests')
  .upsert(quoteData, { onConflict: 'order_item_id', ignoreDuplicates: false })
  .select('id, order_item_id, status')
  .single();

// AFTER (two-step):
const { error: upsertError } = await supabase
  .from('quote_requests')
  .upsert(quoteData, { onConflict: 'order_item_id', ignoreDuplicates: false });

if (upsertError) { /* handle error, continue */ }

// Then fetch the record
const { data: upsertedQuote } = await supabase
  .from('quote_requests')
  .select('id, order_item_id, status')
  .eq('order_item_id', item.id)
  .single();
```

This is the only change needed -- the vehicle detection and markup logic are working correctly based on the logs.
