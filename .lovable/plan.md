

# Fix: Keep "Rechercher" Button Visible + Strengthen Vehicle Filter

## Issue 1: "Rechercher" Button Disappears When Typing

**Current behavior:** In `SearchBar.tsx` (lines 111-129), there's a conditional: if `query` has text, show an X (clear) button; otherwise show the "Rechercher" submit button. So the moment you type, the search button vanishes.

**Fix:** Show BOTH the X clear button AND the "Rechercher" submit button when the user has typed text. Adjust padding so they don't overlap.

**File:** `src/components/shop/SearchBar.tsx`
- Remove the either/or conditional (`query ? ... : ...`)
- Always render the "Rechercher" submit button on the right
- When `query` is non-empty, also render a small X button just left of it
- Adjust input right padding from `pr-12` to `pr-28` to make room for both buttons

## Issue 2: Vehicle Filter Still Showing Parts/Accessories

**Root cause:** The guardrails have 3 tiers, and **Tier 3 (fallback)** returns the completely unfiltered list -- including all parts. Even with `MIN_FILTERED = 5`, if fewer than 5 real vehicles are found by strict AND relaxed tiers, the fallback dumps everything back in.

**Fix:** Make Tier 3 (fallback) also filter out parts/accessories instead of returning the raw unfiltered list. This way even in fallback mode, parts like "floor mats", "window tint", "washer bottle" are still removed.

**File:** `supabase/functions/_shared/vehicleGuardrails.ts`
- In the Tier 3 fallback block (lines 247-254), filter `fallbackItems` through `isPartAccessory()` to drop obvious parts
- If filtering leaves zero results, then return the original fallback (safety net)
- This ensures the user never sees parts mixed in with vehicles

## Summary

| File | Change |
|------|--------|
| `src/components/shop/SearchBar.tsx` | Show both X clear button and "Rechercher" submit button simultaneously when user has typed text |
| `supabase/functions/_shared/vehicleGuardrails.ts` | Make Tier 3 fallback also drop parts/accessories instead of returning raw unfiltered results |

