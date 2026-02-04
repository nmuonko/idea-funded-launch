

# Align Web Shop with Mobile App Architecture

Based on your comprehensive mobile app architecture documentation, I'll analyze what exists in the current web shop and what needs to be enhanced or added to achieve parity.

---

## Current Status vs. Mobile App

| Feature | Mobile App | Web Shop Status |
|---------|-----------|-----------------|
| **5-Tab Bottom Navigation** | Browse, Cart, Saved, Orders, Account | ❌ Missing - no persistent navigation |
| **Horizontal Product Sections** | Yes, with horizontal scroll | ⚠️ Grid layout, not horizontal scroll |
| **Skeleton Loaders with Shimmer** | Full component skeletons | ⚠️ Basic skeleton, no shimmer |
| **Drawer Menu** | Hamburger opens category sidebar | ✅ Implemented |
| **Filter Sheet (Bottom Modal)** | Price slider, condition, sort | ⚠️ Side sheet, not bottom modal |
| **Product Detail** | Swipeable gallery, dual currency | ✅ Implemented |
| **Cart Screen** | Full breakdown, quantity controls | ✅ Implemented |
| **Account Screen** | Profile, language, settings | ❌ Missing - redirects to /profile |
| **i18n (4 languages)** | FR, EN, SW, LN with instant switch | ✅ Implemented |
| **Multi-Currency Display** | USD + CDF on all prices | ⚠️ Only in PriceBreakdown |
| **Guest Cart** | localStorage persistence | ✅ Implemented |
| **Cache-first Loading** | Show cached, refresh background | ❌ Not implemented |
| **Pull-to-Refresh** | Manual refresh on lists | ❌ Not applicable to web |
| **Quick Add Button on Cards** | [+] button on product cards | ✅ Implemented |

---

## Implementation Plan

### 1. Add 5-Tab Bottom Navigation Bar

**Files to create/modify:**
- Create `src/components/shop/BottomNavigation.tsx`
- Update all shop pages to include the navigation

```text
┌──────────────────────────────────────────────────────────────┐
│     🏠        🛒        💾        📦        👤              │
│   Browse     Cart     Saved    Orders   Account            │
└──────────────────────────────────────────────────────────────┘
```

This will be a fixed bottom bar on mobile (hidden on desktop), matching the mobile app's 5-tab pattern.

---

### 2. Convert Product Sections to Horizontal Scroll

**File to modify:** `src/pages/shop/ShopHome.tsx`, `src/components/shop/ProductGrid.tsx`

Current: Products display in a responsive grid
Target: Horizontal scrolling sections like the mobile app

```text
Before:
┌───┐ ┌───┐ ┌───┐ ┌───┐
│   │ │   │ │   │ │   │  (grid, wraps)
└───┘ └───┘ └───┘ └───┘

After:
┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ →
│   │ │   │ │   │ │   │ │   │  (horizontal scroll)
└───┘ └───┘ └───┘ └───┘ └───┘
```

Create a new `HorizontalProductRow` component for home sections while keeping `ProductGrid` for search results.

---

### 3. Add Saved Items (Wishlist) Feature

**Files to create:**
- `src/pages/shop/SavedItems.tsx` - Saved for later page
- Update `src/contexts/ShopCartContext.tsx` - Add savedItems state

The mobile app has a "Saved" tab. We need to add:
- Save/unsave buttons on product cards and detail pages
- A dedicated saved items page
- localStorage persistence for guests

---

### 4. Add Orders Page for Shop

**Files to create:**
- `src/pages/shop/MyOrders.tsx` - Order history (shop-themed)
- This mirrors the existing `/orders` page but with shop styling

---

### 5. Add Account Screen for Shop

**Files to create:**
- `src/pages/shop/Account.tsx` - Profile, settings, support

Layout matching mobile:
```text
┌────────────────────────────────────────┐
│ Account                                │
├────────────────────────────────────────┤
│ 👤 John Doe                           │
│    john@example.com                    │
│    [Edit Profile]                      │
├────────────────────────────────────────┤
│ 🌐 Language              English ▼    │
│ 🔔 Notifications             [ON]      │
├────────────────────────────────────────┤
│ 💬 WhatsApp Support                    │
│ 📧 Email Support                       │
├────────────────────────────────────────┤
│ [Logout]                               │
└────────────────────────────────────────┘
```

