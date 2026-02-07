
# Gaming Tab: Console-Only Mode

## Problem
The Gaming tab still returns headsets, controllers, cables, and accessories instead of actual gaming consoles. The current scorer drops some junk but the underlying eBay search uses broad category 1249 ("Video Games & Consoles") which includes all accessories. The scorer then tries to filter post-hoc, but accessories containing console names in their titles (e.g., "Gaming Headset for PS5, PS4, Xbox One") pass through because they match GAMING_SIGNALS.

## Root Cause
1. eBay category `1249` is too broad -- it includes headsets, controllers, cables
2. The scorer allows items that merely mention a console name -- "Headset for PS5" passes the "must contain gaming signal" gate
3. No "for X" / "compatible with" detection to distinguish accessories from actual consoles

## Changes (4 files)

### 1. `supabase/functions/_shared/ebayFetcher.ts`
Add a dedicated eBay category mapping for gaming consoles:

```
gaming: "139971",        // "Video Game Consoles" (consoles only, not accessories)
```

This restricts eBay results to the "Video Game Consoles" leaf category (139971) instead of the broad "Video Games & Consoles" parent (1249). This alone eliminates most headsets and controllers at the provider level.

### 2. `supabase/functions/_shared/vehicleDetection.ts`
No changes needed -- the existing `gaming` intent classification already triggers correctly.

### 3. `supabase/functions/_shared/searchIntentScorer.ts`
Replace the current `gaming` case (lines 137-162) with a strict console-only scorer:

- **Massive accessory drop list** (EN + FR): headset, headphones, controller, manette, joystick, gamepad, dock, charging, charger, cable, HDMI, adapter, skin, grip, cover, case, coque, stand, cooling fan, kit, repair, bag, sac, mic, microphone, earphones, station, usb, protection, support, ventilateur, spare, parts, accessory, accessoires, replacement, sticker, decal, poster, shirt, shoes, figurine, mod, script, sauce, mcdonalds, mug, cup, keychain, wallet, socks, backpack, hat, cap, band, strap
- **"for X" / "compatible with" detection**: If title contains "for ps5", "for xbox", "compatible with", "fits", "works with" -- drop it (these are accessories referencing a console)
- **Strict console signal gate**: Item must contain at least one of the specific console model names:
  - `playstation 5 slim`, `playstation 5`, `ps5 slim`, `ps5 console`
  - `xbox series s`, `xbox one x`, `xbox one s`, `xbox one console`
  - `xbox 360`, `nintendo switch 2`, `nintendo switch console`
  - Plus generic: `console` combined with a brand name
- **Price sanity**: Keep the $3,000 cap
- **Boost**: +15 for exact model name matches

### 4. `src/pages/shop/SearchResults.tsx`
Update the gaming fallback query (line 58) and add `gaming` intent skip for AI expansion:

```
'PlayStation 5 console OR Xbox One console OR Nintendo Switch 2 OR Xbox Series S OR Xbox 360 console'
```

Adding "console" to model names in the query helps eBay return actual console listings instead of accessories.

Also skip AI query expansion for gaming intent (same pattern as vehicle_listing) since AI expansion adds accessory terms.

### 5. `supabase/functions/catalog-search/index.ts`
Add gaming intent to the `skipAiExpand` check (line 501) so AI expansion doesn't pollute gaming queries with accessory terms:

```typescript
const skipAiExpand = isHeavyEquipment || effectiveIntent.intentKey === "vehicle_listing" || effectiveIntent.intentKey === "gaming";
```

## Technical Details

### eBay Category 139971 vs 1249
- `1249` = "Video Games & Consoles" (parent) -- includes games, controllers, headsets, cables, etc.
- `139971` = "Video Game Consoles" (leaf) -- consoles only

### "for X" Pattern Detection
Accessories always reference consoles: "Headset **for PS5**", "Controller **for Xbox One**". Real console listings say "PlayStation 5 Slim Digital Edition Console" -- they never say "for PlayStation 5". This pattern is the strongest signal to distinguish consoles from accessories.

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/_shared/ebayFetcher.ts` | Add `gaming: "139971"` to CATEGORY_MAPPING |
| `supabase/functions/_shared/searchIntentScorer.ts` | Strict console-only scorer with accessory drop, "for X" detection, model gate |
| `supabase/functions/catalog-search/index.ts` | Skip AI expansion for gaming intent |
| `src/pages/shop/SearchResults.tsx` | Add "console" to gaming query terms |

### Expected Result
- Gaming tab top 20 results: all actual consoles (PS5, Xbox, Nintendo Switch)
- Zero headsets, zero controllers, zero cables
- "Load More" maintains the same console-only constraints via intent-based cache key
