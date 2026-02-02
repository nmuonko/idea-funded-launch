

# Plan: Fix Delete Seeds "Failed to fetch" Error

## Problem Analysis

The "Failed to fetch" error occurs at the network level before the request reaches the edge function. Edge function logs only show "booted" - no DELETE request processing.

### Root Cause
DELETE requests with a JSON body can be problematic in certain browser/network configurations. Some proxies and CDNs strip the body from DELETE requests.

## Solution

Change the delete operation to use POST with an `action: "delete"` parameter instead of relying on DELETE method with body.

## Changes Required

### File: `supabase/functions/admin-home-seeds/index.ts`

Add support for POST-based delete action:

```typescript
// Inside POST handler, after existing logic
if (req.method === "POST") {
  const body = await req.json();
  
  // Handle delete action via POST
  if (body.action === "delete") {
    const idsToDelete = body.ids || (body.id ? [body.id] : []);
    // ... existing delete logic
  }
  
  // ... existing POST upsert logic
}
```

### File: `src/pages/admin/HomeCuration.tsx`

Update delete handlers to use POST with action:

```typescript
// Line 217-234: handleDeleteSeed
const response = await post("admin-home-seeds", { 
  action: "delete", 
  id: seedId 
});

// Line 362-364: handleBulkDeleteSeeds  
const response = await post("admin-home-seeds", { 
  action: "delete",
  ids: Array.from(selectedSeeds) 
});
```

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/admin-home-seeds/index.ts` | Add POST-based delete action handler |
| `src/pages/admin/HomeCuration.tsx` | Change delete calls from DELETE to POST with action |

## Impact

- **Reliability**: POST requests with body are universally supported
- **Backward Compatible**: Existing DELETE method still works
- **No Schema Changes**: Pure application-level fix

