
# Vehicle Pricing: Correct Markup, Hidden Shipping, and Web Payment Link

## What's Wrong Now

Looking at the screenshot, when a user views a vehicle (2022 Toyota RAV4 XLE at $23,950):
- **Markup Fee shows $7,185** -- this uses the general 30% markup instead of the vehicle-specific percentage set by admin (e.g., 18%)
- **Shipping Fee shows $2,435** -- this should be hidden until admin sets the quote
- **Estimated Total shows $33,570** -- this is misleading since the real total depends on admin's custom quote

## What Changes

### 1. Store vehicle markup in fee settings

**File: `src/contexts/ShopCartContext.tsx`**
- Add `vehicleMarkupPercent` to the `FeeSettings` interface
- When loading config from `mobile-public-config`, also extract `markup.vehicleValue` (already returned by the API)

### 2. Use vehicle markup for vehicle products on ProductDetails page

**File: `src/components/shop/PriceBreakdown.tsx`**
- Accept a new optional prop `isVehicle?: boolean`
- When `isVehicle` is true AND no quote exists yet:
  - Show the item price with vehicle markup (using `vehicleMarkupPercent`)
  - **Hide shipping fee** entirely -- show "Pending quote" instead
  - Show "Estimated Subtotal" (item + markup only) instead of "Estimated Total"
  - Display a message: "Shipping will be determined after admin quote"
- When `isVehicle` is true AND quote is approved (vehicleQuoteStatus = 'quoted'):
  - Show the server-provided total with all fees visible

### 3. Pass `isVehicle` flag from ProductDetails page

**File: `src/pages/shop/ProductDetails.tsx`**
- Detect if a product is a vehicle based on its provider category or the route/location state
- Pass `isVehicle={true}` to `PriceBreakdown` for vehicle products
- The detection uses the same logic already in the codebase (checking if provider is from vehicle categories)

### 4. Update quote email to link to web payment page

**File: `supabase/functions/send-quote-email/index.ts`**
- Change the CTA button from "Pay by Bank Transfer" (bank-only) to a generic "View Quote and Pay" linking to `/cart` on the web app
- The cart page already handles vehicle quote status and shows appropriate payment options (Mobile Money or Card -- bank transfer was removed from web)
- Remove the bank transfer reference section since web users use PawaPay or Stripe

## Technical Details

### FeeSettings Update (`ShopCartContext.tsx`)

```typescript
export interface FeeSettings {
  markupPercent: number;
  vehicleMarkupPercent: number;  // NEW
  shippingBaseFeeUsd: number;
  shippingPercent: number;
}
```

Config loading adds:
```typescript
vehicleMarkupPercent: data.markup?.vehicleValue ?? data.markup?.value ?? 15,
```

### PriceBreakdown Vehicle Logic

For a vehicle **before quote**:
- Item price: shown
- Markup Fee: calculated with `vehicleMarkupPercent` (e.g., 18%)
- Shipping Fee: "Awaiting quote" (amber text, hidden value)
- Total: replaced with "Item + Markup Subtotal" and a note about pending shipping

For a vehicle **after quote** (in cart with `vehicleQuoteStatus = 'quoted'`):
- All fees shown using server-provided values
- Total shows the authoritative server total

### Vehicle Detection in ProductDetails

The product's provider and category information from the URL params and location state will be used. Vehicle products come through eBay Motors categories (6001, 6024) or are flagged `isVehicle` in the cart item data. On the product details page, we'll check:
- `location.state?.product?.isVehicle`
- Provider category patterns (vehicles category in the catalog)

### Email Update (`send-quote-email/index.ts`)

Change CTA URL from bank transfer session to web cart page:
```
${frontendBaseUrl}/cart
```
Change button text:
- EN: "View Quote & Pay"
- FR: "Voir le devis et payer"

Remove bank transfer reference section (not applicable for web).

## Files Modified

- `src/contexts/ShopCartContext.tsx` -- add `vehicleMarkupPercent` to FeeSettings
- `src/components/shop/PriceBreakdown.tsx` -- vehicle-aware pricing display
- `src/pages/shop/ProductDetails.tsx` -- pass `isVehicle` prop to PriceBreakdown
- `supabase/functions/send-quote-email/index.ts` -- web payment link instead of bank transfer

## No Regressions

- Non-vehicle products continue showing all fees normally (general markup)
- Mobile app is unaffected (uses its own cart summary from backend)
- Cart page vehicle quote flow unchanged (already masks fees for pending quotes)
- Admin quote submission flow unchanged (admin-apply-vehicle-quote still works the same)
