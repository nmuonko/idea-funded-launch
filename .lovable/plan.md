
# Fix: "Google Pixel" and Similar Queries Return Empty Results

## Root Cause

The intent classifier uses **substring matching** (`string.includes(keyword)`) instead of word-boundary matching. This means:

- "**goo**gle pixel" contains "**gle**" (Mercedes GLE model) as a substring
- `isVehicleQuery("google pixel")` returns `true` because "gle" is in `VEHICLE_QUERY_KEYWORDS`
- The system then classifies "google pixel" as `vehicle_listing` intent

This causes a cascade of failures:
1. Amazon is completely skipped (vehicle_listing skips Amazon)
2. Minimum price is set to $500 (vehicle buying intent)
3. eBay searches in "Cars and Trucks" category 6001
4. Zero phones returned

This same bug could affect ANY query containing a vehicle keyword as a substring (e.g., "eagle" contains "gle", "universal" contains "rs").

## Fix

### 1. Add word-boundary matching to vehicle detection (`vehicleDetection.ts`)

Replace the `isVehicleQuery` function's `.includes()` check with word-boundary regex matching. This ensures "gle" only matches when it appears as a standalone word, not as part of "google".

Also fix the `hasAny` helper function used by `classifySearchIntent` -- it has the same substring problem. Keywords like "gle", "amg", "rs", "x3", "x5" must match as whole words only.

Short keywords (3 characters or less) will use `\b` word-boundary regex. Longer keywords can safely use `.includes()` since false substring matches are unlikely.

### 2. Add phone brand exclusion to vehicle detection (`vehicleDetection.ts`)

Add a fast check: if query contains a known phone brand (iphone, samsung, pixel, google pixel, xiaomi, etc.), skip vehicle classification entirely unless a strong vehicle signal is also present (year, make+model, etc.). "Google Pixel" should immediately be recognized as a phone query.

### 3. Bump cache version to invalidate wrong results (`catalogCache.ts`)

Bump `AMAZON_CACHE_VERSION` to `v10` to flush cached empty results for "google pixel" and similar queries that were incorrectly classified.

## Technical Details

### The substring matching bug

```text
VEHICLE_QUERY_KEYWORDS includes "gle" (Mercedes GLE)

isVehicleQuery("google pixel"):
  "google pixel".includes("gle")  -->  TRUE  (bug!)
  
  "google".includes("gle") at position 3: "goo[gle]"
  
Result: "google pixel" is classified as a vehicle query
```

### The fix -- word-boundary matching for short keywords

```typescript
// Before (broken):
function hasAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

// After (fixed):
function hasAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => {
    if (kw.length <= 3) {
      // Short keywords need word-boundary matching
      return new RegExp(`\\b${kw}\\b`, 'i').test(lower);
    }
    return lower.includes(kw);
  });
}
```

Same fix applied to `isVehicleQuery`:
```typescript
export function isVehicleQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return VEHICLE_QUERY_KEYWORDS.some(kw => {
    if (kw.length <= 3) {
      return new RegExp(`\\b${kw}\\b`, 'i').test(lower);
    }
    return lower.includes(kw);
  });
}
```

### Phone brand priority gate in `classifySearchIntent`

Add a check before vehicle classification:
```typescript
// If query matches a phone brand, check for phone intent FIRST
const PHONE_ONLY_BRANDS = ["pixel", "iphone", "galaxy", "xiaomi", "tecno", "infinix", "oneplus", "oppo", "vivo", "realme", "redmi", "poco", "nothing phone"];
const hasPhoneBrand = PHONE_ONLY_BRANDS.some(b => lower.includes(b));

if (hasPhoneBrand && !hasVehicleSignal) {
  // Skip vehicle classification -- this is a phone query
}
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/vehicleDetection.ts` | Fix `isVehicleQuery` and `hasAny` to use word-boundary matching for short keywords. Add phone brand priority gate in `classifySearchIntent`. |
| `supabase/functions/_shared/catalogCache.ts` | Bump cache version to v10 |

### Expected Result
- "google pixel" classified as `phone_device` (not `vehicle_listing`)
- Amazon and eBay both searched for phones
- No $500 minimum price filter
- Returns 50-100 Google Pixel phone results
- No regression for actual vehicle queries ("gle 350", "bmw x5", etc.)
