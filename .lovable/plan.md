

# Fix: Vehicles Section Showing Accessories Instead of Real Cars

## Problem

The "Véhicules" (Vehicles) section on the homepage is displaying phone holders, accessories, and toy vehicles instead of real cars. The cached data confirms this:

- First cached item: **"UGREEN Phone Holder for Tesla Model 3 and Y Accessories"** - $19.99
- This is an Amazon result for the seed query "Tesla Model Y"

## Root Cause

**Amazon does not sell real vehicles.** When the prewarm worker searches Amazon with queries like "Tesla Model 3", it returns accessories (phone holders, floor mats, etc.) because that's what Amazon has.

The prewarm worker applies the `isAllowedMotorListing()` filter only to eBay items (line 371-374), but **NOT** to Amazon items. The Amazon items go straight into the mix without any vehicle validation.

```text
Current Flow:
┌─────────────────────────────────────────────────────────────────┐
│ Prewarm Worker: section=vehicles                                │
├─────────────────────────────────────────────────────────────────┤
│ Amazon: "Tesla Model 3" → Phone holders, accessories            │
│   ↓ Only checks: isDisallowedItem() ✗ (content blocker)         │
│   ↓ Missing: isAllowedMotorListing() ❌                          │
│   → All accessories pass through!                               │
├─────────────────────────────────────────────────────────────────┤
│ eBay: "Tesla Model 3" → Real cars                               │
│   ↓ Checks: isDisallowedItem() ✓                                │
│   ↓ Checks: isAllowedMotorListing() ✓                           │
│   → Only real vehicles pass through                             │
├─────────────────────────────────────────────────────────────────┤
│ Mixer: Amazon first (N items) → Blend → eBay                    │
│ Result: Homepage shows phone holders FIRST, then real cars      │
└─────────────────────────────────────────────────────────────────┘
```

## Solution

**Skip Amazon entirely for vehicle sections.** Real vehicles only come from eBay Motors. Amazon results for vehicle-related queries will always be accessories.

### Changes Required

1. **`catalog-prewarm-worker/index.ts`**: Skip Amazon fetching when `section.isVehicle === true`
2. **`catalog-home/index.ts`**: Skip Amazon cache lookup for vehicle sections

### Code Changes

#### File: `supabase/functions/catalog-prewarm-worker/index.ts`

Before (line ~303):
```typescript
// ─── FETCH AMAZON ITEMS ─────────────────────────────────────────────────────
if (catalogSettings.amazonEnabled && liveSettings.amazonHomePrewarmEnabled) {
  for (const query of section.amazonQueries) {
```

After:
```typescript
// ─── FETCH AMAZON ITEMS ─────────────────────────────────────────────────────
// Skip Amazon for vehicles - Amazon only sells accessories, not real cars
if (catalogSettings.amazonEnabled && liveSettings.amazonHomePrewarmEnabled && !section.isVehicle) {
  for (const query of section.amazonQueries) {
```

This single-line change ensures that for vehicle sections:
- Amazon is skipped entirely
- Only eBay Motors results are fetched
- The motors filter (price minimum $1,500, parts blocklist) is applied

#### File: `supabase/functions/catalog-home/index.ts`

The home endpoint should also skip Amazon cache lookups for vehicle sections to avoid stale accessory data.

## Expected Behavior After Fix

```text
Fixed Flow:
┌─────────────────────────────────────────────────────────────────┐
│ Prewarm Worker: section=vehicles, isVehicle=true                │
├─────────────────────────────────────────────────────────────────┤
│ Amazon: SKIPPED (isVehicle=true)                                │
│   → No accessories stored                                       │
├─────────────────────────────────────────────────────────────────┤
│ eBay: "Tesla Model 3" → Real cars from eBay Motors              │
│   ↓ Checks: isAllowedMotorListing() ✓                           │
│   ↓ minPrice: $1,500 ✓                                          │
│   → Only real vehicles pass through                             │
├─────────────────────────────────────────────────────────────────┤
│ Mixer: eBay only for vehicles                                   │
│ Result: Homepage shows real Tesla Model 3 cars ($15,000+)       │
└─────────────────────────────────────────────────────────────────┘
```

## Testing After Fix

1. Deploy the updated edge functions
2. Go to Home Curation → Click "Publish Now"
3. Wait for the job to complete
4. Refresh the homepage
5. The Vehicles section should now show real cars with prices $1,500+ from eBay Motors

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/catalog-prewarm-worker/index.ts` | Add `&& !section.isVehicle` to Amazon fetch condition (line ~304) |
| `supabase/functions/catalog-home/index.ts` | Skip Amazon cache for vehicle sections in fallback logic |

## Why This is the Correct Fix

1. **Amazon doesn't sell cars** - This is a fundamental limitation, not a filtering issue
2. **Parts blocklist can't help** - The accessories ("phone holder for Tesla") would need every brand/model blocked, which is impractical
3. **eBay Motors is the right source** - It has real vehicles with proper listings

