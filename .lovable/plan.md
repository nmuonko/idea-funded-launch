

## Root Cause

"galaxy pliable" returns no results because:

1. **"pliable" is not in FR_EN_MAP** — The French word "pliable" (meaning "foldable") has no entry in `supabase/functions/_shared/frenchEnglishMap.ts`, so the static translation layer passes it through untranslated.

2. **PreNormalizer detects "galaxy" as a phone brand** (`PHONE_BRANDS` set) and sets `keepQuery: true`, which means the query stays as-is: "galaxy pliable". This bypasses phrase map matching entirely.

3. **OpenAI translation fallback may not trigger** — Since "galaxy" is English and "pliable" exists as an English word (meaning flexible/bendable), the system may not detect the query as French-likely (`isFrenchLikely` requires accented chars or `lang=fr`).

4. **Even if translated to "galaxy foldable"**, there are no synonym expansions to map that to the actual product names: "Samsung Galaxy Z Fold" and "Samsung Galaxy Z Flip".

## Plan — Two targeted changes

### 1. Add "pliable" → "foldable" to `frenchEnglishMap.ts`

Add entries for "pliable" and related terms:
- `"pliable"` → `"foldable"`
- `"telephone pliable"` → `"foldable phone"`
- `"galaxy pliable"` → `"samsung galaxy z fold"`
- `"samsung pliable"` → `"samsung galaxy z fold"`

### 2. Add phone synonym expansions to `queryPreNormalizer.ts`

Create a `PHONES_SYNONYMS` map and register it in `CATEGORY_SYNONYM_MAP`:

```
"galaxy foldable": ["samsung galaxy z fold", "samsung galaxy z flip", "galaxy z fold", "galaxy z flip"]
"foldable phone": ["samsung galaxy z fold", "samsung galaxy z flip", "motorola razr"]
"galaxy fold": ["samsung galaxy z fold 5", "samsung galaxy z fold 4", "galaxy z fold"]
"galaxy flip": ["samsung galaxy z flip 5", "samsung galaxy z flip 4", "galaxy z flip"]
```

This ensures that even after translation, the synonym fallback generates queries matching actual product listings.

### Files to change

| File | Change |
|------|--------|
| `supabase/functions/_shared/frenchEnglishMap.ts` | Add "pliable"/"galaxy pliable"/etc. entries |
| `supabase/functions/_shared/queryPreNormalizer.ts` | Add `PHONES_SYNONYMS` map with foldable expansions, register in `CATEGORY_SYNONYM_MAP` |

Both are backend functions that auto-deploy. No frontend changes needed. Search and other features remain unaffected.

