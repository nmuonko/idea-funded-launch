
# Fix: Cart Sync Not Reading Backend Vehicle Flags

## Root Cause

There are **two critical bugs** in `src/contexts/ShopCartContext.tsx` preventing vehicle detection from working:

### Bug 1: Wrong response key -- `data.items` vs `data.activeItems`
The backend (`mobile-get-cart`) returns:
```json
{ "ok": true, "activeItems": [...], "savedItems": [...], "summary": {...} }
```
But the frontend at line 227 reads `data.items`, which is **always undefined**. This means the entire `if (data?.items)` block is skipped, so:
- Cart items are never synced from the server
- Vehicle flags (`hasVehicleItems`, `vehicleQuoteStatus`, `canProceedToPayment`) are **never updated** from the backend summary
- The default values remain: `hasVehicleItems = false`, `canProceedToPayment = true`

### Bug 2: Field name mismatches (snake_case vs camelCase)
Even after fixing Bug 1, the item mapping uses wrong field names:
- Frontend reads `item.is_vehicle` but backend returns `item.isVehicle`
- Frontend reads `item.requires_manual_quote` but backend returns `item.requiresManualQuote`
- Frontend reads `item.vehicle_quote_applied` but backend returns `item.vehicleQuoteApplied`
- Frontend reads `item.base_price_usd` but backend returns `item.basePriceUsd`
- Frontend reads `item.image_url` but backend returns `item.mainImageUrl` / `item.image_url` (this one is fine)
- Frontend reads `item.product_url` but backend returns `item.productUrl`

## Fix

### File: `src/contexts/ShopCartContext.tsx`

**Change 1:** Replace `data.items` with `data.activeItems` (line 227-228)

**Change 2:** Fix item field mappings to use camelCase names matching backend response:

```typescript
if (data?.activeItems) {
  const mappedItems: CartItem[] = data.activeItems.map((item: any) => ({
    id: item.id,
    productId: item.productUrl || item.product_url,
    provider: item.store || 'unknown',
    title: item.title || item.productTitle || 'Product',
    imageUrl: item.image_url || item.mainImageUrl || '',
    priceUsd: item.basePriceUsd || item.base_price_usd || 0,
    quantity: item.quantity || 1,
    productUrl: item.productUrl || item.product_url,
    isVehicle: item.isVehicle || false,
    requiresManualQuote: item.requiresManualQuote || false,
    vehicleQuoteApplied: item.vehicleQuoteApplied || false,
  }));
  // ... rest stays the same
}
```

This is a **two-line category fix** (the key name and field mappings) that will unblock the entire vehicle quote flow on the web app.

## Why This Was Hidden

The cart appeared to work because items were being added to local state directly by the `addItem` function. The `syncCart` call was silently failing to read the server response, but since local state already had the items, the UI showed them. However, the vehicle flags from the **summary** were never set, so checkout was never blocked.
