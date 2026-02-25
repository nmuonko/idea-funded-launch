
## Fix: Amazon Products Showing Only One Image

### Root Cause

The `catalog-product` endpoint has a gallery enrichment step for eBay products (scrapes the listing page for additional images when only 0-1 are found), but **no equivalent exists for Amazon**. When an Amazon product has only 1 image stored in `catalog_items.images`, that single image is all that gets returned.

The existing `extractAmazonImageFromJson()` function in `get-product-info` already knows how to parse Amazon's `colorImages` JSON -- but it only extracts a **single** image. The full `colorImages` JSON contains ALL product images (hiRes + large variants).

### Plan

#### 1. Add `scrapeAmazonGallery()` function to `catalog-product/index.ts`

Create a function similar to `scrapeEbayGallery()` that:
- Fetches the Amazon product page HTML (using mobile URL for better scraping success)
- Extracts ALL images from the `colorImages` JSON pattern (which contains `hiRes` and `large` URLs for every product photo)
- Falls back to `imageGalleryData` pattern
- Deduplicates and upgrades all images to high-res
- Returns up to 10 unique images

#### 2. Add Amazon gallery enrichment block in the DB-hit path

After the existing eBay gallery enrichment block (line ~750), add a parallel block for Amazon:
- Trigger when `provider === "rainforest"` and `item.images.length <= 1`
- Call `scrapeAmazonGallery()` using the product URL or constructed Amazon URL (`https://www.amazon.com/dp/{ASIN}`)
- If more images are found, update `item.images`, `item.imageUrls`, `item.mainImageUrl`
- Persist enriched gallery back to `catalog_items` and `catalog_item_media` (fire-and-forget), same pattern as eBay

#### 3. Firecrawl fallback (if direct scrape fails)

If the direct HTML fetch gets bot-blocked (Amazon is aggressive), fall back to the existing Firecrawl scrape endpoint to extract images from the rendered page.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Add `scrapeAmazonGallery()` function + Amazon gallery enrichment block after eBay enrichment |

### Technical Details

**Key extraction pattern** (already proven in `get-product-info`):
```text
'colorImages': { 'initial': [ {"hiRes":"https://...","large":"https://..."}, ... ] }
```

The scraper will extract ALL `hiRes` URLs from this array (typically 5-8 images per product), falling back to `large` URLs when `hiRes` is null.

**Enrichment triggers only when needed** (0-1 images), so products that already have full galleries from Rainforest API raw data won't incur extra fetches.
