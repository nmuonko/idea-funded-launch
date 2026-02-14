

# Fix: Vehicle Product Detail — Restore "Add to Cart" Button + Quote Request Visibility

## Two Issues

### Issue 1: Quote requests not visible in admin portal
The quote request IS being created successfully in the **test** database (I can see the Toyota RAV4 PENDING quote from today). However, the **live/production** database has no matching record. This is expected behavior: test and live databases are isolated. When you view the admin portal on the published URL, it queries the live database. To see the test quote, access the admin portal via the **preview URL** instead.

No code change needed for this -- it's a test vs. live data separation issue.

### Issue 2: Button flow on product detail page
Currently, vehicles immediately show "Demander un devis" instead of "Add to Cart". The user wants:

1. **Before adding to cart**: Show normal "Add to Cart" button (with the vehicle price breakdown: Article + Markup + shipping note)
2. **After adding to cart + logged in**: Show "Demander un devis" button (which triggers the quote request)
3. **After quote requested**: Show "Demande envoyee" confirmation

## Changes

### File 1: `src/pages/shop/ProductDetails.tsx`

**Detect if this vehicle is already in the user's cart** by checking `items` from `useShopCart()`:

```typescript
const { addItem, items } = useShopCart();
const { user } = useAuth();

// Check if this vehicle product is already in the cart
const isInCart = product && items.some(
  item => item.productId === product.productUrl || item.productId === product.id
);
const showRequestQuote = isVehicle && isInCart && !!user;
```

**Update the button logic** (lines 680-703):

- Default state (not in cart): "Add to Cart" with ShoppingCart icon -- calls `handleAddToCart`
- `showRequestQuote` (in cart + logged in + vehicle): "Demander un devis" with FileText icon -- calls `handleRequestQuote` (invokes `mobile-request-quote`)
- After quote requested: "Demande envoyee" with Check icon (green)

**Add `handleRequestQuote` function**:
```typescript
const [quoteRequested, setQuoteRequested] = useState(false);

const handleRequestQuote = useCallback(async () => {
  setAdding(true);
  try {
    const { error } = await supabase.functions.invoke('mobile-request-quote', {
      body: { locale: language }
    });
    if (error) throw error;
    setQuoteRequested(true);
    toast.success(shop.requestSent || 'Quote request sent!');
  } catch (err) {
    console.error('[ProductDetails] Quote request failed:', err);
    toast.error('Failed to request quote');
  } finally {
    setAdding(false);
  }
}, [language, shop]);
```

**Button rendering logic**:
```text
IF quoteRequested:
  [Check icon] "Demande envoyee" (green, disabled)

ELSE IF showRequestQuote (vehicle + in cart + logged in):
  [FileText icon] "Demander un devis" -> handleRequestQuote

ELSE IF added (just added, transient):
  [Check icon] "Added to Cart" (green)

ELSE:
  [ShoppingCart icon] "Add to Cart" -> handleAddToCart
```

**Remove the auto-quote from ShopCartContext** (lines 342-357): The auto-request-quote on every cart sync causes duplicate requests. Instead, quote requests should only happen when the user explicitly clicks "Demander un devis". This block will be removed.

### File 2: `src/contexts/ShopCartContext.tsx`

**Remove the auto-quote request block** (lines 342-357) that fires on every `syncCart`. The quote should only be triggered by explicit user action on the product detail page or cart page.

### File 3: `src/components/shop/PriceBreakdown.tsx`

No changes needed -- the current `isDetailVehicle` logic (showing Article + Markup + shipping note) is correct for the product detail page.

## Summary of Button States for Vehicles

| State | Button Label | Icon | Action |
|-------|-------------|------|--------|
| Not in cart | "Ajouter au panier" | ShoppingCart | Add to cart |
| Just added (3s) | "Ajoute au panier" | Check (green) | None |
| In cart + logged in | "Demander un devis" | FileText | Request quote |
| Quote sent | "Demande envoyee" | Check (green) | None (disabled) |

Non-vehicle products are completely unaffected -- they always show "Add to Cart" / "Added to Cart".

## Files Modified
- `src/pages/shop/ProductDetails.tsx` -- add quote request flow, update button states
- `src/contexts/ShopCartContext.tsx` -- remove auto-quote-request from syncCart

