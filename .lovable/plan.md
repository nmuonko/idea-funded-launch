

# Fix: Hide Shipping/Total for Vehicles on Product Detail, Show "Demander un devis"

## Summary

For vehicle listings on the web product detail page, hide the shipping fee line and total estimate entirely. Show only Article price + Frais de marge + a note that shipping is determined after quote. Change the "Add to Cart" button to "Demander un devis" (Request a Quote).

## Changes

### 1. `src/components/shop/PriceBreakdown.tsx`

- Add `context?: 'product-detail' | 'cart'` prop (default `'cart'`)
- Update logic:
  - `isDetailVehicle = isVehicle && context === 'product-detail'`
  - `showPendingQuote = !isDetailVehicle && hasVehicleItems && vehicleQuoteStatus !== 'quoted'`
- When `isDetailVehicle`:
  - Render Article line + Markup fee line (with amounts)
  - Render a note: "Le transport sera determine apres devis" / "Shipping will be determined after quote"
  - Do NOT render shipping line, subtotal, or total
- When `showPendingQuote` (cart context): existing behavior unchanged ("En attente du devis" on shipping line)
- Normal items: unchanged

### 2. `src/pages/shop/ProductDetails.tsx`

- Pass `context="product-detail"` to `<PriceBreakdown>`
- When `isVehicle` is true, change the Add to Cart button:
  - Label: use `shop.requestQuote` ("Demander un devis") instead of "Add to Cart"
  - After-click label: use `shop.requestSent` ("Demande envoyee") instead of "Added to Cart"
  - Icon: keep ShoppingCart (or switch to `FileText` for quote feel)
  - Action: still calls `handleAddToCart` (existing cart+quote workflow)

### 3. `src/lib/i18n/translations.ts`

Add 3 new keys to each language's `shop` block:

| Key | EN | FR | SW | LN |
|---|---|---|---|---|
| `requestQuote` | Request a Quote | Demander un devis | Omba Bei | Senga Ntalo |
| `requestSent` | Request Sent | Demande envoyee | Ombi Limetumwa | Esengeli Etindami |
| `shippingAfterQuote` | Shipping will be determined after quote | Le transport sera determine apres devis | Usafirishaji utaamuliwa baada ya bei | Transport ekoyebana nsima ya ntalo |

## Technical Details

### PriceBreakdown rendering branches

```text
IF isDetailVehicle (product detail + vehicle):
  [Article]           $17,799.00
  [Frais de marge]    $1,779.90
  [Note: shipping determined after quote]
  -- no shipping, no subtotal, no total --

ELSE IF showPendingQuote (cart + vehicle not yet quoted):
  [Article]           $17,799.00
  [Frais de marge]    $1,779.90
  [Shipping]          "En attente du devis"
  [Sous-total]        $19,578.90
  [Note: shipping after admin quote]

ELSE (normal items):
  [Article]           $XX.XX
  [Frais de marge]    $X.XX
  [Shipping]          $X.XX
  [Total]             $XX.XX
```

### Files modified
- `src/components/shop/PriceBreakdown.tsx`
- `src/pages/shop/ProductDetails.tsx`
- `src/lib/i18n/translations.ts`

No mobile files touched. No backend changes.
