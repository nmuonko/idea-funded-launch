
# Fix Search Relevancy: Accessory Domination, Wrong-Category, Vehicle Zero-Results, Parts Bleed, and Timeouts

## Root Causes Identified

From the test results, three main failure patterns emerge:

1. **ACCESSORY_DOMINATION (phones)**: The intent scorer penalizes accessories (`score -= 80`) but they still rank high because the base token-match score is high (accessories often contain the phone model name). The scorer needs to HARD DROP accessories for `phone_device` intent, not just penalize.

2. **Nike shoes appearing for French queries** (`tecno camon 20`, `coque iphone 13`, `ecouteurs bluetooth`): The FR-to-EN fallback map is missing these terms. When the query is not rewritten, eBay returns garbage. Also `coque` and `ecouteurs bluetooth` are missing from the inline FR_EN_FALLBACK dictionary.

3. **Vehicle ZERO_RESULTS** (`toyota rav4`, `toyota hilux`, `toyota land cruiser`): These queries trigger `hasBuyingIntent=true` which forces `minPrice=1000` and `ebayCategory=6001`. The eBay API returns 0 for specific model queries in category 6001. Need to add model-specific fallback queries (e.g., just the model name) and relax to the broader eBay Motors parent category (6000).

4. **HIGH_PARTS_BLEED / SLOW_QUERY for vehicles**: The scorer drops parts for `vehicle_listing` but the threshold is too permissive. Also, vehicle queries hit both Amazon + eBay, and the 4s timeout fires before eBay finishes (vehicle searches take 5-8s on eBay Motors).

5. **PROVIDER_TIMEOUT**: The 4s timeout (`PROVIDER_TIMEOUT_MS = 4000`) is too aggressive for vehicle and French-language queries that need eBay Motors or rewrite processing.

## Changes

### File 1: `supabase/functions/_shared/searchIntentScorer.ts`
**Strengthen phone_device scoring to hard-drop accessories**

- For `phone_device` intent: return `null` (hard drop) when title contains accessory keywords AND does NOT contain device signals like "unlocked", "smartphone", "5g", "128gb", etc.
- Add a category sanity check: for `phone_device` and `phone_accessory`, drop items whose titles contain obvious wrong-category words like "shoes", "sneakers", "basketball", "clothing", "dress", "pants", "jewelry", "necklace", "ring", "bracelet".
- Boost items containing exact model match (e.g., "iPhone 13 Pro Max") by +25 points.

### File 2: `supabase/functions/catalog-search/index.ts`
**Fix French fallback gaps + increase vehicle timeout**

- Add missing FR-to-EN entries in `FR_EN_FALLBACK`:
  - `"coque"` -> `"phone case"`
  - `"ecouteurs bluetooth"` / `"écouteurs bluetooth"` -> `"bluetooth earbuds"`
  - `"protection ecran"` / `"protection écran"` -> `"screen protector"`
  - `"micro onde"` / `"micro ondes"` -> `"microwave"`
  - `"congelateur"` / `"congélateur"` -> `"freezer"`
  - `"cuisiniere"` / `"cuisinière"` -> `"gas stove"`
  - `"groupe electrogene"` / `"groupe électrogène"` -> `"generator"`
  - `"generateur"` / `"générateur"` -> `"generator"`
  - `"stabilisateur tension"` -> `"voltage stabilizer"`
  - `"panneau solaire"` -> `"solar panel"`
  - `"kit solaire"` -> `"solar kit"`
  - `"moto cg"` -> `"motorcycle"`
  - `"scooter 150cc"` -> `"150cc scooter"`
  - `"pneus toyota"` -> `"toyota tires"`
  - `"batterie voiture"` -> `"car battery"`
  - `"huile moteur"` -> `"motor oil"`
  - `"frigo americain"` / `"frigo américain"` -> `"side by side refrigerator"`
  - `"machine a laver"` / `"machine à laver"` -> `"washing machine"` (already present but ensure exact match)
- Increase `PROVIDER_TIMEOUT_MS` from `4000` to `6000` for vehicle intents (conditionally), keep 4000 for non-vehicle.

### File 3: `supabase/functions/_shared/ebayFetcher.ts`
**Add vehicle model fallback and broader category**

