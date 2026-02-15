

# Harden French Translation Fallback for DRC Fashion Searches

## Problem
The current fallback map was expanded with fashion terms, but has gaps that cause real-world DRC searches to fail:
- Partial matching stops after the **first** matched term (`break` on line 475), so multi-word queries like "chaussure dame haut talon noir" only translate the first recognized word
- Missing high-traffic DRC terms: `sac`, `sac a main`, `perruque`, `bracelet`, `collier`, `costume`, `uniforme`
- Missing generic token translations (`femme`->`women`, `dame`->`women`, `homme`->`men`, `enfant`->`kids`, `bebe`->`baby`) that would let any combination work
- Accent normalization already exists (line 449-450) and is used for lookup (line 459), but the `FR_EN_FALLBACK` map has redundant accented/non-accented duplicate entries -- these are harmless but add clutter

## Changes

### File: `supabase/functions/catalog-search/index.ts`

#### 1. Normalize FR_EN_FALLBACK keys (accent-strip before lookup)
The code already strips accents from the query (`qNoAccents` on line 450) and checks `FR_EN_FALLBACK[qNoAccents]` on line 459. However, for partial matching (line 468-477), it also calls `removeAccentsFn(frTerm)` per entry. This means accented duplicate keys (`vêtement` alongside `vetement`) are redundant -- we can keep them for safety but the real fix is elsewhere.

#### 2. Fix partial matching: replace ALL known terms, not just the first
Currently the loop on lines 468-477 does `break` after the first match. This means "chaussure dame haut talon noir" might only translate "chaussure" and leave the rest in French.

**Fix**: Remove the `break`, sort entries by descending key length (longest phrases first to avoid partial clobbering), and replace all matched terms in the query.

```
Before (line 466-477):
  } else if (isFrenchLikely) {
    for (const [frTerm, enTerm] of Object.entries(FR_EN_FALLBACK)) {
      if (qNormLower.includes(frTerm) || qNoAccents.includes(removeAccentsFn(frTerm))) {
        qNorm = qNormLower.replace(frTerm, enTerm).replace(removeAccentsFn(frTerm), enTerm);
        ...
        break;  // <-- Only translates first match!
      }
    }
  }

After:
  } else if (isFrenchLikely) {
    // Sort by key length descending so multi-word phrases match before single words
    const sortedEntries = Object.entries(FR_EN_FALLBACK)
      .sort((a, b) => b[0].length - a[0].length);
    let translated = qNormLower;
    let anyMatch = false;
    for (const [frTerm, enTerm] of sortedEntries) {
      const frTermNoAccents = removeAccentsFn(frTerm);
      if (translated.includes(frTerm)) {
        translated = translated.replace(frTerm, enTerm);
        anyMatch = true;
      } else if (translated.includes(frTermNoAccents)) {
        translated = translated.replace(frTermNoAccents, enTerm);
        anyMatch = true;
      }
    }
    if (anyMatch) {
      qNorm = translated.trim().replace(/\s+/g, " ");
      searchMeta.rewrittenQuery = qNorm;
      searchMeta.rewriteApplied = true;
      frFallbackApplied = true;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} fr_fallback_multi: ... => "${qNorm}"`);
    }
  }
```

#### 3. Add missing DRC high-traffic terms to FR_EN_FALLBACK

**Accessories / Bags:**
- `sac` -> `bag`, `sac a main` -> `women handbag`, `sacoche` -> `messenger bag`, `portefeuille` -> `wallet`

**Jewelry / Beauty:**
- `bracelet` -> `bracelet`, `collier` -> `necklace`, `boucles d'oreilles` / `boucles d oreilles` -> `earrings`
- `perruque` (already exists), `meches` / `mèches` -> `hair extensions`, `tissage` -> `hair weave`

**Formal / Uniform:**
- `costume` -> `suit`, `tenue` -> `outfit`, `uniforme` -> `uniform`

**Generic token mappings (critical for combo queries):**
- `femme` -> `women`, `dame` -> `women`, `homme` -> `men`, `enfant` -> `kids`, `bebe` / `bébé` -> `baby`
- `haut` -> `high`, `noir` -> `black`, `blanc` -> `white`, `rouge` -> `red`, `bleu` -> `blue`
- `grand` -> `large`, `petit` -> `small`

**Variant spellings / typos:**
- `chaussure femme` -> `women shoes` (in addition to existing `chaussure dame`)
- `talons hauts` -> `high heels`, `haut talon` -> `high heels` (in addition to existing `talon haut`)

#### 4. Add a few high-impact terms to FR_FORCE_MAP
Add only: `sac`, `perruque`, `costume`, `collier`, `bracelet` -- these are French-only words that will never return results on English providers.

Do NOT add generic words like `femme`, `dame`, `noir`, `blanc` to FR_FORCE_MAP as they could appear in brand names or product titles.

#### 5. Redeploy
Redeploy the `catalog-search` edge function.

## Why This Matters
- "chaussure dame haut talon noir" currently only translates the first word. After this fix, it becomes "women shoes women high heels black" (then the AI refiner or provider handles deduplication).
- DRC users frequently search for bags, jewelry, and formal wear in French -- these terms currently return zero results.
- Generic token mapping (`femme`->`women`, `noir`->`black`) makes the system composable: any new French phrase automatically gets partially translated even without an exact dictionary entry.

## Files Changed
- `supabase/functions/catalog-search/index.ts` -- fix multi-match logic, add ~25 new terms, update FR_FORCE_MAP
