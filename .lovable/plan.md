

# Build Web Catalog Frontend (Bypass App Store)

## Strategy

Instead of fighting Apple's review process, we'll create a **full web shopping experience** that mirrors the mobile app. This gives users access to the product catalog directly via browser at `afrishop-usa.com/shop`, completely bypassing App Store restrictions.

**Benefits:**
- No App Store approval needed
- Immediate deployment
- Works on any device with a browser
- Can be installed as a PWA (Progressive Web App)
- Full control over content and features

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    afrishop-usa.com                          │
├─────────────────────────────────────────────────────────────┤
│  /              → How It Works (existing)                    │
│  /shop          → Product Catalog Home (NEW)                 │
│  /shop/search   → Search Results (NEW)                       │
│  /shop/product  → Product Details (NEW)                      │
│  /shop/cart     → Shopping Cart (NEW)                        │
│  /shop/checkout → Checkout Flow (NEW)                        │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│            Existing Edge Functions (No Changes)              │
├─────────────────────────────────────────────────────────────┤
│  catalog-home      → Home feed with sections                 │
│  catalog-search    → Product search                          │
│  catalog-product   → Product details                         │
│  mobile-add-cart-item → Add to cart                          │
│  mobile-get-cart   → Get cart contents                       │
│  mobile-checkout   → Create order                            │
└─────────────────────────────────────────────────────────────┘
```

---

## New Components to Create

### 1. Product Grid Component
```text
src/components/shop/ProductGrid.tsx
├── Responsive grid (2 cols mobile, 4 cols desktop)
├── Product card with image, title, price
├── Add to cart button
└── Infinite scroll support
```

### 2. Product Card Component
```text
src/components/shop/ProductCard.tsx
├── Image with lazy loading
├── Provider badge (Amazon/eBay)
├── Price in USD
├── Quick add to cart
└── Link to product details
```

### 3. Search Bar Component
```text
src/components/shop/SearchBar.tsx
├── Search input with icon
├── Category dropdown filter
├── Recent searches (localStorage)
└── Search suggestions
```

### 4. Cart Drawer Component
```text
src/components/shop/CartDrawer.tsx
├── Slide-in drawer from right
├── Cart items list
├── Quantity controls
├── Remove item button
├── Total with estimated fees
└── Checkout button
```

### 5. Category Tabs Component
```text
src/components/shop/CategoryTabs.tsx
├── Horizontal scrolling tabs
├── Icons for each category
├── Active state indicator
└── Maps to catalog tabs API
```

---

## New Pages to Create

### Page 1: Shop Home (`/shop`)
**File:** `src/pages/shop/ShopHome.tsx`

Features:
- Hero banner with search
- Category tabs (Electronics, Clothing, etc.)
- Featured sections from `catalog-home` API
- "See All" links per section
- Sticky cart button with item count

### Page 2: Search Results (`/shop/search`)
**File:** `src/pages/shop/SearchResults.tsx`

Features:
- Search query in URL (`/shop/search?q=iphone`)
- Filter sidebar (price, condition, category)
- Sort dropdown (price, relevance)
- Infinite scroll product grid
- No results state with suggestions

### Page 3: Product Details (`/shop/product/:id`)
**File:** `src/pages/shop/ProductDetails.tsx`

Features:
- Image gallery with zoom
- Product title and description
- Price breakdown (item + shipping + fees)
- Add to cart button
- Provider info and link
- Similar products section

### Page 4: Shopping Cart (`/shop/cart`)
**File:** `src/pages/shop/ShopCart.tsx`

Features:
- Full cart view (not just drawer)
- Edit quantities
- Remove items
- Price breakdown table
- Continue shopping / Checkout buttons
- Empty cart state

### Page 5: Checkout (`/shop/checkout`)
**File:** `src/pages/shop/Checkout.tsx`

Features:
- Requires authentication
- Shipping address form
- Order summary
- Payment method selection (Stripe/PawaPay/Bank)
- Terms acceptance
- Place order button

---

## Technical Implementation

### API Integration Pattern
All catalog calls use the existing Edge Functions:

```typescript
// Fetch home sections
const { data } = await supabase.functions.invoke('catalog-home');

// Search products
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/catalog-search?q=${query}&limit=24`,
  { headers: { 'apikey': ANON_KEY } }
);

// Get product details
const { data } = await supabase.functions.invoke('catalog-product', {
  body: { productId, provider }
});

// Add to cart (requires auth)
const { data } = await supabase.functions.invoke('mobile-add-cart-item', {
  body: { productId, quantity, ... }
});
```

