

# Fix Vehicle Search: Complete the Smart Intent Detection

## Problem Identified

The previous fix only updated ONE location. There's a SECOND hardcoded $1500 minPrice filter in `fetchEbayItems()`:

```typescript
// Line 621 - This BYPASSES our smart intent fix!
const minPrice = isVehicle ? 1500 : undefined;
```

**Result**: Even though `hasVehicleBuyingIntent("infiniti qx80")` correctly returns `false`, the eBay API is STILL called with `price:[1500..]` filter because `isVehicle=true` triggers line 621.

The eBay API URL from logs confirms this:
```
filter=buyingOptions%3A%7BFIXED_PRICE%7D%2Cprice%3A%5B1500..%5D
```
→ Translated: `price:[1500..]` = minimum $1500

## Additional Issue: Category Lock

The code also forces eBay category `6001` (Cars & Trucks) for vehicle-detected queries:
```typescript
// Lines 643-645
if (isVehicle && !ebayCategory) {
  ebayCategory = "6001"; // Cars & Trucks category
}
```

Your eBay link shows results in **category 0 (All Categories)**, not 6001. The actual Infiniti QX80 vehicles might be listed in different eBay Motors subcategories.

---

## Solution

### 1. Pass buying intent flag to fetchEbayItems

Update the function call to include the `hasBuyingIntent` status:

```typescript
// In the parallel fetch call (~line 975)
fetchEbayItems({
  supabase,
  query: qNorm,
  effectiveMode,
  isVehicle,
  hasBuyingIntent,  // NEW: Pass the smart intent flag
  categoryKey: categoryKey || undefined,
  page,
  limit,
  catalogFilters,
  requestId,
}),
```

### 2. Fix fetchEbayItems to use smart intent

Replace the hardcoded logic:

```typescript
// BEFORE (Line 621):
const minPrice = isVehicle ? 1500 : undefined;

// AFTER:
// Only enforce minPrice for explicit vehicle-buying intent (e.g., "infiniti qx80 for sale")
// For brand-only searches like "infiniti qx80", allow all prices to show accessories AND vehicles
const minPrice = hasBuyingIntent ? 1500 : undefined;
```

### 3. Don't force category 6001 for non-buying queries

```typescript
// BEFORE (Lines 641-645):
if (isVehicle && !ebayCategory) {
  ebayCategory = "6001";
}

// AFTER:
// Only force eBay Motors category when user explicitly wants to buy a vehicle
if (hasBuyingIntent && !ebayCategory) {
  ebayCategory = "6001"; // Cars & Trucks category
  console.log(`[SEARCH] requestId=${requestId} Vehicle BUYING intent, forcing category=6001`);
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Add `hasBuyingIntent` to EbayFetchParams interface, pass it to fetchEbayItems, update minPrice and category logic |

---

## Expected Results After Fix

| Query | isVehicle | hasBuyingIntent | minPrice | eBay Category | Expected Results |
|-------|-----------|-----------------|----------|---------------|------------------|
| "infiniti qx80" | true | **false** | **none** | **none (all)** | Accessories + any vehicles |
| "infiniti qx80 for sale" | true | true | $1500 | 6001 | Vehicle listings only |
| "toyota camry floor mats" | true | false | none | none | Floor mats |
| "used honda civic" | true | true | $1500 | 6001 | Vehicle listings only |

---

## Technical Details

**Interface update:**
```typescript
interface EbayFetchParams {
  supabase: SupabaseClientAny;
  query: string;
  effectiveMode: { ebayActive: boolean; mode: string };
  isVehicle: boolean;
  hasBuyingIntent: boolean;  // NEW
  categoryKey: string | undefined;
  page: number;
  limit: number;
  catalogFilters: CatalogFilters;
  requestId: string;
}
```

**Updated logic in fetchEbayItems:**
```typescript
async function fetchEbayItems(params: EbayFetchParams): Promise<EbayFetchResult> {
  const { supabase, query, effectiveMode, isVehicle, hasBuyingIntent, categoryKey, page, limit, catalogFilters, requestId } = params;

  // ... existing code ...

  // SMART VEHICLE INTENT: Only enforce minPrice when buying a vehicle
  const minPrice = hasBuyingIntent ? 1500 : undefined;
  
  // ... existing code ...

  // Only force eBay Motors for explicit buying intent
  if (hasBuyingIntent && !ebayCategory) {
    ebayCategory = "6001";
    console.log(`[SEARCH] requestId=${requestId} Vehicle BUYING intent, forcing category=6001`);
  }
  
  // ... rest of function ...
}
```

