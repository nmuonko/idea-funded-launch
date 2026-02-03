

# Enhanced Dynamic Vehicle Search Implementation

## Overview
Refine the vehicle detection system to require an extra "vehicle signal" for brand fallback detection, preventing false positives like "bmw keychain" while still catching legitimate vehicle queries like "mercedes c300".

---

## Current State Analysis

The codebase already has:
- **Canonicalizer hardening**: Skips fuzzy matching for tokens with digits or hyphens ✅
- **Standalone patterns**: 25+ regex patterns for iconic vehicle names ✅
- **Brand+model detection**: 30+ brand entries with 200+ model names ✅
- **Brand fallback**: Triggers on brand + 2+ tokens ⚠️ (missing vehicle signal check)
- **Accessory override**: Checks for toy/accessory keywords first ✅

**Gap identified**: The brand fallback currently activates for ANY "brand + 2 tokens" without requiring a vehicle-specific signal. This causes false positives:
- "bmw keychain" → would trigger vehicleMode (wrong)
- "toyota gift card" → would trigger vehicleMode (wrong)

---

## Implementation Plan

### 1. Canonicalizer Hardening (Already Done - Minor Enhancement)

**File: `supabase/functions/_shared/queryCanonicalizer.ts`**

The current implementation already has:
```typescript
// Skip tokens containing ANY digit (qx80, c300, a4, 4runner, cx5, 530i, etc.)
if (/\d/.test(token)) return null;

// Skip tokens containing hyphens (f-150, cr-v, cx-5, e-tron, etc.)
if (token.includes("-")) return null;
```

**Enhancement**: Add a clearer comment explaining the alphanumeric rule:
```typescript
// VEHICLE TOKEN PROTECTION:
// Skip hyphenated identifiers (f-150, cx-5, e-tron)
if (token.includes("-")) return null;

// Skip alphanumeric identifiers (letters+digits OR digits+letters)
// Examples: qx80, c300, 4runner, cx5, x5, 530i, a4
// This regex checks: does token have BOTH letters AND digits?
if (/[a-z]/i.test(token) && /\d/.test(token)) return null;
```

This is already covered by `/\d/.test(token)` but we can make it more explicit.

---

### 2. Add Vehicle Signal Detection for Brand Fallback

**File: `supabase/functions/catalog-search/index.ts`**

Add a new helper to detect vehicle-specific signals that distinguish vehicle queries from accessory queries:

```typescript
// ══════════════════════════════════════════════════════════════════════════════
// VEHICLE SIGNALS: Indicators that distinguish vehicle queries from accessories
// Used to require an extra signal for brand fallback (prevents "bmw keychain" false positive)
// ══════════════════════════════════════════════════════════════════════════════
const VEHICLE_SIGNAL_PATTERNS = {
  // Year patterns (1990-2029)
  year: /(19|20)\d{2}/,
  
  // Alphanumeric model codes (qx80, c300, x5, 530i, etc.)
  alphanumeric: /\b[a-z]+\d+[a-z]?\b|\b\d+[a-z]+\b/i,
  
  // Vehicle-specific terminology
  keywords: [
    "suv", "truck", "pickup", "sedan", "coupe", "4x4", "awd", "4wd", "2wd", "fwd", "rwd",
    "miles", "mileage", "vin", "engine", "transmission", "v6", "v8", "turbo",
    "hybrid", "electric", "diesel", "automatic", "manual", "convertible", "wagon",
    "hatchback", "crossover", "for sale", "buy", "used", "mileage", "certified",
  ],
};

/**
 * Check if query contains a vehicle-specific signal
 * Used to validate brand fallback detection (prevents false positives like "bmw keychain")
 */
function hasVehicleSignal(query: string): { hasSignal: boolean; signal: string | null } {
  const lower = query.toLowerCase();
  
  // Check for year (1990-2029)
  if (VEHICLE_SIGNAL_PATTERNS.year.test(lower)) {
    const match = lower.match(VEHICLE_SIGNAL_PATTERNS.year);
    return { hasSignal: true, signal: `year:${match?.[0]}` };
  }
  
  // Check for alphanumeric model codes (qx80, c300, x5, etc.)
  if (VEHICLE_SIGNAL_PATTERNS.alphanumeric.test(lower)) {
    const match = lower.match(VEHICLE_SIGNAL_PATTERNS.alphanumeric);
    return { hasSignal: true, signal: `alphanumeric:${match?.[0]}` };
  }
  
  // Check for vehicle-specific keywords
  for (const keyword of VEHICLE_SIGNAL_PATTERNS.keywords) {
    if (lower.includes(keyword)) {
      return { hasSignal: true, signal: `keyword:${keyword}` };
    }
  }
  
  return { hasSignal: false, signal: null };
}
```

---

### 3. Update `isVehicleMakeModelQuery` with Vehicle Signal Requirement

**File: `supabase/functions/catalog-search/index.ts`**