### Cart State Management
- **Guest users:** Store cart in localStorage
- **Logged in:** Sync with database via `mobile-get-cart`
- **Login merge:** Merge guest cart on authentication

### Responsive Design
- Mobile-first approach matching existing dark theme
- Sticky header with search and cart
- Bottom navigation on mobile
- Drawer-based cart on mobile, sidebar on desktop

---

## File Structure

```text
src/
├── pages/
│   └── shop/
│       ├── ShopHome.tsx
│       ├── SearchResults.tsx
│       ├── ProductDetails.tsx
│       ├── ShopCart.tsx
│       └── Checkout.tsx
├── components/
│   └── shop/
│       ├── ProductGrid.tsx
│       ├── ProductCard.tsx
│       ├── SearchBar.tsx
│       ├── CartDrawer.tsx
│       ├── CategoryTabs.tsx
│       ├── ShopHeader.tsx
│       ├── ShopFooter.tsx
│       ├── FilterSidebar.tsx
│       ├── PriceBreakdown.tsx
│       └── EmptyStates.tsx
├── hooks/
│   └── useShopCart.ts
└── contexts/
    └── ShopCartContext.tsx
```

---

## Routes to Add (App.tsx)

```typescript
// New shop routes
<Route path="/shop" element={<ShopHome />} />
<Route path="/shop/search" element={<SearchResults />} />
<Route path="/shop/product/:provider/:id" element={<ProductDetails />} />
<Route path="/shop/cart" element={<ShopCart />} />
<Route path="/shop/checkout" element={
  <ProtectedRoute>
    <Checkout />
  </ProtectedRoute>
} />
```

---

## Design Theme

Match existing dark Tesla-inspired theme:
- Background: Black (`bg-black`)
- Cards: Glass effect (`bg-white/5 backdrop-blur-xl border-white/10`)
- Primary accent: Cyan gradient (`from-blue-500 to-cyan-500`)
- Text: White with opacity variants
- Animations: Framer Motion for transitions

---

## Navigation Updates

### PublicLayout Header
Add "Shop" link to navigation:
```typescript
const navLinks = [
  { to: "/shop", label: "Shop" },  // NEW - First position
  { to: "/", label: "How It Works" },
  { to: "/about", label: "About" },
  ...
];
```

### Shop Header (New)
Dedicated header for shop pages:
- Search bar (always visible)
- Category dropdown
- Cart icon with badge
- User menu (login/profile)

---

## Implementation Phases

### Phase 1: Core Shopping Experience
1. Create ShopCartContext for cart state management
2. Build ProductCard and ProductGrid components
3. Create ShopHome page with catalog-home integration
4. Add CategoryTabs component
5. Implement SearchResults page with catalog-search

### Phase 2: Product & Cart
6. Build ProductDetails page with gallery
7. Create CartDrawer component
8. Implement useShopCart hook with localStorage
9. Add ShopCart full page view

### Phase 3: Checkout & Orders
10. Build Checkout page with address form
11. Integrate payment providers (existing functions)
12. Add order confirmation flow
13. Link to existing /orders page for tracking

### Phase 4: Polish
14. Add loading skeletons
15. Implement empty states
16. Add error boundaries
17. Mobile-optimize all views
18. Add PWA manifest for "Add to Home Screen"

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/contexts/ShopCartContext.tsx` | Cart state management |
| `src/hooks/useShopCart.ts` | Cart operations hook |
| `src/components/shop/ProductCard.tsx` | Product display card |
| `src/components/shop/ProductGrid.tsx` | Grid layout for products |
| `src/components/shop/SearchBar.tsx` | Search input component |
| `src/components/shop/CategoryTabs.tsx` | Category navigation |
| `src/components/shop/CartDrawer.tsx` | Slide-out cart |
| `src/components/shop/ShopHeader.tsx` | Shop-specific header |
| `src/components/shop/PriceBreakdown.tsx` | Cost breakdown display |
| `src/pages/shop/ShopHome.tsx` | Home page with sections |
| `src/pages/shop/SearchResults.tsx` | Search results page |
| `src/pages/shop/ProductDetails.tsx` | Product detail page |
| `src/pages/shop/ShopCart.tsx` | Full cart page |
| `src/pages/shop/Checkout.tsx` | Checkout flow |

## Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Add shop routes |
| `src/components/public/PublicLayout.tsx` | Add "Shop" nav link |

---

## Outcome

Once implemented, users can:
1. Visit `afrishop-usa.com/shop` in any browser
2. Browse products from Amazon/eBay
3. Search and filter by category
4. Add items to cart
5. Create an account or login
6. Complete checkout with payment
7. Track orders

**No App Store needed. No Apple approval required. Full shopping experience on the web.**

