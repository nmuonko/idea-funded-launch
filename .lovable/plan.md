
Goal

Make every Amazon outbound click from your site — especially the “View on Amazon” button on the product detail page — resolve to the real Amazon product detail page, not a category or best-sellers page.

Root cause I found

- `src/lib/amazonProductLinks.ts` is still too permissive: if it cannot cleanly extract an ASIN, it falls back to the raw stored Amazon URL, even when that URL is bad, stale, or not a PDP.
- `src/pages/shop/ProductDetails.tsx` can keep Amazon IDs in prefixed form like `amazon_B0...` because it prefers `item.id` over `providerProductId` / `provider_product_id`, so the CTA does not always have a clean ASIN source.
- Amazon link building is fragmented in several places (`ProductDetails`, cart persistence, admin catalog links, order links, hot products), so bad Amazon URLs can keep getting stored and reused.

Plan

1. Harden the shared Amazon URL helper
- Replace/extend the logic in `src/lib/amazonProductLinks.ts` with a strict `normalizeAmazonProductUrl(...)`.
- It will accept:
  - a raw Amazon URL
  - a plain ASIN
  - prefixed IDs like `amazon_B0...` or `rainforest_B0...`
- It will extract the ASIN and always return:
  - `https://www.amazon.com/dp/{ASIN}`
- It will never return:
  - `/-/dp/`
  - category/search pages
  - raw bad Amazon URLs

2. Fix the product detail page data flow
- In `src/pages/shop/ProductDetails.tsx`, prefer `providerProductId` / `provider_product_id` over `item.id` when setting the product id.
- Use the shared normalizer for the “View on Amazon” CTA after:
  - initial nav state
  - main product fetch
  - retry fetch
  - variant switching
- If an Amazon ASIN cannot be resolved, do not send the user to a wrong Amazon page.

3. Enforce the same normalizer everywhere Amazon URLs are created or persisted
- `src/contexts/ShopCartContext.tsx`: normalize Amazon URLs before storing/syncing them.
- `src/pages/shop/HotProducts.tsx`: stop passing internal fallback URLs as if they were Amazon product URLs.
- `src/pages/admin/CatalogCache.tsx`: replace inline Amazon `/dp/` formatting with the shared helper.
- `src/lib/orderProductLinks.ts`: remove duplicated Amazon parsing and delegate to the shared helper.
- `src/pages/OrderDetail.tsx` and any remaining Amazon anchors: normalize before opening.
- Update `src/components/shop/ViewSourceLink.tsx` too so future usage stays consistent.

Technical details

- No UI styling changes.
- Canonical outbound format will be `https://www.amazon.com/dp/{ASIN}`.
- Before: some Amazon clicks could use raw/stale URLs or prefixed IDs and land on category/best-seller pages.
- After: Amazon clicks will either open the canonical PDP URL or not render/open at all if no valid ASIN exists.
- There is no test runner configured in this repo, so verification should be done with deterministic helper examples plus end-to-end preview clicks.

Verification

- Helper examples to verify:
  - `https://www.amazon.com/-/dp/B0BYLM8RRW` -> `https://www.amazon.com/dp/B0BYLM8RRW`
  - `B0BYLM8RRW` -> `https://www.amazon.com/dp/B0BYLM8RRW`
  - `amazon_B0BYLM8RRW` -> `https://www.amazon.com/dp/B0BYLM8RRW`
  - an already valid PDP URL -> canonical PDP URL
- End-to-end checks:
  - open Amazon items from home/search/similar products
  - land on the internal product detail page
  - click “View on Amazon”
  - confirm the new tab opens the exact Amazon product page

Likely files to change

- `src/lib/amazonProductLinks.ts`
- `src/pages/shop/ProductDetails.tsx`
- `src/contexts/ShopCartContext.tsx`
- `src/pages/shop/HotProducts.tsx`
- `src/pages/admin/CatalogCache.tsx`
- `src/lib/orderProductLinks.ts`
- `src/pages/OrderDetail.tsx`
- `src/components/shop/ViewSourceLink.tsx`
