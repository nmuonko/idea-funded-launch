

# Smarter Caching with Fuzzy Query Matching

## Current State

The caching system already handles:
- **Case insensitivity**: "iphone" = "IPHONE" = "iPhone" ✅
- **Accent normalization**: "café" = "cafe" ✅  
- **Whitespace**: "iphone  15" = "iphone 15" ✅
- **French translations**: "téléphone" → "smartphone" ✅

**Missing**: Typo tolerance and fuzzy matching. Currently, "iphon" and "iphone" are treated as completely separate queries, causing unnecessary API calls.

---

## Solution: Query Canonicalization Layer

Add a **canonicalization step** that corrects common typos and variations before the cache key is generated. This ensures that "iphon", "iphonne", and "iphone" all resolve to the same cache entry.

### Architecture

```text
User Query: "iphon 15 pro"
            ↓
Step 1: Normalize (lowercase, remove accents)
        → "iphon 15 pro"
            ↓
Step 2: Canonicalize (fuzzy match popular products)
        → "iphone 15 pro"  ← CORRECTED
            ↓
Step 3: Generate Cache Key
        → "search:v2:q=iphone 15 pro:..."
            ↓
Step 4: Cache Hit! (same key as "iPhone 15 Pro")
```

---

## Implementation Details

### 1. Create Query Canonicalization Module

**File:** `supabase/functions/_shared/queryCanonicalizer.ts`

A lightweight module that:
- Uses a **dictionary of popular product terms** with common typos
- Applies **Levenshtein distance** matching for unknown queries
- Preserves numbers and model identifiers

```typescript
// Popular search terms with common misspellings
const CANONICAL_TERMS: Record<string, string[]> = {
  "iphone": ["iphon", "iphonne", "ipone", "ifonee", "ifone", "iphn"],
  "samsung": ["samsun", "sumsung", "samung", "samsumg"],
  "airpods": ["airpod", "airpds", "airpood", "earpods"],
  "macbook": ["mackbook", "macbok", "mcbook", "macbuk"],
  "playstation": ["playstaion", "playstaton", "pleystation"],
  "xbox": ["xbx", "x box", "x-box"],
  "nintendo": ["nintedo", "nitendo", "nentendo"],
  "tesla": ["tesle", "tsla", "telsa"],
  "toyota": ["toyata", "toyoto", "toyta"],
  "honda": ["hond", "hunda"],
  // ... 50+ common product terms
};

export function canonicalizeQuery(normalized: string): string {
  // Split into tokens, canonicalize each, rejoin
  const tokens = normalized.split(/\s+/);
  const canonicalized = tokens.map(token => {
    // Check direct matches first
    for (const [canonical, typos] of Object.entries(CANONICAL_TERMS)) {
      if (typos.includes(token) || token === canonical) {
        return canonical;
      }
    }
    // Fuzzy match if no direct hit
    return fuzzyMatch(token) || token;
  });
  return canonicalized.join(" ");
}
```

### 2. Integrate into Cache Key Generation

**File:** `supabase/functions/_shared/catalogCache.ts`

Update `buildCacheKey` to canonicalize the query before generating the key:

```typescript
import { canonicalizeQuery } from "./queryCanonicalizer.ts";

export function buildCacheKey(type: CacheType, params: {...}): string {
  // ... existing code ...
  
  case "search":
    // Step 1: Normalize (lowercase, accents, whitespace)
    const qNorm = params.query ? normalizeQuery(params.query) : "";
    
    // Step 2: Canonicalize (typo correction)
    const qCanon = canonicalizeQuery(qNorm);
    
    // Step 3: Use canonicalized query for cache key
    return `search:${AMAZON_CACHE_VERSION}:domain=${domain}:env=${env}:q=${qCanon}:...`;
}
```

### 3. Add Logging for Canonicalization

When a query is corrected, log it for debugging:

```typescript
if (qCanon !== qNorm) {
  console.log(`[CACHE] Canonicalized query: "${qNorm}" → "${qCanon}"`);
}
```

---

## Dictionary of Common Typos

The canonicalization dictionary will include:

| Category | Examples |
|----------|----------|
| **Phones** | iphone, samsung, galaxy, airpods, tecno, infinix, xiaomi |
| **Computers** | macbook, laptop, lenovo, dell, thinkpad |
| **Gaming** | playstation, xbox, nintendo, controller |
| **Vehicles** | toyota, honda, tesla, ford, chevrolet, bmw, mercedes |
| **Electronics** | television, headphones, bluetooth, speaker |
| **Fashion** | adidas, nike, puma, gucci, louis vuitton |

Total: ~100 high-frequency product terms with 3-5 common typos each.

---

## Fuzzy Matching Fallback

For queries not in the dictionary, use **Levenshtein distance**:

```typescript
function fuzzyMatch(token: string, threshold = 2): string | null {
  // Skip short tokens (less than 4 chars) - too many false positives
  if (token.length < 4) return null;
  
  for (const [canonical, _] of Object.entries(CANONICAL_TERMS)) {
    const distance = levenshteinDistance(token, canonical);
    // Match if distance is at most 2 and token is similar length
    if (distance <= threshold && Math.abs(token.length - canonical.length) <= 2) {
      return canonical;
    }
  }
  return null;
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/_shared/queryCanonicalizer.ts` | **Create** | New module with typo dictionary and fuzzy matching |
| `supabase/functions/_shared/catalogCache.ts` | **Modify** | Import and use canonicalizer in `buildCacheKey` |
| `supabase/functions/catalog-search/index.ts` | **Modify** | Log canonicalization in search endpoint |

---

## Expected Behavior After Implementation

| User Searches | Before | After |
|---------------|--------|-------|
| "iphon 15" | Cache MISS, new API call | Cache HIT (resolves to "iphone 15") |
| "IPHONE 15" | Cache HIT ✅ | Cache HIT ✅ |
| "samsun galaxy" | Cache MISS | Cache HIT (resolves to "samsung galaxy") |
| "tesle model 3" | Cache MISS | Cache HIT (resolves to "tesla model 3") |
| "airpod pro" | Cache MISS | Cache HIT (resolves to "airpods pro") |

---

## Performance Impact

- **Negligible overhead**: Dictionary lookup is O(1), fuzzy matching only triggers for unrecognized terms
- **Reduced API calls**: Fewer duplicate searches to Amazon/eBay for typo variations
- **Better cache hit rate**: More users benefit from cached results
- **No database changes required**: Pure in-memory logic

---

## Future Enhancements (Optional)

1. **Learning from searches**: Track frequently-searched terms that produce results, add them to the dictionary
2. **Phonetic matching**: Use Soundex/Metaphone for brand names that sound similar
3. **User language detection**: Apply different typo patterns for French vs English keyboard layouts

