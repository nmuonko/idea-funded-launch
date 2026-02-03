

# Fix: Query Canonicalizer Breaking "Range Rover" → "Range Router"

## Root Cause

The canonicalizer has a **critical bug** in its token processing logic:

| Step | What Happens | Problem |
|------|--------------|---------|
| 1 | Query: "range rover" | - |
| 2 | Split into tokens: `["range", "rover"]` | Multi-word keys like `"range rover"` are never checked |
| 3 | `canonicalizeToken("rover")` | No direct match |
| 4 | `fuzzyMatch("rover", threshold=2)` | Levenshtein distance to "router" is 2 |
| 5 | Returns "router" | **Wrong!** "rover" is not a typo for "router" |
| 6 | Final output: "range router" | Vehicle detection fails |

**Evidence from logs:**
```
[CACHE] Canonicalized query: "range rover" → "range router"
[CATALOG_SEARCH] request {"hasBuyingIntent":false,"hasMakeModel":false}
```

## Solution

Two fixes are needed:

### 1. Add "rover" to Protected Vehicle Terms

Add "rover" as a canonical term that maps to itself, preventing fuzzy matching to "router":

```typescript
// Add to CANONICAL_TERMS (vehicle section):
"rover": [], // Protected - prevent fuzzy match to "router"
```

By adding "rover" with an empty typo array, the direct lookup succeeds and fuzzy matching is skipped.

### 2. Match Multi-Word Phrases BEFORE Splitting into Tokens

Update `canonicalizeQuery()` to check for multi-word canonical terms (like "range rover", "grand cherokee") before tokenizing:

```typescript
export function canonicalizeQuery(normalized: string): string {
  if (!normalized || normalized.trim().length === 0) {
    return normalized;
  }
  
  let result = normalized;
  
  // FIRST: Check multi-word canonical terms (e.g., "range rover", "grand cherokee")
  // Sort by length descending to match longer phrases first
  const multiWordTerms = Object.entries(CANONICAL_TERMS)
    .filter(([canonical]) => canonical.includes(" "))
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [canonical, typos] of multiWordTerms) {
    // Check if query contains the canonical form (keep it as-is)
    if (result.includes(canonical)) {
      continue; // Already canonical
    }
    // Check if query contains any typo variant
    for (const typo of typos) {
      if (result.includes(typo)) {
        result = result.replace(typo, canonical);
        break;
      }
    }
  }
  
  // THEN: Process remaining tokens individually
  const tokens = result.split(/\s+/);
  const canonicalized = tokens.map(canonicalizeToken);
  return canonicalized.join(" ");
}
```

### 3. Add Vehicle-Specific Protected Terms

Add these terms to `CANONICAL_TERMS` to prevent fuzzy matching to electronics:

```typescript
// Protected vehicle terms - prevent fuzzy matching to similar electronics
"rover": [],           // Prevent "rover" → "router"
"cherokee": [],        // Prevent unwanted fuzzy matches
"silverado": [],       // Prevent unwanted fuzzy matches
"escalade": [],        // Prevent unwanted fuzzy matches
"bronco": [],          // Prevent unwanted fuzzy matches
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/queryCanonicalizer.ts` | Add protected vehicle terms, implement multi-word phrase matching before tokenization |

---

## Expected Behavior After Fix

| Input Query | Current (Broken) | After Fix |
|-------------|------------------|-----------|
| "range rover" | "range router" ❌ | "range rover" ✅ |
| "rangerover" | "rangerover" | "range rover" ✅ |
| "rang rover" | "rang router" ❌ | "range rover" ✅ |
| "grand cherokee" | "grand cherokee" | "grand cherokee" ✅ |
| "grandcherokee" | "grandcherokee" | "grand cherokee" ✅ |
| "f150" | "f150" | "f-150" ✅ |
| "infiniti qx80" | "infiniti qx80" ✅ | "infiniti qx80" ✅ |

---

## Technical Details

### Why This Bug Happened

The canonicalizer was designed for **single-word** brand names (iPhone, Samsung, Toyota). When multi-word canonical terms like "range rover" were added, the system still processes tokens individually:

```typescript
// Current implementation (line 226-228):
const tokens = normalized.split(/\s+/);           // ["range", "rover"]
const canonicalized = tokens.map(canonicalizeToken);  // ["range", "router"] ❌
return canonicalized.join(" ");                    // "range router"
```

The multi-word keys in `CANONICAL_TERMS` (lines 74-84) are never checked because they contain spaces but we split by spaces first.

### Fix Strategy

1. **Short-term (immediate)**: Add "rover" as a protected term to prevent fuzzy matching
2. **Long-term (in this fix)**: Process multi-word phrases before tokenization

This ensures both the immediate problem is solved AND future multi-word canonicalizations work correctly.

