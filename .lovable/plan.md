

# Fix: Deleted Cart Items Keep Reappearing

## Root Cause (Critical Bug)

The items are **never actually being deleted from the database**. Here's why:

**Frontend** (ShopCartContext.tsx, line 471-472) sends the item ID in the **request body**:
```typescript
await supabase.functions.invoke('mobile-delete-cart-item', {
  body: { cart_item_id: id },
});
```

**Backend** (mobile-delete-cart-item/index.ts, line 30-32) reads the item ID from the **URL path**:
```typescript
const url = new URL(req.url);
const pathParts = url.pathname.split('/').filter(Boolean);
const itemId = pathParts[pathParts.length - 1];
```

Since `supabase.functions.invoke('mobile-delete-cart-item', ...)` sends a POST to `/functions/v1/mobile-delete-cart-item`, the last path segment is `"mobile-delete-cart-item"` -- NOT the actual item UUID.

The edge function then tries to find an item with ID `"mobile-delete-cart-item"` in the order, doesn't find it, and returns `{ success: true, status: 'already_deleted' }`. The item is never actually removed from the database.

When `syncCart()` runs (immediately after, or when adding a new item), the server returns ALL items -- including the "deleted" ones. The 30-second TTL on `deletedItemIdsRef` temporarily hides them, but they reappear once the TTL expires or on the next page load.

## Fix

Update the **edge function** to also check the request body for the item ID, falling back to URL path extraction for backward compatibility with the mobile app.

### File: `supabase/functions/mobile-delete-cart-item/index.ts`

At lines 29-36, after extracting itemId from the URL path, add a fallback to read from the request body:

```text
Current:
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const itemId = pathParts[pathParts.length - 1];

Updated:
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  let itemId = pathParts[pathParts.length - 1];

  // If the last path segment is the function name itself,
  // the ID was sent in the request body (web app pattern)
  if (itemId === 'mobile-delete-cart-item') {
    const body = await req.json();
    itemId = body.cart_item_id || body.itemId || null;
  }
```

This ensures:
- The **web app** (which sends ID in body) works correctly
- The **mobile app** (which may send ID in URL path) continues to work
- No frontend changes needed -- the fix is entirely server-side

### No other files need changes

The existing `deletedItemIdsRef` TTL logic and sync filtering in `ShopCartContext.tsx` are correct and will work properly once items are actually deleted from the database.

