
# Fix: Always Scrape eBay Products for Full Image Gallery

## Problem Identified
The eBay Browse API returns only 13 images for this iPhone listing, but the actual eBay webpage shows 30+ images. The current scraping fallback only triggers when API returns fewer than 10 images - so it never runs for this item.

## Solution
**Always try web scraping for eBay products** and use whichever source returns more images. This is a simple change to one function.

---

## Implementation

### File: `supabase/functions/_shared/ebayAdapter.ts`

**Change the `extractDetailImagesAsync` function** (around line 876):

**Current Logic:**
```typescript
// Only scrape if API returned fewer than 10 images
if (apiImages.length < 10 && item.itemId) {
  const scrapedImages = await scrapeEbayImages(item.itemId);
  if (scrapedImages.length > apiImages.length) {
    return scrapedImages;
  }
}
return apiImages;
```

**New Logic:**
```typescript
// ALWAYS try scraping for eBay items to get the full gallery
// The API often returns limited images (8-15) while the page has 30+
if (item.itemId) {
  const scrapedImages = await scrapeEbayImages(item.itemId);
  
  // Use whichever source has more images
  if (scrapedImages.length > apiImages.length) {
    return scrapedImages;
  }
}
return apiImages;
```

This removes the `< 10` threshold entirely - scraping will now run for **every** eBay product detail request.

---

## Database Cleanup

After deploying, clear cached data for the test item to force a fresh fetch:
```sql
DELETE FROM catalog_item_media 
WHERE provider = 'ebay' AND provider_item_id LIKE '%226415688103%';

DELETE FROM catalog_items 
WHERE id LIKE '%226415688103%';
```

---

## Deployment Steps
1. Update `extractDetailImagesAsync` function
2. Redeploy `catalog-product` edge function
3. Clear cache for test item
4. Test the iPhone listing to confirm 30+ images appear

---

## Technical Details

| Aspect | Before | After |
|--------|--------|-------|
| Scrape condition | `apiImages.length < 10` | Always for eBay items |
| iPhone 226415688103 | 13 images (API only) | 30+ images (scraped) |
| Performance impact | Minimal - adds ~500ms per product detail | Acceptable for better UX |
| Applies to | Only items with <10 API images | **All eBay products globally** |