- When `hasBuyingIntent` is true and `categoryKey` is not explicitly set: use eBay Motors parent category `6000` instead of `6001` (Cars & Trucks only). Category 6000 includes motorcycles, powersports, boats, etc.
- Add `CATEGORY_MAPPING` entries for: `vehicles` -> `"6000"`, `sporting_goods` -> `"888"`, `toys` -> `"220"`, `jewelry_watches` -> `"281"`.
- Add vehicle query normalization map for standalone model names:
  - `"land cruiser"` -> `"Toyota Land Cruiser"`
  - `"prado"` -> `"Toyota Prado"`
  - `"hilux"` -> `"Toyota Hilux"`
  - `"rav4"` -> `"Toyota RAV4"`
  - `"corolla"` -> `"Toyota Corolla"`
  - `"civic"` -> `"Honda Civic"`
  - `"accord"` -> `"Honda Accord"`
  - `"camry"` -> `"Toyota Camry"`

### File 4: `supabase/functions/_shared/vehicleDetection.ts`
**Add French vehicle query keywords + parts keywords**

- Add to `PHONE_ACCESSORY_KEYWORDS`: `"coque"`, `"protection ecran"`, `"protection écran"`, `"batterie externe"`, `"chargeur sans fil"`.
- Add to `VEHICLE_PARTS_KEYWORDS`: `"pneus"`, `"jante"`, `"plaquette"`, `"huile"`, `"alternateur"`, `"demarreur"`, `"filtre"`, `"amortisseur"`.
- Add `"hilux"`, `"prado"`, `"land cruiser"`, `"landcruiser"` to `VEHICLE_LISTING_MODELS` (some may already be there -- verify and add missing ones).

### File 5: `supabase/functions/admin-search-relevancy-run/index.ts`
**Tighten scoring thresholds**

- Change ACCESSORY_DOMINATION threshold from `> 0.5` (50%) to `> 0.3` (30%) of top12 for phones category.
- Change HIGH_PARTS_BLEED threshold from `> 0.25` (25%) to `> 0.2` (20%) for vehicles category.
- Change LOW_RELEVANCY_TOP3 from `< 2` to `< 2` (keep same but add note: pass if top3 has >= 2 correct-intent items).
- Add `ACCESSORY_DOMINATION` check for `phone_accessories` category too (accessories search returning shoes = wrong category).

## Technical Details

### Scoring Change (searchIntentScorer.ts)

```text
Before: phone_device + accessory keyword -> score -= 80 (can still appear)
After:  phone_device + accessory keyword + NO device signal -> return null (HARD DROP)
        phone_device + wrong category (shoes/clothing/jewelry) -> return null (HARD DROP)
```

### Timeout Change (catalog-search/index.ts)

```text
Before: PROVIDER_TIMEOUT_MS = 4000 (for all queries)
After:  PROVIDER_TIMEOUT_MS = isVehicle ? 8000 : 5000
```

### eBay Category Change (ebayFetcher.ts)

```text
Before: hasBuyingIntent -> category 6001 (Cars & Trucks only)
After:  hasBuyingIntent -> category 6000 (eBay Motors -- includes all vehicle types)
```

### Expected Test Improvements

| Query | Before | After |
|-------|--------|-------|
| iphone 13 pro max | ACCESSORY_DOMINATION | PASS (accessories hard-dropped) |
| samsung s23 ultra | ACCESSORY_DOMINATION + LOW_RELEVANCY | PASS |
| tecno camon 20 | Nike shoes in top3 | PASS (FR fallback + wrong-category drop) |
| coque iphone 13 | Nike shoes | PASS (FR fallback "phone case iphone 13") |
| ecouteurs bluetooth | Nike shoes + SLOW | PASS (FR fallback "bluetooth earbuds") |
| toyota rav4 | ZERO_RESULTS | Results (category 6000 + model normalization) |
| toyota hilux | ZERO_RESULTS | Results |
| toyota land cruiser | ZERO_RESULTS | Results |
| mercedes c300 | HIGH_PARTS_BLEED | PASS (parts hard-dropped by scorer) |
| groupe electrogene | PROVIDER_TIMEOUT | Results (FR fallback "generator") |
| scooter 150cc | PROVIDER_TIMEOUT | Results (FR fallback + higher timeout) |

## Files Modified Summary

| File | Change |
|------|--------|
| `supabase/functions/_shared/searchIntentScorer.ts` | Hard-drop accessories for phone_device; drop wrong-category items |
| `supabase/functions/catalog-search/index.ts` | Add ~20 FR-EN fallback entries; dynamic timeout based on intent |
| `supabase/functions/_shared/ebayFetcher.ts` | Use category 6000 for vehicles; add model normalization; add category mappings |
| `supabase/functions/_shared/vehicleDetection.ts` | Add French accessory/parts keywords |
| `supabase/functions/admin-search-relevancy-run/index.ts` | Tighten ACCESSORY_DOMINATION to 30%, PARTS_BLEED to 20% |
