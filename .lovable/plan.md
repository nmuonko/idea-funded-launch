

# Fix: Request Quote Button in Cart + Product Not Found Error

## Issue 1: Request Quote Button Placement

Currently, the "Request Shipping Quote" button only appears in the Order Summary sidebar when a vehicle is selected. The user wants this button placed **next to the vehicle item** in the cart list for better visibility.

### Changes: `src/pages/shop/ShopCart.tsx`

Add a "Request Quote" / "Quote Pending" button directly below the vehicle badge inside each vehicle cart item (after line 204). This button will:
- Show "Request a Quote" (amber gradient) if no quote has been requested yet and the user is logged in
- Show "Quote Pending" (disabled, muted) if a quote is already pending
- Show "Quote Sent" (green) once confirmed
- Keep the existing sidebar quote section as a secondary reminder

The button will call the same `requestVehicleQuote` function already defined in the component.

## Issue 2: "Product not found on amazon.com" Error

Two problems contribute to this:

**Problem A**: Cart item links pass incomplete navigation state. Currently (line 174-176):
```
state={{ product: { isVehicle: item.isVehicle } }}
```
This only passes `isVehicle`, not the actual product data (title, price, image, provider, ID). When the API fetch fails, the fallback product has no real information, so the error page shows instead of gracefully displaying cached cart data.

**Problem B**: Same issue on the second cart link (line 187-189).

### Fix: `src/pages/shop/ShopCart.tsx`

Update both cart item links to pass complete product data in navigation state:
```typescript
state={{ product: {
  id: item.productId,
  provider: item.provider,
  title: item.title,
  imageUrl: item.imageUrl,
  priceUsd: item.priceUsd,
  isVehicle: item.isVehicle,
  productUrl: item.productUrl,
}}}
```

This ensures that if the API call fails (network issues, product delisted, etc.), the ProductDetails page still has enough data from the cart to render a usable product view with the correct title, image, and price -- rather than showing a blank "Product not found" error.

## Technical Details

### Files Modified
- `src/pages/shop/ShopCart.tsx` -- Add inline quote button to vehicle items + pass full product data in nav state

### No edge function changes needed
The `mobile-request-quote` endpoint and `requestVehicleQuote` handler already exist and work correctly. This is purely a UI layout change.