---

### 6. Add Multi-Currency to Product Cards

**File to modify:** `src/components/shop/ProductCard.tsx`

Current: Shows only USD price
Target: Show both USD and CDF

```typescript
// Before
<span className="text-lg font-bold text-white">
  ${product.priceUsd.toFixed(2)}
</span>

// After
<div>
  <span className="text-lg font-bold text-white">
    ${product.priceUsd.toFixed(2)}
  </span>
  <span className="text-xs text-white/50 block">
    ≈ CDF {(product.priceUsd * exchangeRate).toLocaleString()}
  </span>
</div>
```

This requires fetching the exchange rate from `/mobile-public-config`.

---

### 7. Enhanced Skeleton Loaders with Shimmer

**Files to modify:**
- `src/components/shop/ProductCard.tsx` - Add skeleton variant
- `src/components/shop/ProductGrid.tsx` - Use product card skeletons

Match the mobile app's shimmer animation (left-to-right gradient sweep).

---

### 8. Add Horizontal Product Row Component

**File to create:** `src/components/shop/HorizontalProductRow.tsx`

```typescript
export function HorizontalProductRow({ products, loading }: Props) {
  return (
    <div className="relative">
      {/* Fade overlays */}
      <div className="absolute left-0 w-8 h-full bg-gradient-to-r from-black to-transparent z-10" />
      <div className="absolute right-0 w-8 h-full bg-gradient-to-l from-black to-transparent z-10" />
      
      {/* Scrollable container */}
      <div className="flex gap-4 overflow-x-auto scrollbar-hide px-4 py-2 -mx-4">
        {products.map(product => (
          <ProductCard key={product.id} product={product} className="w-40 flex-shrink-0" />
        ))}
      </div>
    </div>
  );
}
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/shop/BottomNavigation.tsx` | Create | 5-tab mobile nav bar |
| `src/components/shop/HorizontalProductRow.tsx` | Create | Horizontal scrolling product sections |
| `src/pages/shop/SavedItems.tsx` | Create | Wishlist/saved items page |
| `src/pages/shop/MyOrders.tsx` | Create | Shop-themed order history |
| `src/pages/shop/Account.tsx` | Create | Profile, settings, support page |
| `src/pages/shop/ShopHome.tsx` | Modify | Use horizontal rows for sections |
| `src/components/shop/ProductCard.tsx` | Modify | Add dual currency, wishlist button, skeleton |
| `src/contexts/ShopCartContext.tsx` | Modify | Add savedItems state |
| `src/App.tsx` | Modify | Add new routes |
| `src/lib/i18n/translations.ts` | Modify | Add missing translation keys |

---

## Priority Order

1. **Bottom Navigation** - Core mobile app navigation pattern
2. **Horizontal Product Rows** - Key visual alignment with mobile
3. **Multi-Currency Display** - Important for African market
4. **Saved Items Feature** - Required for 5-tab navigation
5. **Account Screen** - Complete the 5-tab experience
6. **My Orders (Shop)** - Shop-themed order history
7. **Enhanced Skeletons** - Polish and loading states

---

## Design Tokens to Apply

Based on the mobile documentation:

```typescript
const shopTheme = {
  colors: {
    primary: "#2563EB",       // AfriShop Blue
    accent: "#F59E0B",        // Yellow
    backgroundRoot: "#0A0A0A", // Pure black
    backgroundCard: "#141414", // Cards
    border: "#3F3F46",
    skeleton: "rgba(255, 255, 255, 0.08)",
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24
  },
  borderRadius: {
    sm: 12, md: 18, lg: 24
  }
};
```

---

## Expected Outcome

After implementation:
1. Web shop matches mobile app's 5-tab navigation structure
2. Home page uses horizontal scrolling sections like mobile
3. All prices show in dual currency (USD + CDF)
4. Users can save items for later (wishlist)
5. Complete account management within shop context
6. Smooth skeleton loaders with shimmer animations
7. Full i18n support across all new components

