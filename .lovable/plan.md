

# Hot Products Public Page — Implementation Plan

## Summary
Create a public `/hot-products` page that displays the latest sent campaign's products with total prices. Add an RLS policy so anonymous/authenticated users can read sent campaigns. Everything is done here in Lovable — fully OTA-friendly, no Replit needed, no new mobile build required.

## Changes

### 1. Database Migration — Public RLS Policy
Add a SELECT policy on `hot_product_campaigns` allowing anyone to read rows where `status = 'sent'`:
```sql
CREATE POLICY "Public can view sent campaigns"
ON public.hot_product_campaigns
FOR SELECT
TO anon, authenticated
USING (status = 'sent');
```

### 2. New Page — `src/pages/shop/HotProducts.tsx`
- Query latest `hot_product_campaigns` where `status = 'sent'`, ordered by `sent_at desc`, limit 1
- Parse `products` JSON array (typed as `SelectedProduct` with `title`, `image_url`, `total_price_usd`, `provider`, `provider_product_id`)
- Display up to 10 products in a responsive grid matching the dark shop theme
- Each product card: image, title, total price (formatted via `formatCurrency`), "Order" button → `/product/{provider}/{provider_product_id}`
- Campaign title as page header
- "Return to Homepage" button at top
- Uses `ShopHeader` + `BottomNavigation` + `ShopFooter` for consistent layout
- No auth required — public page

### 3. Route — `src/App.tsx`
- Lazy-load `HotProducts` and add `<Route path="/hot-products" element={<HotProducts />} />`
- Place alongside other public shop routes (no `ShopProtectedRoute` wrapper)

### Files
| File | Action |
|------|--------|
| `src/pages/shop/HotProducts.tsx` | Create |
| `src/App.tsx` | Add lazy import + route |
| Database migration | Add public SELECT RLS policy |

