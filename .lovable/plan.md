

## Problem Analysis

Three distinct issues found by inspecting the database and filtering logic:

### 1. Blurry Phone Images — Amazon Thumbnail URLs Not Upgraded
**Root cause**: The database stores Amazon image URLs with `_AC_UY218_` pattern (218px thumbnail). The `upgradeToHighRes()` function in `imageValidator.ts` only handles `_SL`, `_SS`, and `_AC_SL` patterns — it completely misses `_AC_UY###_` and `_AC_US###_` variants. 13 out of 15 phone images in the DB are blurry 218px thumbnails.

### 2. Phones Section Shows Accessories Instead of Actual Phones
**Root cause**: PHONE_WORDS includes generic terms like `"cell phone"`, `"mobile phone"` which match titles like "Cell Phone Holder for Car", "Phone Mount", "FM Transmitter for Car". The section has no excludeAny rules for accessories. Out of 20 phone-matching items sampled, ~15 are phone holders/mounts/chargers, not phones.

### 3. Electronics Section Shows Unrelated Items
**Root cause**: ELECTRONICS_WORDS includes broad terms like `"bluetooth"`, `"tablet"` without excluding phone accessories, car accessories, or unrelated items. The excludeAny list only blocks vehicles/parts/gaming/phones but not home goods, clothing, or generic accessories.

---

## Plan

### File 1: `supabase/functions/_shared/imageValidator.ts`
- **Fix `upgradeToHighRes()`** to handle `_AC_UY###_` and `_AC_US###_` Amazon patterns (replace with `_AC_SL1500_`)
- **Add `_AC_UY` and `_AC_US` small-size patterns** to the dimension-hint extraction so images under 150px are blocked at validation time
- **Add ad banner URL patterns**: block Amazon "image unavailable" placeholders and sponsored content image patterns

### File 2: `supabase/functions/_shared/sectionProfiles.ts`
- **Phones section — tighten filtering**:
  - Add phone accessory excludes: `"phone holder"`, `"phone mount"`, `"car mount"`, `"phone stand"`, `"fm transmitter"`, `"car adapter"`, `"car charger"`, `"bluetooth adapter"`, `"phone case"`, `"screen protector"`, `"car phone"`, `"phone grip"`
  - Move PHONE_ACCESSORIES out of phones includeAny (they're currently in electronics only, which is correct)
- **Electronics section — tighten filtering**:
  - Add excludes for accessories that aren't standalone electronics: `"phone holder"`, `"car mount"`, `"phone stand"`, `"fm transmitter"`, `"car adapter"`, `"seat cover"`, `"floor mat"`
  - Add more relevant electronics keywords: `"camera"`, `"webcam"`, `"drone"`, `"projector"`, `"smart home"`, `"printer"`

### File 3: `supabase/functions/_shared/mobileSectionsCache.ts`
- **Bump `MOBILE_SECTIONS_SCHEMA_VERSION`** to 8 to force cache rebuild with fixed image URLs and tighter filtering

### Database: Bulk upgrade stored thumbnail URLs
- Run a SQL update to upgrade all `_AC_UY218_` Amazon images in `catalog_items` to `_AC_SL1500_` so cached/stored images are high-res going forward

### Deploy
- Redeploy `catalog-home` to pick up all shared module changes and rebuild cache

---

## Technical Details

**Amazon URL pattern fix** (imageValidator.ts `upgradeToHighRes`):
```
// Current: only handles _SL, _SS, _AC_SL
// Missing: _AC_UY218_, _AC_US218_, _UY218_, _US40_

// Add these replacements:
upgraded.replace(/_AC_UY\d+_/g, "_AC_SL1500_")
upgraded.replace(/_AC_US\d+_/g, "_AC_SL1500_")  
upgraded.replace(/_UY\d+_/g, "_SL1500_")
```

**Phone section accessory exclusion** (sectionProfiles.ts):
Add to phones `excludeAny`: `"phone holder"`, `"phone mount"`, `"phone stand"`, `"car mount"`, `"car charger"`, `"car adapter"`, `"fm transmitter"`, `"bluetooth adapter"`, `"phone grip"`, `"phone case"`, `"screen protector"`, `"tempered glass"`, `"charging cable"`, `"power bank"`

