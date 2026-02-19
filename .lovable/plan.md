

# Frontend Layout Improvements for a Professional, Ad-Ready Look

## Overview

Based on my review of the current homepage, product cards, and overall layout, here are targeted improvements to make the web app look more polished and trustworthy -- critical when driving paid traffic from ads.

---

## 1. Trust Badges Strip (Below Hero Banner)

Add a horizontal strip of trust signals between the hero banner and category tabs. This is standard on professional e-commerce sites and builds instant credibility with new visitors from ads.

**What it shows (4 icons in a row):**
- Shield icon: "Paiement Securise" / "Secure Payment"
- Truck icon: "Livraison USA-RDC" / "USA to DRC Delivery"  
- Headphones icon: "Support 24/7"
- RefreshCw icon: "Remboursement" / "Money-Back Guarantee"

**Implementation:** New `TrustBadgesStrip` component, added to `ShopHome.tsx` between the hero and category tabs.

---

## 2. Product Card Visual Upgrade

Current cards are dark-on-dark (`bg-white/5` with `border-white/10`), making products hard to distinguish. The improvement:

- **White image background**: Change the image area from `bg-white/5` to `bg-white` so product photos pop against the dark page
- **Slightly brighter card border**: Increase from `border-white/10` to `border-white/15` for better definition
- **Add subtle shadow on hover**: `hover:shadow-lg hover:shadow-blue-500/10` for a premium feel
- **Rating stars visible in compact mode**: Currently hidden on compact cards -- show them in a smaller format

**Files:** `ProductCard.tsx`, `ProductCardSkeleton.tsx`

---

## 3. "How It Works" Section on Homepage

The `HowItWorks` component already exists but is not shown on the homepage. Adding the horizontal variant between the hero and product grid gives first-time visitors (from ads) an instant understanding of the service.

**Implementation:** Add `<HowItWorks variant="horizontal" />` to `ShopHome.tsx`, positioned after the trust badges strip.

---

## 4. Header Polish

- **Add a thin colored accent line** at the very top of the header (2px gradient bar from blue to cyan) -- a small detail that adds a premium feel
- **Logo area spacing**: Slightly increase logo height from `h-8` to `h-9` for better presence

**File:** `ShopHeader.tsx`

---

## 5. Category Tabs Refinement

- **Active tab**: Add a subtle bottom indicator dot/line in addition to the gradient background
- **Inactive tabs**: Slightly increase background opacity from `bg-white/5` to `bg-white/8` for better visibility
- **Icons**: Increase from `h-4 w-4` to `h-4.5 w-4.5` (use `h-[18px] w-[18px]`) for better tap targets

**File:** `CategoryTabs.tsx`

---

## 6. Footer Visual Cleanup

- Add the AfriShop logo at the top of the footer
- Add a subtle gradient divider instead of the plain `border-t border-white/10`

**File:** `ShopFooter.tsx`

---

## Summary of Files to Change

| File | Changes |
|------|---------|
| `src/components/shop/TrustBadgesStrip.tsx` | **New file** -- trust badges component |
| `src/pages/shop/ShopHome.tsx` | Add TrustBadgesStrip + HowItWorks sections |
| `src/components/shop/ProductCard.tsx` | White image bg, brighter borders, hover shadow, compact ratings |
| `src/components/shop/ProductCardSkeleton.tsx` | Match card style updates |
| `src/components/shop/ShopHeader.tsx` | Top accent bar, logo size |
| `src/components/shop/CategoryTabs.tsx` | Active indicator, better inactive contrast |
| `src/components/shop/ShopFooter.tsx` | Logo + gradient divider |

All changes are CSS/styling and component composition -- no backend or data model changes needed.

