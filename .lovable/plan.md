

# Fix Web Shop: Product Details & Checkout Issues

## Problem Summary

Two critical bugs are breaking the web shop experience:

### Issue 1: Product Details - "Product not found"
The `ProductDetails` page sends product info via POST body, but the `catalog-product` edge function expects GET query parameters. The request body is being ignored.

**Evidence from logs:**
```
[CATALOG_PRODUCT] id=MISSING provider=unknown error=INVALID_ID
```

### Issue 2: Checkout - "Edge Function returned non-2xx status"
The web checkout doesn't send `cart_item_ids` to the `mobile-checkout` function. The backend expects an array of database item IDs, but the web sends nothing.

**Evidence from logs:**
```
CHECKOUT_INIT { cart_item_ids_count: 0, ... }
CHECKOUT_ERROR { code: "EMPTY_CART", cart_item_ids: undefined }
```

---

## Root Cause Analysis

### Product Details Issue
- `ProductDetails.tsx` line 50-55: Uses `supabase.functions.invoke()` with body
- `catalog-product/index.ts` line 97-150: Parses from `url.searchParams` (GET)
- The function invoke sends POST, but the edge function reads from URL query params

### Checkout Issue
- Web cart uses localStorage for guests, or syncs via `mobile-get-cart`
- `mobile-get-cart` returns `cart_items` table data (not order_items)
- `mobile-checkout` expects `cart_item_ids` from the `order_items` table
- The web checkout doesn't call an "add items to order" function before checkout

---

## Solution

### Fix 1: Product Details - Use GET query params

**File: `src/pages/shop/ProductDetails.tsx`**

Change the API call from POST body to GET with query params:

```typescript
// BEFORE (line 50-55):
const { data, error } = await supabase.functions.invoke('catalog-product', {
  body: { 
    productId: decodeURIComponent(id), 
    provider 
  },
});

// AFTER:
const productIdDecoded = decodeURIComponent(id);
const fullId = `${provider}:${productIdDecoded}`;
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product?id=${encodeURIComponent(fullId)}`,
  {
    headers: {
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
  }
);
const data = await response.json();
if (!response.ok || data.status === 'error') {
  throw new Error(data.error?.message || 'Product not found');
}
```

---

### Fix 2: Checkout - Sync cart to order before checkout

The web needs to:
1. Create a DRAFT order with items before calling checkout
2. Pass the `cart_item_ids` (order_item IDs) to `mobile-checkout`

**File: `src/pages/shop/Checkout.tsx`**

Add a step to convert cart items to an order before payment:

```typescript
// In handleSubmit, before calling mobile-checkout:

// Step 1: Create order from cart items
const { data: orderData, error: orderError } = await supabase.functions.invoke('mobile-create-order-from-cart');

if (orderError || !orderData?.order_id) {
  throw new Error('Failed to prepare order: ' + (orderError?.message || 'Unknown error'));
}

// Step 2: Call checkout with the order's item IDs
const { data, error } = await supabase.functions.invoke('mobile-checkout', {
  body: {
    cart_item_ids: orderData.order_item_ids, // Array of order_item UUIDs
    cart_id: orderData.order_id,
    payment_method_preference: paymentMethod === 'card' ? 'CARD' : 
                                paymentMethod === 'bank_transfer' ? 'BANK_TRANSFER' : 
                                'MOBILE_MONEY',
  },
});
```

---

### Fix 3: Cart Context - Ensure items are synced to DB

**File: `src/contexts/ShopCartContext.tsx`**

Currently `addItem` syncs to `mobile-add-cart-item` but for checkout to work, items need to be in `order_items` table via a DRAFT order. The `mobile-create-order-from-cart` edge function should handle this conversion.

I'll verify the existing `mobile-create-order-from-cart` function handles this correctly.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/shop/ProductDetails.tsx` | Fix API call to use GET query params instead of POST body |
| `src/pages/shop/Checkout.tsx` | Add order creation step before checkout, pass `cart_item_ids` |

---

## Technical Details

### ProductDetails.tsx Changes (lines ~42-108)

```typescript
useEffect(() => {
  const fetchProduct = async () => {
    if (!provider || !id) return;
    
    try {
      setLoading(true);
      setError(null);

      // Build the full product ID in format "provider:productId"
      const productIdDecoded = decodeURIComponent(id);
      const fullId = `${provider}:${productIdDecoded}`;
      
      // Use GET request with query params (catalog-product expects this)
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product?id=${encodeURIComponent(fullId)}`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const data = await response.json();
      
      if (!response.ok || data.status === 'error') {
        throw new Error(data.error?.message || 'Product not found');
      }
      
      if (!data?.item) throw new Error('Product not found');

      const item = data.item;
      // ... rest of the mapping code stays the same
```

### Checkout.tsx Changes (lines ~107-161)

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  
  if (!termsAccepted) {
    toast({ title: 'Terms Required', ... });
    return;
  }

  if (items.length === 0) {
    toast({ title: 'Empty Cart', ... });
    return;
  }

  setLoading(true);
  try {
    // Update profile with shipping address
    await supabase.from('profiles').update({ ... }).eq('user_id', user?.id);

    // Step 1: Create/update DRAFT order from cart
    const { data: orderData, error: orderError } = await supabase.functions.invoke(
      'mobile-create-order-from-cart'
    );

    if (orderError) {
      console.error('Order creation error:', orderError);
      throw new Error('Failed to prepare your order. Please try again.');
    }

    if (!orderData?.order_id || !orderData?.order_item_ids) {
      throw new Error('Failed to create order. Please try again.');
    }

    console.log('Order created:', orderData.order_id, 'items:', orderData.order_item_ids.length);

    // Step 2: Proceed to checkout with order item IDs
    const { data, error } = await supabase.functions.invoke('mobile-checkout', {
      body: {
        cart_item_ids: orderData.order_item_ids,
        cart_id: orderData.order_id,
        payment_method_preference: paymentMethod === 'card' ? 'CARD' : 
                                    paymentMethod === 'bank_transfer' ? 'BANK_TRANSFER' : 
                                    'MOBILE_MONEY',
      },
    });

    if (error) throw error;

    // Handle payment flows (same as before)
    if (data?.payment_flow === 'STRIPE' && data?.clientSecret) {
      navigate(`/payment-callback?session_id=${data.checkout_session_id}`);
    } else if (data?.payment_flow === 'PAWAPAY' && data?.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else if (data?.payment_flow === 'BANK_TRANSFER') {
      navigate(`/bank-transfer-info?order_id=${data.order_id}`);
    } else if (data?.order_id) {
      toast({ title: 'Order Created', ... });
      await clearCart();
      navigate(`/orders/${data.order_id}`);
    }
  } catch (error: any) {
    console.error('Checkout error:', error);
    toast({ title: 'Checkout Failed', description: error.message, variant: 'destructive' });
  } finally {
    setLoading(false);
  }
};
```

---

## Expected Outcome

After these fixes:

1. **Product Details**: Clicking on a product will correctly load the product page with all details, images, and price breakdown

2. **Checkout**: The checkout flow will:
   - First create a DRAFT order from cart items
   - Then pass the order_item_ids to mobile-checkout
   - Proceed with the selected payment method (Mobile Money, Card, or Bank Transfer)

