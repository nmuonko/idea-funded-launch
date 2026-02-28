

# "Paste Any Link" — Free Scraping + Vehicle Quote Enforcement

## Overview

Users paste a product URL from any store. The system extracts product details using **free HTML scraping** (no Firecrawl costs), calculates markup and shipping, and lets them add to cart. **All vehicles — whether from the catalog or pasted links — always require a manual quote** (no direct checkout).

---

## Key Design Decisions

1. **No Firecrawl** — Reuse the existing `extract-price` edge function which already does free `fetch()` + HTML parsing (JSON-LD, og:tags, CSS selectors) for 15+ stores. Zero API cost.

2. **Vehicle Detection** — Reuse the existing `determineShippingCategory` utility. If a pasted link is detected as a vehicle (by URL, store, or title keywords), the item is flagged `is_vehicle=true` and `requires_manual_quote=true`. The price breakdown shows "Request a Quote" instead of a total, and checkout is blocked until an admin quote is approved.

3. **Pricing** — Reuse existing `cart/pricing.ts` calculations (30% general markup, 10% vehicle markup) and admin-defined shipping rates from `settings` table.

---

## User Flow

1. User taps "Paste Link" in bottom navigation
2. Pastes a product URL and taps "Get Price"
3. System calls `extract-price` (already exists) to get base price, title, image
4. **If vehicle detected**: Show product preview with base price only, "Request a Quote" button -- adds to cart with `is_vehicle=true`
5. **If regular item**: Show full price breakdown (base + markup + shipping = total in USD/CDF), "Add to Cart" and "Buy Now" buttons
6. Below the input, a grid of supported store logos links users to browse stores externally

---

## Technical Plan

### 1. New Frontend Page: `/paste-link`

**File: `src/pages/shop/PasteLink.tsx`** (Create)

- URL input field with clipboard paste button
- Calls existing `extract-price` edge function on submit
- Fetches admin settings (markup, shipping, exchange rate) from `get_public_config` RPC
- Runs `determineShippingCategory` logic client-side on the returned title/URL to detect vehicles
- For vehicles: shows product card with "Request a Quote" CTA
- For regular items: shows full price breakdown card with "Add to Cart" / "Buy Now"
- Supported stores grid at the bottom (Amazon, eBay, SHEIN, Walmart, Best Buy, etc.)

### 2. Price Breakdown Component

**File: `src/components/shop/PasteBreakdownCard.tsx`** (Create)

- Product image + title preview
- Two modes:
  - **Regular**: Base price, markup fee (30%), shipping fee, total USD, total CDF
  - **Vehicle**: Base price, markup fee (10%), shipping "Pending Quote", total "Request a Quote"
- "Add to Cart" button that calls existing `addItem()` from `useShopCart()`
- "Buy Now" button (add + navigate to `/cart`)

### 3. Supported Stores Grid

**File: `src/components/shop/SupportedStoresGrid.tsx`** (Create)

- Grid of store cards: Amazon, eBay, SHEIN, Walmart, Best Buy, Macy's, Home Depot, Wayfair, Mercari, Carvana, CarGurus
- Each card links to the store homepage in a new tab
- Bilingual labels (EN/FR)

### 4. Navigation Updates

**File: `src/components/shop/BottomNavigation.tsx`** (Edit)

- Add a 6th "Paste" tab with a `Link` icon between Browse and Cart
- Route: `/paste-link`

**File: `src/App.tsx`** (Edit)

- Add route: `<Route path="/paste-link" element={<PasteLink />} />`

### 5. Client-Side Vehicle Detection

**File: `src/lib/vehicleDetection.ts`** (Create)

- Lightweight port of the key vehicle detection logic from `shippingCategory.ts`:
  - Known vehicle store URLs (carvana, cargurus, tesla, edmunds)
  - Vehicle URL path patterns (`/cars`, `/vehicles`, `/inventory`)
  - Vehicle title keywords with exclusion list (so "car charger" is not flagged)
- Returns `{ isVehicle: boolean, confidence: number }`

### 6. Cart Integration

When adding a pasted-link item to cart via `useShopCart().addItem()`:
- For vehicles: set `is_vehicle: true`, `requires_manual_quote: true` -- the existing cart + checkout flow already blocks vehicle checkout until a quote is approved
- For regular items: normal cart flow with calculated fees

---

## Files Summary

| File | Action |
|------|--------|
| `src/pages/shop/PasteLink.tsx` | Create |
| `src/components/shop/PasteBreakdownCard.tsx` | Create |
| `src/components/shop/SupportedStoresGrid.tsx` | Create |
| `src/lib/vehicleDetection.ts` | Create |
| `src/components/shop/BottomNavigation.tsx` | Edit — add "Paste" tab |
| `src/App.tsx` | Edit — add `/paste-link` route |

No new edge functions needed. No Firecrawl usage. Zero additional API cost.

