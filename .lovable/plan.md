

# Hot Products: 10 Products with Admin Price Control & Direct Add-to-Cart

## What Changes

### 1. Admin Portal (`src/pages/admin/HotProducts.tsx`)
- **Raise product limit from 3 to 10** (currently hardcoded at line 168/188)
- **Add a "Final Price" override field** per product — admin sets the all-inclusive price directly, bypassing auto-calculation. The `total_price_usd` field already exists and is editable; we just need to make it the primary input and de-emphasize the breakdown
- **Keep Paste Link and Catalog search** as the two methods to add products
- Update the product count display from `/3` to `/10`

### 2. Public Hot Products Page (`src/pages/shop/HotProducts.tsx`)
- **Redesign for visual impact**: Larger product cards with gradient overlays, fire/deal badges, and a hero banner section
- **Add "Add to Cart" button** instead of navigating to product detail — uses `useShopCart().addItem()` to add directly with the admin-set `total_price_usd` as the price. Users can then go to cart and checkout without viewing item details
- **Keep "View Details" as secondary action** (clicking the card still navigates to product page)
- **Attractive layout**: 2-col mobile, 3-col tablet, 4-5 col desktop with animated cards, "🔥 Deal" badges, and countdown/urgency styling
- **"Shipping included" prominent** beneath each price

### 3. Direct Checkout Flow
When "Add to Cart" is clicked on hot products:
- Call `addItem({ title, provider, providerId, imageUrl, priceUsd: total_price_usd, quantity: 1, productUrl })` 
- The `total_price_usd` (admin-set final price) becomes the cart item's `priceUsd`, so the user sees exactly what the admin set — no markup/shipping recalculation needed
- Show toast confirmation with "Go to Cart" action
- Works for both web and mobile (same component, same cart context)

### Files
| File | Action |
|------|--------|
| `src/pages/admin/HotProducts.tsx` | Edit: raise limit to 10, emphasize final price input |
| `src/pages/shop/HotProducts.tsx` | Edit: redesign UI, add direct add-to-cart |