Modify the brand fallback section (around lines 342-362) to require a vehicle signal:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// C) BRAND FALLBACK: Brand + 2+ tokens + vehicle signal = vehicle intent
// This catches queries like "mercedes c300", "bmw x5 2023", "nissan patrol"
// BUT requires a vehicle signal to prevent false positives like "bmw keychain"
// ═══════════════════════════════════════════════════════════════════════════
const tokens = lower.split(/\s+/);
if (tokens.length >= 2) {
  // Check for vehicle signal BEFORE checking brands
  const vehicleSignal = hasVehicleSignal(lower);
  
  for (const brand of VEHICLE_BRAND_ALIASES) {
    const brandRegex = new RegExp(`\\b${brand.replace(/\s+/g, "\\s+")}\\b`, 'i');
    if (brandRegex.test(lower)) {
      // Brand found - check if we have a vehicle signal
      if (vehicleSignal.hasSignal) {
        console.log(JSON.stringify({
          event: "[VEHICLE_DETECT] brand_fallback",
          brand,
          tokenCount: tokens.length,
          signal: vehicleSignal.signal,
          query,
        }));
        return true;
      } else {
        // Brand without vehicle signal - log and continue
        console.log(JSON.stringify({
          event: "[VEHICLE_DETECT] brand_no_signal",
          brand,
          tokenCount: tokens.length,
          query,
          note: "Brand found but no vehicle signal - not triggering vehicleMode",
        }));
      }
    }
  }
}
```

---

### 4. Enhanced Final Logging in `hasVehicleBuyingIntent`

**File: `supabase/functions/catalog-search/index.ts`**

Update the function to include structured result logging:

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
    const matchedKeyword = VEHICLE_BUYING_INTENT_KEYWORDS.find(kw => lower.includes(kw));
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] result",
      qNorm: query,
      vehicleMode: true,
      reason: "explicit_buying_intent",
      keyword: matchedKeyword,
    }));
    return true;
  }
  
  // THIRD: Check for make+model combinations (includes standalone + brand fallback)
  if (isVehicleMakeModelQuery(query)) {
    // Reason already logged by isVehicleMakeModelQuery
    console.log(JSON.stringify({
      event: "[VEHICLE_DETECT] result",
      qNorm: query,
      vehicleMode: true,
      reason: "make_model_or_pattern",
    }));
    return true;
  }
  
  // No vehicle indicators found
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
| `supabase/functions/_shared/queryCanonicalizer.ts` | Minor comment enhancement for alphanumeric rule clarity |
| `supabase/functions/catalog-search/index.ts` | Add `VEHICLE_SIGNAL_PATTERNS`, `hasVehicleSignal()`, update brand fallback logic, enhance result logging |

---

## Expected Behavior After Fix

### Brand Fallback with Vehicle Signal Requirement

| Query | Has Brand | Has Signal | vehicleMode | Reason |
|-------|-----------|------------|-------------|--------|
| "mercedes c300" | ✅ mercedes | ✅ alphanumeric:c300 | true | brand_fallback |
| "bmw x5 2023" | ✅ bmw | ✅ year:2023, alphanumeric:x5 | true | brand_fallback |
| "nissan patrol 4x4" | ✅ nissan | ✅ keyword:4x4 | true | brand_fallback |
| "toyota camry" | ✅ toyota | — | true | make_model_match |
| "toyota camry for sale" | ✅ toyota | ✅ keyword:for sale | true | make_model_match |
| **"bmw keychain"** | ✅ bmw | ❌ no signal | **false** | brand_no_signal |
| **"toyota gift card"** | ✅ toyota | ❌ no signal | **false** | brand_no_signal |
| "toyota floor mats" | ✅ toyota | — | false | accessory_override |
| "range rover" | — | — | true | standalone_match |

---

## Technical Details

### Vehicle Signal Types

1. **Year patterns**: `/(19|20)\d{2}/` matches 1990-2029
   - "bmw x5 2023" → signal: `year:2023`

2. **Alphanumeric codes**: `/\b[a-z]+\d+[a-z]?\b|\b\d+[a-z]+\b/i`
   - "mercedes c300" → signal: `alphanumeric:c300`
   - "infiniti qx80" → signal: `alphanumeric:qx80`
   - "bmw 530i" → signal: `alphanumeric:530i`

3. **Vehicle keywords**: suv, truck, 4x4, awd, miles, vin, transmission, etc.
   - "nissan patrol 4x4" → signal: `keyword:4x4`
   - "honda civic used" → signal: `keyword:used`

### Logging Output Examples

**Success (brand fallback with signal):**
```json
{"event":"[VEHICLE_DETECT] brand_fallback","brand":"mercedes","tokenCount":2,"signal":"alphanumeric:c300","query":"mercedes c300"}
{"event":"[VEHICLE_DETECT] result","qNorm":"mercedes c300","vehicleMode":true,"reason":"make_model_or_pattern"}
```

**Prevented false positive (brand without signal):**
```json
{"event":"[VEHICLE_DETECT] brand_no_signal","brand":"bmw","tokenCount":2,"query":"bmw keychain","note":"Brand found but no vehicle signal - not triggering vehicleMode"}
{"event":"[VEHICLE_DETECT] result","qNorm":"bmw keychain","vehicleMode":false,"reason":"no_vehicle_indicators"}
```

---

## Why This Works

1. **Canonicalizer hardening** is already in place - tokens like `c300`, `qx80`, `f-150` are protected from fuzzy matching

2. **Standalone patterns** catch iconic vehicle names that don't need a brand prefix (Range Rover, Mustang, Corvette)

3. **Brand+model patterns** catch explicit combinations in `VEHICLE_MODEL_PATTERNS` (Toyota Camry, Infiniti QX80)

4. **Brand fallback with vehicle signal** catches dynamic brand+model queries (Mercedes C300, BMW 530i) while rejecting brand+accessory queries (BMW keychain, Toyota gift card)

5. **Accessory override** always runs first to handle explicit accessory queries (Toyota floor mats)

This creates a robust, layered detection system that handles new vehicle models automatically while preventing false positives.

