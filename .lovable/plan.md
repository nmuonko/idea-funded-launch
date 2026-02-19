

# Fix Bright Product Images & Remove Extra Sections

## Changes

### 1. Tone Down Product Card Image Background
The current `bg-white` on the image container is too harsh against the dark theme. Switch to a soft neutral gray that still makes products visible but doesn't blind users.

**File:** `ProductCard.tsx` (line 142)
- Change `bg-white` to `bg-neutral-200` -- bright enough for product photos to look good, but not a glaring white rectangle.

**File:** `ProductCardSkeleton.tsx` -- match the same background change.

### 2. Remove Trust Badges Strip & How It Works
Remove both sections from `ShopHome.tsx`:
- Delete the Trust Badges section (lines 241-244)
- Delete the How It Works section (lines 246-251)
- Remove unused imports (`TrustBadgesStrip`, `HowItWorks`)

## Files Modified

| File | Change |
|------|--------|
| `ProductCard.tsx` | `bg-white` to `bg-neutral-200` on image container |
| `ProductCardSkeleton.tsx` | Match image background |
| `ShopHome.tsx` | Remove TrustBadgesStrip and HowItWorks sections + imports |

