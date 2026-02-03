

# Dynamic Vehicle Search for ANY Brand/Model

## Problem Summary

While the "camry → camaro" fix resolved that specific case, the system needs **three protections working together** to handle ANY car brand/model without requiring constant updates:

| Issue | Current State | Example |
|-------|--------------|---------|
| Fuzzy matching corrupts vehicle tokens | Only pattern-matches `x5`, `s23` | "qx80" → could fuzzy to something else |
| Vehicle detection limited to listed models | Works for listed models only | "mercedes c300" might not trigger |
| Brand fallback missing | Brand+model requires exact model list | "nissan patrol" needs "patrol" in list |

---

## Implementation Plan

### 1. Canonicalizer Hardening: Skip Fuzzy Matching for Vehicle-Like Tokens

**File: `supabase/functions/_shared/queryCanonicalizer.ts`**

**Current fuzzy matching logic (line 245-268):**
```typescript
function fuzzyMatch(token: string, threshold: number = 2): string | null {
  if (token.length < 4) return null;
  if (/^\d+$/.test(token)) return null;           // Pure numbers
  if (/^[a-z]\d+$/i.test(token)) return null;     // e.g., "s23", "x15"
  // ... fuzzy matching
}
```

**Problem:** This misses tokens like:
- `qx80` (letter-letter-digits)
- `f-150` (contains hyphen)
- `4runner` (starts with digit)
- `c300` (letter-digits pattern)

**Fix - Expand the skip conditions:**

```typescript
function fuzzyMatch(token: string, threshold: number = 2): string | null {
  // Skip short tokens (too many false positives)
  if (token.length < 4) return null;
  
  // Skip pure numbers
  if (/^\d+$/.test(token)) return null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VEHICLE TOKEN PROTECTION: Skip fuzzy matching for vehicle model identifiers
  // These patterns are common in vehicle models (qx80, f-150, x5, c300, 4runner)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Skip tokens containing digits anywhere (qx80, c300, a4, 4runner, cx5, etc.)
  if (/\d/.test(token)) return null;
  
  // Skip tokens containing hyphens (f-150, cr-v, cx-5, e-tron, etc.)
  if (token.includes("-")) return null;
  
  // Existing patterns (now redundant but kept for clarity)
  // if (/^[a-z]\d+$/i.test(token)) return null; // covered by \d test above
  
  // ... rest of fuzzy matching logic
}
```

**Effect:** Tokens like `qx80`, `c300`, `f-150`, `4runner`, `cx5` will **never** be fuzzy-matched.

---

### 2. Vehicle Detection Brand Fallback: Any Brand + 2+ Tokens = vehicleMode

**File: `supabase/functions/catalog-search/index.ts`**

**Add a comprehensive brand aliases list (after line 198):**

```typescript
// ══════════════════════════════════════════════════════════════════════════════
// VEHICLE BRAND ALIASES: Used for brand-fallback detection
// If query contains any of these AND has 2+ tokens → vehicleMode=true
// ══════════════════════════════════════════════════════════════════════════════
const VEHICLE_BRAND_ALIASES: string[] = [
  // American
  "ford", "chevrolet", "chevy", "gmc", "dodge", "ram", "jeep", "chrysler",
  "buick", "cadillac", "lincoln", "tesla",
  // Japanese
  "toyota", "honda", "nissan", "mazda", "subaru", "lexus", "acura", "infiniti",
  "mitsubishi", "suzuki",
  // Korean
  "hyundai", "kia", "genesis",
  // German
  "bmw", "mercedes", "audi", "volkswagen", "vw", "porsche", "mini",
  // European
  "volvo", "jaguar", "land rover", "range rover", "alfa romeo", "fiat", "maserati",
  "ferrari", "lamborghini", "bentley", "rolls royce", "aston martin", "mclaren",
  // Motorcycles
  "harley", "harley davidson", "yamaha", "kawasaki", "ducati", "triumph", "indian",
];
```

**Update `isVehicleMakeModelQuery()` to include brand fallback (after line 313):**

