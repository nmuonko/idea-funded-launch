

## Fix: "Pieces Auto" and "Vehicules" Category Grids

### Root Cause Analysis

**Pieces Auto (parts_accessories)**: The `isNotJunk` filter contains the word `"parts"` in its blocklist (`JUNK_TERMS`). Since nearly every auto parts product title contains the word "parts" (e.g., "Power Stop Brake Pads with Drilled & Slotted Brake Rotors Kit"), they all get filtered out. The search backend returns valid results (confirmed: 5 items at $400-500+ each for "brake pad rotor"), but they are discarded before reaching the grid.

**Vehicules (vehicles)**: The `searchValidItems` helper function does NOT apply category exclude keywords. When searching "Tesla Model X", the backend returns accessories like "J1772 to Tesla Adapter" ($39.99) instead of actual Tesla vehicles. The vehicles exclude list already contains terms like "charger", "adapter", "cable" — but `searchValidItems` never checks them.

---

### Plan

#### 1. Fix the JUNK_TERMS filter for auto parts context
**File**: `src/pages/shop/ShopHome.tsx`

- Change the `JUNK_TERMS` entry from `'parts'` to `'for parts'` (which targets "sold for parts" junk listings without blocking legitimate "auto parts" or "brake parts" titles).
- This single change unblocks the auto parts pipeline since the backend already returns valid items.

#### 2. Apply vehicle exclude keywords inside the vehicles curated path
**File**: `src/pages/shop/ShopHome.tsx`

- In the vehicles special path, pass the existing `CATEGORY_EXCLUDE_KEYWORDS['vehicles']` as the `excludes` parameter to `searchValidItems()`.
- This will block accessories ("charger", "adapter", "cable", "phone mount", etc.) from appearing as Tesla or SUV results.
- Also add vehicle-specific terms to the excludes: `'adapter'`, `'j1772'`, `'charging station'`, `'wall connector'`, `'floor mat'`, `'seat cover'`, `'phone'`, `'accessory'`.

#### 3. Apply similar excludes to the auto parts path
**File**: `src/pages/shop/ShopHome.tsx`

- Also pass `CATEGORY_EXCLUDE_KEYWORDS['parts_accessories']` through the `isNotJunk` + exclusion check in the auto parts loop to block phones, laptops, etc. from appearing.

---

### Technical Details

Changes are scoped to two blocks in `src/pages/shop/ShopHome.tsx`:

1. **Line ~293**: Change `JUNK_TERMS` from `['cheap', 'lot', 'bundle', 'parts', ...]` to `['cheap', 'lot', 'bundle', 'for parts', ...]`

2. **Lines ~361-384 (vehicles path)**: Add excludes parameter:
```text
const vehicleExcludes = [
  ...CATEGORY_EXCLUDE_KEYWORDS['vehicles'],
  'adapter', 'j1772', 'charging station', 'wall connector',
  'accessory', 'accessories', 'floor mat', 'seat cover',
  'phone holder', 'cup holder',
];
const teslas = await searchValidItems(teslaQueries, 1, seenIds, vehicleExcludes);
const suvs = await searchValidItems(suvQueries, 3, seenIds, vehicleExcludes);
```

3. **Lines ~446-474 (auto parts path)**: The existing `looksAutoPart` filter is sufficient once the `"parts"` term is fixed in JUNK_TERMS. No other structural changes needed.

No other categories are affected.
