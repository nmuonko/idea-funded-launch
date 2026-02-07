
# Fix Gaming Tab Returning Shoes

## Root Cause

The Gaming tab sends `q=xbox console ps5 console nintendo switch video games -case -cover...` to the backend. The intent classifier in `vehicleDetection.ts` doesn't recognize gaming queries -- it classifies them as `general`. The scorer only hard-drops shoes/clothing for `phone_device`, `phone_accessory`, and `vehicle_listing` intents. So shoes with "court" or "basketball" in the title pass through.

Additionally, eBay's API ignores the `-` negative keyword syntax, so those terms are treated as regular search words, polluting results.

## Plan (3 files)

### 1. Add `gaming` intent classification
**File**: `supabase/functions/_shared/vehicleDetection.ts`

- Add gaming keywords: `["xbox","ps5","ps4","playstation","nintendo","switch","console","gaming console","video game"]`
- Add `gaming` to the `SearchIntent["intentKey"]` type
- Insert classification before `general` fallback:
  ```
  else if (hasAny(lower, GAMING_KW)) intentKey = "gaming";
  ```

### 2. Add `gaming` hard-drop and scoring
**File**: `supabase/functions/_shared/searchIntentScorer.ts`

- Extend the WRONG_CATEGORY_KW hard-drop to include `gaming`:
  ```
  if (
    (intent.intentKey === "phone_device" || intent.intentKey === "phone_accessory" || intent.intentKey === "gaming") &&
    hasAny(title, WRONG_CATEGORY_KW)
  ) { return null; }
  ```
- Add a `gaming` scoring case that boosts console signals and drops accessories:
  ```
  case "gaming": {
    if (hasAny(title, WRONG_CATEGORY_KW)) return null;
    if (hasAny(title, ["console","xbox","playstation","ps5","ps4","nintendo","switch","controller","gamepad"])) score += 15;
    if (hasAny(title, ["case","cover","skin","sticker","decal","poster","shirt","shoes"])) return null;
    break;
  }
  ```

### 3. Fix frontend gaming query (remove broken negative keywords)
**File**: `src/pages/shop/SearchResults.tsx`

- Change the gaming fallback query from the long string with `-` prefixes to just `"video game console xbox ps5 nintendo switch"` -- clean terms that eBay actually understands. The backend scorer will handle filtering.

## Summary

| File | Change |
|------|--------|
| `supabase/functions/_shared/vehicleDetection.ts` | Add `gaming` intent detection with console keywords |
| `supabase/functions/_shared/searchIntentScorer.ts` | Hard-drop shoes/clothing/accessories for gaming intent; boost console signals |
| `src/pages/shop/SearchResults.tsx` | Clean up gaming query to remove broken negative keywords |