```typescript
function isVehicleMakeModelQuery(query: string): boolean {
  const lower = query.toLowerCase().trim();
  const tokens = lower.split(/\s+/);
  
  // Check for accessory/toy keywords FIRST - these override everything
  const hasAccessoryKeywords = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    const matchedKeyword = VEHICLE_TOY_ACCESSORY_FILTER_KEYWORDS.find(kw => lower.includes(kw));
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] accessory_override",
      query,
      keyword: matchedKeyword,
    }));
    return false;
  }
  
  // A) Check for standalone vehicle names (Range Rover, F-150, Model 3, etc.)
  for (const pattern of STANDALONE_VEHICLE_PATTERNS) {
    if (pattern.test(lower)) {
      console.log(JSON.stringify({
        event: "[VEHICLE_DETECT] standalone_match",
        pattern: pattern.source,
        query,
      }));
      return true;
    }
  }
  
  // B) Check for brand + model combinations (existing logic)
  for (const { brand, models } of VEHICLE_MODEL_PATTERNS) {
    const brandRegex = new RegExp(`\\b${brand}\\b`, 'i');
    if (brandRegex.test(lower)) {
      for (const model of models) {
        if (lower.includes(model)) {
          console.log(JSON.stringify({
            event: "[VEHICLE_DETECT] make_model_match",
            brand,
            model,
            query,
          }));
          return true;
        }
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // C) BRAND FALLBACK: Brand + 2+ tokens AND no accessory keywords = vehicle intent
  // This catches queries like "mercedes c300", "bmw x5", "nissan patrol"
  // even when the specific model isn't in VEHICLE_MODEL_PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════
  if (tokens.length >= 2) {
    for (const brand of VEHICLE_BRAND_ALIASES) {
      // Check if brand is in the query (exact word match)
      const brandRegex = new RegExp(`\\b${brand.replace(/\s+/g, "\\s+")}\\b`, 'i');
      if (brandRegex.test(lower)) {
        console.log(JSON.stringify({
          event: "[VEHICLE_DETECT] brand_fallback",
          brand,
          tokenCount: tokens.length,
          query,
        }));
        return true;
      }
    }
  }
  
  return false;
}
```

---

### 3. Enhanced Logging for Vehicle Detection

Update `hasVehicleBuyingIntent()` function to use structured logging (around line 333):

```typescript
function hasVehicleBuyingIntent(query: string): boolean {
  const lower = query.toLowerCase().trim();
  
  // FIRST: Check for accessory/parts keywords
  const hasAccessoryKeywords = VEHICLE_ACCESSORY_KEYWORDS.some(kw => lower.includes(kw));
  if (hasAccessoryKeywords) {
    const matchedKeyword = VEHICLE_ACCESSORY_KEYWORDS.find(kw => lower.includes(kw));
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] result",
      qNorm: query,
      vehicleMode: false,
      reason: "accessory_override",
      keyword: matchedKeyword,
    }));
    return false;
  }
  
  // SECOND: Check for explicit buying intent keywords
  const hasExplicitBuyingIntent = VEHICLE_BUYING_INTENT_KEYWORDS.some(kw => lower.includes(kw));
  if (hasExplicitBuyingIntent) {
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] result",
      qNorm: query,
      vehicleMode: true,
      reason: "explicit_buying_intent",
    }));
    return true;
  }
  
  // THIRD: Check for make+model combinations (includes standalone + brand fallback)
  if (isVehicleMakeModelQuery(query)) {
    // Reason already logged by isVehicleMakeModelQuery
    return true;
  }
  
  console.log(JSON.stringify({
    event: "[VEHICLE_DETECT] result",
    qNorm: query,
    vehicleMode: false,
    reason: "no_vehicle_indicators",
  }));
  return false;
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/queryCanonicalizer.ts` | Skip fuzzy matching for tokens containing digits or hyphens |
| `supabase/functions/catalog-search/index.ts` | Add `VEHICLE_BRAND_ALIASES`, add brand fallback logic, enhance logging |

---

## Expected Behavior After Fix

### Canonicalizer Protection
| Token | Before | After |
|-------|--------|-------|
| `qx80` | Might fuzzy match | Kept as `qx80` ✅ |
| `c300` | Might fuzzy match | Kept as `c300` ✅ |
| `f-150` | Might fuzzy match | Kept as `f-150` ✅ |
| `4runner` | Might fuzzy match | Kept as `4runner` ✅ |

### Vehicle Detection with Brand Fallback
| Query | Detection Type | vehicleMode |
|-------|---------------|-------------|
| "toyota camry" | make_model_match | true ✅ |
| "mercedes c300" | brand_fallback (if c300 not listed) | true ✅ |
| "bmw x5" | make_model_match OR brand_fallback | true ✅ |
| "nissan patrol" | brand_fallback | true ✅ |
| "infiniti qx80" | make_model_match | true ✅ |
| "range rover" | standalone_match | true ✅ |
| "toyota floor mats" | accessory_override | false ✅ |
| "infiniti" (alone) | no_vehicle_indicators | false ✅ |

### Logging Output
```json
{"event":"[VEHICLE_DETECT] brand_fallback","brand":"mercedes","tokenCount":2,"query":"mercedes c300"}
{"event":"[VEHICLE_DETECT] result","qNorm":"mercedes c300","vehicleMode":true,"reason":"brand_fallback"}
{"event":"[CATALOG_SEARCH] forced_vehicle_category","ebayCategory":"6001","minPriceUsed":1000}
```

---

## Why This Works

1. **Canonicalizer hardening** prevents vehicle model identifiers from being corrupted by fuzzy matching
2. **Brand fallback** ensures ANY known brand + 2+ tokens triggers vehicle mode
3. **Accessory override** still prevents false positives for "toyota floor mats"
4. **Structured logging** enables debugging any edge case

This makes the system **dynamically resilient** - new car models (like "toyota gr supra 2025") will automatically work without code changes.

