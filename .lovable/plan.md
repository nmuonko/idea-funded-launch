

# Fix Duplicate Electronics Tabs + Add Refurbished Cheap Phones

## What's Wrong

The backend returns 10 category tabs. Three of them (`business_industrial`, `refurbished`, `parts_accessories`) are incorrectly mapped to the label "Electronics" in the frontend's `keyMap` (lines 19-22 of `CategoryTabs.tsx`). Combined with the actual "Electronics" tab, this creates 4 tabs all showing "Electronics".

Additionally, `gaming` and `computers` in the default tabs are sub-categories of Electronics that add clutter without much value.

## What Changes

### File 1: `src/components/shop/CategoryTabs.tsx`

**Fix the `keyMap`** so each backend key maps to its own translation:
- `business_industrial` mapped to `'electronics'` -- remove this entry (hide this tab)
- `refurbished` mapped to `'electronics'` -- change to `'refurbished'` (its own label)
- `parts_accessories` mapped to `'electronics'` -- change to `'partsAccessories'`

**Clean up default tabs** to remove sub-category clutter:
- Remove `gaming` and `computers` (sub-categories of electronics)
- Add a `refurbished` tab with a dedicated icon for cheap/renewed items

**Deduplicate backend tabs**: When the backend response arrives with tabs, deduplicate by the *resolved display label* so even if the backend sends overlapping keys, only one tab per unique label appears.

### File 2: `supabase/functions/_shared/categoryMapper.ts`

**Remove `business_industrial` from the TABS array** -- it's not relevant for the AfriShop consumer audience and only adds noise. This stops the backend from sending it to the frontend at all.

### File 3: `supabase/functions/_shared/categoryRegistry.ts`

**Add `refurbished` alias** so the search backend properly handles the refurbished category tab, mapping it to eBay's refurbished category.

## Result

The final tab bar will be:
All | Electronics | Vehicles | Home | Fashion | Toys | Sporting Goods | Watches | Refurbished | Parts

- "Electronics" appears exactly once and returns real electronics (phones, laptops, gadgets)
- "Refurbished" is its own tab returning cheap refurbished phones and electronics
- No duplicate labels

## Technical Details

### CategoryTabs.tsx changes

Default tabs (replacing current list):
```
all, electronics, vehicles, home, fashion, toys, sporting_goods, watches, refurbished
```

Updated `keyMap`:
```
refurbished -> 'refurbished'     (was 'electronics')
parts_accessories -> 'partsAccessories'  (was 'electronics')
business_industrial -> removed   (tab hidden entirely)
```

Add deduplication when processing backend tabs:
```
const seen = new Set<string>();
const dedupedTabs = mappedTabs.filter(tab => {
  if (seen.has(tab.key)) return false;
  seen.add(tab.key);
  return true;
});
```

### categoryMapper.ts changes

Remove the `business_industrial` entry from the `TABS` array (lines 134-140).

### categoryRegistry.ts changes

Add alias: `refurbished` -> `refurbished` (identity mapping to mark it as a known category so it doesn't get dropped during resolution).
