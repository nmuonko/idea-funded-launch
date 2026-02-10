

# Add Saved/Favorites Item Count Badge

## Overview
Show a count badge next to the "Favorites" link in the Quick Links section of the hamburger menu drawer, matching the existing cart badge pattern. Also add the same badge to the bottom navigation's "Saved" tab.

## Changes

### 1. `src/components/shop/ShopHeader.tsx`
- Import `useShopCart` from the cart context
- Read `savedItems` from the context
- Add a badge/count indicator next to the Favorites link in the Quick Links section (lines 143-150), similar to how the cart shows its item count

### 2. `src/components/shop/BottomNavigation.tsx`
- Read `savedItems` from the existing `useShopCart()` hook (already imported)
- Add a badge to the "saved" tab (same style as the cart badge) showing `savedItems.length` when greater than 0

## Technical Details

**ShopHeader.tsx** - Add to the Favorites link (line 143-150):
```typescript
import { useShopCart } from '@/contexts/ShopCartContext';

// Inside ShopHeader():
const { savedItems } = useShopCart();

// In the Favorites Link, add badge after the label:
<Link to="/saved" ...>
  <Heart className="h-4 w-4" />
  {shop.savedTab || 'Favorites'}
  {savedItems.length > 0 && (
    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
      {savedItems.length > 99 ? '99+' : savedItems.length}
    </span>
  )}
</Link>
```

**BottomNavigation.tsx** - Add badge logic for the "saved" tab (same pattern as cart badge):
```typescript
const { itemCount, savedItems } = useShopCart();

// In the render loop, update showBadge logic:
const showBadge = (tab.key === 'cart' && itemCount > 0) || 
                  (tab.key === 'saved' && savedItems.length > 0);
const badgeCount = tab.key === 'cart' ? itemCount : savedItems.length;
```

## Files Modified
- `src/components/shop/ShopHeader.tsx` -- add saved items count badge in Quick Links
- `src/components/shop/BottomNavigation.tsx` -- add saved items count badge on Saved tab
