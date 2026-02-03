

# Fix Home & Garden Category: Block Seeds, Vegetables & Plants

## Problem

When users browse or search "Home & Garden", they're seeing irrelevant items like:
- "Marketmore 76 Cucumber Seeds"
- "Heirloom Vegetable Seeds Survival Garden Kit"
- Various plant seeds and gardening seeds

**AfriShop should show**: Home appliances, furniture, vacuum cleaners, air fryers, kitchen tools, garden watering systems, outdoor furniture — NOT edible seeds, vegetables, or live plants.

---

## Root Cause

1. eBay's "Home & Garden" category (ID: 11700) includes subcategories for seeds, plants, and gardening supplies
2. The existing `contentBlocker.ts` blocks books/subscriptions but has no rules for seeds/vegetables
3. Searches like "home garden" return raw eBay results without filtering out these items

---

## Solution: Extend Content Blocker

Add blocked keywords for seeds, vegetables, and plants to `contentBlocker.ts`. This is the cleanest solution because:
- All catalog endpoints already use `filterDisallowedItems()`
- Changes apply globally (search, category browse, home sections)
- Consistent with existing book/subscription blocking pattern

---

## Technical Changes

### File: `supabase/functions/_shared/contentBlocker.ts`

**1. Add new blocked keywords for Home & Garden irrelevant content:**

```typescript
// ==================== HOME & GARDEN EXCLUSIONS ====================
// Seeds, vegetables, plants - NOT appropriate for AfriShop
// (AfriShop sells appliances, furniture, tools - not food/plants)
const HOME_GARDEN_BLOCKED_KEYWORDS = new Set([
  // Seeds
  "seeds",
  "seed",
  "seed packet",
  "seed packets",
  "heirloom seeds",
  "vegetable seeds",
  "flower seeds",
  "garden seeds",
  "herb seeds",
  "organic seeds",
  "non-gmo seeds",
  
  // Plants & Growing
  "seedling",
  "seedlings",
  "live plant",
  "live plants",
  "potted plant",
  "bulbs",
  "plant bulbs",
  "flower bulbs",
  "growing kit",
  "seed starter",
  
  // Vegetables & Produce (not selling food)
  "vegetable",
  "vegetables",
  "tomato plant",
  "pepper plant",
  "cucumber plant",
  "lettuce seeds",
  
  // Fertilizers & Chemicals (low margin, shipping issues)
  "fertilizer",
  "pesticide",
  "herbicide",
  "plant food",
  "potting soil",
  "garden soil",
  "mulch",
  "compost",
]);
```

**2. Update `isDisallowedItem()` to check these new keywords:**

```typescript
// After existing blocked keyword checks, add:
// 8. Check HOME & GARDEN exclusions
for (const keyword of HOME_GARDEN_BLOCKED_KEYWORDS) {
  if (keyword.length <= 5) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    if (regex.test(titleLower)) {
      return { isDisallowed: true, reason: "home_garden_exclusion", matchedPattern: keyword };
    }
  } else {
    if (titleLower.includes(keyword)) {
      return { isDisallowed: true, reason: "home_garden_exclusion", matchedPattern: keyword };
    }
  }
}
```

**3. Add allowlist for false positives:**

```typescript
// Allowlist for Home & Garden (prevent blocking legitimate products)
const HOME_GARDEN_ALLOWLIST = [
  "seed spreader",     // Lawn equipment
  "seed dispenser",    // Garden tool
  "vacuum seeder",     // Machinery
  "seed drill",        // Agricultural equipment
];
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/_shared/contentBlocker.ts` | Add blocked keywords for seeds/vegetables/plants, update filter function |

---

## Expected Results

### Before (Current Behavior)
Searching "home garden" returns:
- ❌ "Marketmore 76 Cucumber Seeds"
- ❌ "Heirloom Vegetable Seeds Survival Garden Kit"
- ✅ Air fryers
- ✅ Robot vacuums

### After (Fixed Behavior)
Searching "home garden" returns:
- ✅ Air fryers
- ✅ Robot vacuums
- ✅ Blenders
- ✅ Outdoor furniture
- ✅ Garden hose reels
- ✅ Pressure washers
- ✅ Lawn mowers

Seeds, vegetables, and plants will be automatically filtered out.

---

## Testing

After implementation, verify with:

1. Search "home garden" → No seeds/vegetables in results
2. Browse Home & Garden category → Only appliances, furniture, tools
3. Search "garden tools" → Shows hose reels, sprinklers, NOT seeds
4. Verify legitimate products not blocked:
   - "Seed spreader" (lawn equipment) → Should appear
   - "Vacuum seeder" (machinery) → Should appear

