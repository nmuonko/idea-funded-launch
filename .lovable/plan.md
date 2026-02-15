

# Fix: French Fashion Search Terms Not Translating

## Problem
Searching "chaussure dame haut talon" (women's high heel shoes) returns no results because the French-to-English translation fallback map is missing common fashion and clothing terms. If the AI refiner times out (800ms budget), the raw French query goes directly to Amazon/eBay, which returns nothing.

## Solution
Add missing French fashion, clothing, and footwear terms to the `FR_EN_FALLBACK` dictionary in `supabase/functions/catalog-search/index.ts`. This provides instant, reliable translation without depending on the AI refiner.

## Changes

### File: `supabase/functions/catalog-search/index.ts`

Add the following entries to the `FR_EN_FALLBACK` map (around line 276-406):

**Footwear:**
- `chaussure` / `chaussures` -> `shoes`
- `chaussure dame` -> `women shoes`
- `chaussure dame haut talon` -> `women high heel shoes`
- `chaussure homme` -> `men shoes`
- `chaussure enfant` -> `kids shoes`
- `talon` / `talon haut` -> `high heels`
- `basket` / `baskets` -> `sneakers`
- `botte` / `bottes` -> `boots`
- `sandale` / `sandales` -> `sandals`
- `pantoufle` / `pantoufles` -> `slippers`

**Clothing (missing terms):**
- `vetement` / `vetement femme` -> `clothing` / `women clothing`
- `vetement homme` -> `men clothing`
- `pantalon` -> `pants`
- `jupe` -> `skirt`
- `chemise` -> `shirt`
- `robe` -> `dress`
- `manteau` -> `coat`
- `veste` -> `jacket`
- `pull` -> `sweater`
- `sous vetement` -> `underwear`
- `maillot de bain` -> `swimsuit`
- `echarpe` -> `scarf`
- `ceinture` -> `belt`
- `chapeau` -> `hat`
- `lunettes` / `lunettes de soleil` -> `glasses` / `sunglasses`

Also add `chaussure` to the `FR_FORCE_MAP` (around line 604) to ensure provider queries never contain this French word.

### Deployment
Redeploy the `catalog-search` edge function after changes.

## Why This Works
The `FR_EN_FALLBACK` map is checked before sending queries to Amazon/eBay. Multi-word entries are matched first (exact match), then partial/individual word matching kicks in. Adding "chaussure dame haut talon" as an exact entry guarantees this specific query translates correctly, while individual terms like "chaussure" and "talon" handle variations.

## Files Changed
- `supabase/functions/catalog-search/index.ts` -- add ~30 French fashion/clothing terms to `FR_EN_FALLBACK` and `FR_FORCE_MAP`

