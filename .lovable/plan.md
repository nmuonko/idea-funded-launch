
# Fix: Mobile Section Filtering — Word Boundary Matching + Keyword Precision

## Root Cause (verified with live data)

The `filterItemsForProfile` function in `sectionProfiles.ts` uses `text.includes(keyword)` for matching, which is a pure substring check. This causes massive false positives:

- **Clothing shows bed frames** because "tee" matches "s**tee**l" in "Steel Slats"
- **Vehicles shows car accessories** because "car" matches "car vacuum", "car stereo", "car seat cover"
- **Electronics shows phones** because `excludeAny` doesn't include phone keywords -- phones aren't excluded from electronics at all
- **Sporting goods shows dining tables** because backfill returns wrong items that slip through substring matching
- **Parts shows dash cams and vacuums** because "dash cam", "car vacuum", "seat cover" are literally in `PARTS_WORDS`

Additionally, `normText()` includes the product URL in the text being matched, and Amazon/eBay URLs contain keyword params (e.g., `keywords=bed+frame+queen`) that trigger false matches on unrelated sections.

## Changes (2 files only)

### 1. `supabase/functions/_shared/sectionProfiles.ts`

**A) Replace `includes()` with word-boundary regex matching**

Change `matchesAny` to use `\b` word boundaries so "tee" only matches the word "tee", not "steel":

```text
Current:  text.includes(w)         -> "steel".includes("tee") = TRUE (wrong)
Fixed:    /\btee\b/.test(text)     -> /\btee\b/.test("steel") = FALSE (correct)
```

For multi-word phrases like "cell phone", keep using `includes()` since word boundaries don't apply well to phrases.

**B) Change `normText()` to use title only (not URLs)**

Remove `product_url` and `productUrl` from the text used for matching. URLs contain search keywords, category paths, and query params that cause false positives.

**C) Fix keyword lists to be more precise**

- **VEHICLE_CORE**: Remove overly generic words "car", "van" (match "car vacuum", "carplay", "canvas", "vanguard"). Replace with compound phrases: "used car", "new car", "car for sale", or keep "car" but add "car vacuum", "car stereo", "car charger", "car seat cover", "car mount", "car phone" to vehicle `excludeAny`
- **PARTS_WORDS**: Remove "dash cam", "car vacuum", "car stereo", "car charger", "car mount", "car phone", "seat cover", "floor mat" -- these are accessories, not parts. Move them to a new accessories-friendly section or just remove
- **CLOTHING_WORDS**: Remove "tee" (too short, matches "steel", "teeth", "steer"). Use "t-shirt" and "tee shirt" instead. Remove "boots" if it causes "bootstrap" matches (verify)
- **HOME_WORDS**: Remove "home" (too generic, matches everything with "home" in the URL or brand name). Keep specific terms like "sofa", "bed", "mattress", "furniture"
- **SPORTS_WORDS**: Remove "sport" and "sports" (too generic). Keep specific terms. Remove "outdoor" (matches "outdoor camera", "outdoor speaker")
- **ELECTRONICS_WORDS**: Add phone exclusions to `excludeAny` so iPhones don't appear in Electronics

**D) Add vehicle-specific accessory exclusions**

Vehicles `excludeAny` should include: "vacuum", "stereo", "radio", "dash cam", "dashcam", "seat cover", "floor mat", "mount", "holder", "charger", "scanner", "obd", "obd2", "diagnostic", "jump starter", "air freshener", "organizer", "cleaning"

### 2. `supabase/functions/_shared/mobileSectionsCache.ts`

- Bump `MOBILE_SECTIONS_SCHEMA_VERSION` from `2` to `3` to force cache invalidation and rebuild with the corrected filtering logic

### What does NOT change
- `catalog-home/index.ts` -- no changes, imports shared modules
- `catalog-home-v2/index.ts` -- no changes, imports shared modules
- Web UI / web response path -- completely untouched
- Payments, cart, checkout -- zero changes
- Response shape -- identical structure
- Cache table schema -- same table, just new schema_version value
- `titleNormalizer.ts` -- no changes needed

### Deploy
- Redeploy `catalog-home` and `catalog-home-v2` (they import the updated shared modules)
- First mobile request rebuilds sections with corrected word-boundary matching + cleaned keywords + bumped schema version
- Subsequent requests are instant cache hits

### Expected Results After Deploy
- Phones: only phones (iPhones, Samsung Galaxy, Pixel, etc.)
- Vehicles: only actual vehicle listings (no vacuums, no stereos, no seat covers)
- Electronics: laptops, TVs, cameras, speakers (no iPhones)
- Parts: brake pads, bumpers, headlights (no dash cams, no vacuums)
- Gaming: PS5, Xbox, Nintendo, controllers (no gaming mice, no gaming headsets)
- Clothing: actual shoes, shirts, jackets (no bed frames, no microwaves)
- Home: sofas, beds, kitchen appliances (correct)
- Sporting goods: actual sports equipment (no dining tables)
- Toys: toys and games (correct)
- Refurbished: renewed/refurbished items (correct)
