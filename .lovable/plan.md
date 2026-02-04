
# Fix Mobile Money and Card Payment Checkout Failure

## Problem Summary

The checkout is failing with "Failed to prepare your order. Please try again." because cart items are not syncing to the database.

**Error from logs:**
```
[mobile-add-cart-item] Validation error: Required, Required raw productUrl:
[mobile-create-order-from-cart] No draft order found
```

---

## Root Cause

The `ShopCartContext.tsx` sends cart items to the backend with **wrong field names**:

| What Web Shop Sends | What Backend Expects |
|---------------------|---------------------|
| `product_url` | `productUrl` |
| `base_price_usd` | `productPrice` |
| `provider_product_id` | *(not required)* |

The `mobile-add-cart-item` edge function uses Zod validation that requires `productUrl` and `productPrice` (camelCase), but the web shop sends `product_url` and `base_price_usd` (snake_case).

---

## Solution

Update `src/contexts/ShopCartContext.tsx` to send the correct field names that match the edge function's expected schema:

**Current code (lines 170-179):**
```typescript
await supabase.functions.invoke('mobile-add-cart-item', {
  body: {
    provider_product_id: item.productId,
    store: item.provider,
    title: item.title,
    image_url: item.imageUrl,
    base_price_usd: item.priceUsd,
    quantity: item.quantity,
    product_url: item.productUrl,
  },
});
```

**Fixed code:**
```typescript
await supabase.functions.invoke('mobile-add-cart-item', {
  body: {
    productUrl: item.productUrl,
    productPrice: item.priceUsd,
    quantity: item.quantity,
    productTitle: item.title,
    productImageUrl: item.imageUrl,
  },
});
```

---

## Technical Details

### What the Edge Function Expects (from Zod schema)

```typescript
const addCartItemSchema = z.object({
  productUrl: z.string().min(1, "Product URL is required"),  // REQUIRED
  productPrice: z.number().positive("Price must be positive"), // REQUIRED
  quantity: z.number().int().positive().optional().default(1),
  productTitle: z.string().max(500).optional(),
  productImageUrl: z.string().max(2048).optional(),
});
```

### Why This Fixes Checkout

1. **Current flow (broken):**
   - User adds item → localStorage ✓
   - Web tries to sync to backend → Validation fails (wrong field names)
   - User tries checkout → `mobile-create-order-from-cart` finds no DRAFT order → Error

2. **Fixed flow:**
   - User adds item → localStorage ✓
   - Web syncs to backend with correct fields → Order created in DB as DRAFT ✓
   - User checkout → `mobile-create-order-from-cart` finds DRAFT order → Success ✓

---

## Files to Modify

| File | Change |
|------|--------|
| `src/contexts/ShopCartContext.tsx` | Fix field names in `addItem()` function to match edge function schema |

---

## Additional Consideration

The `productUrl` is **required** by the edge function, but in the current `CartItem` interface it's optional:

```typescript
export interface CartItem {
  ...
  productUrl?: string;  // Optional
}
```

Need to ensure `productUrl` is always provided when adding items. The `ProductDetails.tsx` already passes `product.productUrl`, so this should work. But we should add a validation check.
