

## Fix: Vehicle Items Not Detected for Quote Request

### Problem
When you add a car (e.g., "2025 Tesla Model 3 Long Range Sedan 4D" from eBay) to your cart via the mobile app, tapping "Request a Quote" fails with "No vehicle items requiring a quote were found in your cart." The item exists in the database with `is_vehicle = false` despite being a real vehicle.

### Root Cause
Two bugs are working together:

1. **Cart sync uses a limited vehicle check**: The `cart-sync-from-client` function uses `isVehicleItem()` which ONLY checks for specific car marketplace stores (Carvana, CarGurus, Tesla Used, Edmunds). A vehicle listed on eBay or Amazon is not detected as a vehicle, so `is_vehicle` is set to `false`.

2. **Merge path skips vehicle flags**: When `mobile-add-cart-item` detects an existing item (same URL), it merges quantities but does NOT update `is_vehicle` or `requires_manual_quote` fields. So even though the smarter `determineShippingCategory` function correctly identifies the item as a vehicle, the database flag stays `false`.

### Solution

**File 1: `supabase/functions/mobile-add-cart-item/index.ts`**
- Update the merge/update path (around line 284) to also set `is_vehicle` and `requires_manual_quote` when the vehicle detection identifies the item as a vehicle. Currently it only updates quantity, price, and image.

**File 2: `supabase/functions/cart-sync-from-client/index.ts`**
- Replace the limited `isVehicleItem()` check with the smarter `determineShippingCategory()` function (already used by mobile-add-cart-item). This ensures vehicles listed on eBay, Amazon, or any other store are properly detected during cart sync.

**File 3: `supabase/functions/request-vehicle-quote/index.ts`**
- Add a fallback detection layer: if `is_vehicle` is false but the item title strongly indicates a vehicle (using `determineShippingCategory`), treat it as a vehicle for quote purposes. This catches items that were added before the fix and are already in users' carts.

### Technical Details

Change 1 - mobile-add-cart-item merge path (lines 284-289):
```text
// BEFORE: only updates quantity, price, image
const updateResult = await updateCartItem(db, existingItem.id, {
  quantity: newQuantity,
  base_price_usd: productPrice,
  product_image_url: productImageUrl,
  updated_at: new Date().toISOString(),
}, correlationId);

// AFTER: also updates vehicle flags when detected
const updateResult = await updateCartItem(db, existingItem.id, {
  quantity: newQuantity,
  base_price_usd: productPrice,
  product_image_url: productImageUrl,
  is_vehicle: isVehicle || existingItem.is_vehicle,
  requires_manual_quote: (isVehicle || existingItem.requires_manual_quote) && !existingItem.vehicle_quote_applied,
  updated_at: new Date().toISOString(),
}, correlationId);
```

Change 2 - cart-sync-from-client vehicle detection (line 239):
```text
// BEFORE: limited store-only check
const isVehicle = isVehicleItem(item.productUrl, store);

// AFTER: use smarter category detection
const detection = determineShippingCategory({
  title: item.title || "",
  url: item.productUrl,
  store: store,
  existingCategory: null,
});
const isVehicle = detection.category === "vehicle" && detection.requiresQuote;
```

Change 3 - request-vehicle-quote fallback detection (around line 154):
```text
// Add: import determineShippingCategory
// In the filter, add a fallback for items where is_vehicle wasn't set:
if (item.is_vehicle !== true && !isTeslaInventoryUrl(item.product_url) && !isCarStoreEnum(item.store || '')) {
  // Fallback: use smart detection on title + URL + store
  const detection = determineShippingCategory({
    title: item.title || "", url: item.product_url, store: item.store || "", existingCategory: null,
  });
  if (detection.category === "vehicle" && detection.requiresQuote) {
    return true;
  }
}
```

Also need to update the `findExistingCartItem` query in mobile-add-cart-item to include `is_vehicle` and `vehicle_quote_applied` in the SELECT so the merge path can reference them.

