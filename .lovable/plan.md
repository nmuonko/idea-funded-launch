

# Fix: Search Speed + Vehicle Quote False Positives

## Three Issues Identified

### 1. Search takes 14-18 seconds on first query

**Root cause**: The `enrichItemsWithMediaCounts` step is the bottleneck. Server logs show dozens of "Timeout" entries -- each media cache lookup has a 3-second timeout, and they pile up sequentially. Combined with the AI refiner, rewriter, DB-first search, and secondary/alt query attempts, the total exceeds 14 seconds.

**The server-side shared cache works correctly** -- once a query is cached (24h stale, 7d expire), subsequent users get it instantly. But the first search (cache miss) is painfully slow.

**Fix**: Skip media enrichment for search results entirely. Media counts (image galleries) are only useful on the product detail page. For search listings, we just need the primary image. Pass `skipPrefetch: true` to avoid blocking fetches, which eliminates the timeout cascade.

### 2. Car accessories incorrectly show "Awaiting quote"

**Root cause**: The `looksLikeVehicleListing()` function in `ProductDetails.tsx` checks for (brand + year) or (brand + body type). The product title "Car CarPlay Android Auto Navigation Stereo GPS Radio... **for Toyota Camry 2018-2021**" matches "toyota" (brand) + "2018" (year), so it returns `true`.

The exclusions list is missing car electronics/accessory keywords: stereo, radio, navigation, carplay, headunit, media player, dashcam, speaker, amplifier, antenna (already there but only exact match), gps, bluetooth, adapter, cable, obd, scanner.

**Fix**: Expand the exclusions list in `looksLikeVehicleListing` to include car electronics and accessory terms. Also add a stronger check: if the title contains "for [brand]" pattern (indicating compatibility, not the vehicle itself), it should NOT be flagged as a vehicle.

### 3. Quote should only trigger when added to cart (not on product page)

**Root cause**: In `PriceBreakdown.tsx`, line 35-36: `const vehiclePendingQuote = isVehicle ? true : ...`. When `isVehicle` is `true`, it ALWAYS shows "Awaiting quote" even on the product detail page before adding to cart. The comment even says "For vehicle product pages, ALWAYS show pending".

**Fix**: Change the logic so that the "Awaiting quote" state only applies when the item is actually in the cart. On the product detail page (before adding to cart), show normal shipping estimates instead.

## Technical Changes

### File 1: `src/pages/shop/ProductDetails.tsx` (lines 19-35)
Expand `looksLikeVehicleListing` exclusions:

```typescript
const exclusions = ['charger', 'mount', 'holder', 'brake pad', 'oil filter',
  'toy car', 'diecast', 'model car', 'rc car', 'hot wheels', 'key fob',
  'floor mat', 'seat cover', 'car wash', 'phone holder', 'emblem', 'badge',
  'washer bottle', 'wiper', 'antenna', 'mirror cover', 'mud flap',
  // Car electronics & accessories
  'stereo', 'radio', 'navigation', 'carplay', 'android auto', 'headunit',
  'head unit', 'media player', 'dashcam', 'dash cam', 'speaker', 'amplifier',
  'subwoofer', 'gps', 'bluetooth', 'adapter', 'cable', 'obd', 'scanner',
  'led light', 'light bar', 'fog light', 'backup camera', 'reverse camera',
  'tablet', 'touchscreen', 'display'];
```

Also add a "for [brand]" compatibility pattern check -- if the title says "for Toyota" rather than just "Toyota", it is an accessory, not a vehicle:

```typescript
// "for [brand]" pattern = accessory/part, not a vehicle
const forBrandPattern = /\bfor\s+(toyota|honda|ford|...)\b/i;
if (forBrandPattern.test(title)) return false;
```

### File 2: `src/components/shop/PriceBreakdown.tsx` (lines 33-37)
Change vehicle quote logic to only apply in cart context (not product page):

```typescript
// Only show "Awaiting quote" if this vehicle is actually IN the cart
// Product detail pages pass isVehicle but the item isn't in cart yet
const vehiclePendingQuote = hasVehicleItems && vehicleQuoteStatus !== 'quoted';
// Don't force quote state on product pages based on isVehicle prop alone
```

### File 3: `supabase/functions/catalog-search/index.ts` (lines 830-833)
Skip blocking media enrichment in search results:

```typescript
const { items: enrichedItems, stats: mediaStats } = await enrichItemsWithMediaCounts(
  supabase, filteredFinalItems as unknown as Record<string, unknown>[],
  undefined, { skipPrefetch: true }
);
```

This single change should cut 5-12 seconds from the first search by eliminating the media cache timeout cascade.

## Expected Results

| Issue | Before | After |
|-------|--------|-------|
| First search (cache miss) | 14-18 seconds | 3-6 seconds |
| Repeat search (any user, cache hit) | <1 second | <1 second (unchanged) |
| Car stereo "for Toyota Camry" | Shows "Awaiting quote" | Shows normal shipping fee |
| Actual vehicle listing | Shows "Awaiting quote" | Shows "Awaiting quote" (unchanged) |
| Quote on product page vs cart | Always shows on product page | Only shows when in cart |

## What Is NOT Changed

- No payment, checkout, or category logic changes
- Server-side shared cache behavior unchanged
- Client-side LRU + SWR from previous changes unchanged
- Vehicle detection for actual vehicles unchanged
