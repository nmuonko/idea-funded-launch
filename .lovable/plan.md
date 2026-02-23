

# Fix Two Critical Issues: Broken Product API + Vehicle Detection

## Issue 1: Product Gallery Completely Broken (CRITICAL)

### Root Cause
The `catalog-product` edge function has a **fatal compilation error** and is not running at all. The variable `raw` is declared twice with `const` in `mapDbItemToResponse()`:

- Line 261: `const raw = item.raw as Record<string, any> | null;` (for image fallback)
- Line 283: `const raw = item.raw as Record<string, any> | null;` (for variant extraction)

This causes `SyntaxError: Identifier 'raw' has already been declared` on every request. The function crashes before returning any data, so the frontend gets no product details and falls back to the single search thumbnail.

### Fix
Remove the duplicate `const raw` declaration on line 283. The first declaration on line 261 is already in scope for the entire function body.

**File:** `supabase/functions/catalog-product/index.ts`
- Line 283: Change `const raw = item.raw as Record<string, any> | null;` to just remove it (the `raw` variable from line 261 is already available)

## Issue 2: Vehicle Detection - Remove $5,000 Price Floor

### Problem
The fallback heuristic in `isVehicleProduct()` requires price >= $5,000. But used motorcycles, old cars, and some boats can be under $5K. Meanwhile, the primary DB category check handles all properly-categorized items regardless of price.

### Fix
- Remove the `$5,000` price floor from the fallback heuristic entirely
- The fallback already requires ALL THREE of: year + brand + body type, which is strict enough
- The DB category check (primary path) has no price requirement and works perfectly

**File:** `src/pages/shop/ProductDetails.tsx`
- Remove line 36: `if ((product.priceUsd || 0) < 5000) return false;`

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/catalog-product/index.ts` | Remove duplicate `const raw` declaration (line 283) to fix fatal crash |
| `src/pages/shop/ProductDetails.tsx` | Remove $5,000 price floor from vehicle fallback heuristic |

## Expected Outcome
1. Product details API starts working again -- all galleries load with full images
2. Vehicles at any price point are correctly detected (via DB category or strict title heuristic)
3. Non-vehicle items like laptops remain unaffected (no brand/body-type match)

