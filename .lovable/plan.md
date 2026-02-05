
# Fix: Make Homepage Match Admin Portal Configuration

## Problem Identified

The homepage does NOT reflect what's configured in the Admin Portal's "Home Curation" settings because:

1. **Admin Portal** manages sections in `home_sections` table and seed queries in `home_section_seeds` table
2. **catalog-home/catalog-home-v2** edge functions read from a completely DIFFERENT table: `catalog_sections`

This means any changes you make in the admin panel (adding seeds, enabling/disabling sections, reordering) have **zero effect** on the live homepage.

### Evidence

**Admin Portal tables (`home_sections`):**
- 8 sections: phones, vehicles, gaming, computers, clothing, home_garden, refurbished, parts_accessories
- Has detailed seed queries in `home_section_seeds` (50+ active seeds)

**catalog-home reads (`catalog_sections`):**
- 5 sections: phones, video_games, computers, vehicles, fashion
- Uses simple `seed_query` field, ignores `home_section_seeds` entirely

---

## Solution: Connect catalog-home to Admin Tables

Refactor both `catalog-home` and `catalog-home-v2` edge functions to read from:
1. `home_sections` (for section configuration, eBay category IDs, min_price, is_vehicle)
2. `home_section_seeds` (for active seed queries per section)

### Database Changes

**Add relevance filtering columns to `home_sections`:**

```sql
ALTER TABLE public.home_sections
ADD COLUMN include_keywords TEXT[] DEFAULT '{}',
ADD COLUMN exclude_keywords TEXT[] DEFAULT '{}',
ADD COLUMN strict BOOLEAN DEFAULT true;

-- Populate with existing filtering rules
UPDATE public.home_sections SET
  include_keywords = ARRAY['iphone','samsung','galaxy','pixel','unlocked','smartphone'],
  exclude_keywords = ARRAY['case','cover','screen protector','charger','parts','repair','lot','lcd','holder','stand'],
  strict = true
WHERE key = 'phones';

UPDATE public.home_sections SET
  include_keywords = ARRAY['ps5','playstation','xbox','nintendo','switch','console','game','controller'],
  exclude_keywords = ARRAY['repair','tool','kit','screwdriver','shell','housing','replacement','mod','parts'],
  strict = true
WHERE key = 'gaming';

UPDATE public.home_sections SET
  include_keywords = ARRAY['laptop','macbook','thinkpad','dell','hp','lenovo','surface','notebook','desktop','pc'],
  exclude_keywords = ARRAY['case','sleeve','skin','sticker','decal','bag','cover','stand','mousepad','charger'],
  strict = true
WHERE key = 'computers';

UPDATE public.home_sections SET
  include_keywords = ARRAY['toyota','honda','ford','bmw','mercedes','chevy','nissan','truck','suv','sedan'],
  exclude_keywords = ARRAY['seat cover','floor mat','sticker','decal','hook','organizer','trim','parts','accessories'],
  strict = true
WHERE key = 'vehicles';

UPDATE public.home_sections SET
  include_keywords = ARRAY['shoes','sneakers','nike','adidas','dress','shirt','jacket','pants','jeans'],
  exclude_keywords = ARRAY['laces','insole','cleaner','protector','spray','brush','polish'],
  strict = true
WHERE key = 'clothing';
```

### Edge Function Changes

**New data loading function:**

```typescript
async function loadHomeSectionsAndSeeds(): Promise<{ sections: SectionConfig[] | null; error?: string }> {
  // 1. Fetch active sections from home_sections
  const sectionsRes = await fetch(
    `${supabaseUrl}/rest/v1/home_sections?enabled=eq.true&order=sort_order.asc&select=*`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }}
  );
  
  // 2. Fetch active seed queries from home_section_seeds
  const seedsRes = await fetch(
    `${supabaseUrl}/rest/v1/home_section_seeds?enabled=eq.true&select=section_key,query`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }}
  );
  
  // 3. Group seeds by section_key
  const seedsMap = new Map<string, string[]>();
  for (const seed of seeds) {
    if (!seedsMap.has(seed.section_key)) seedsMap.set(seed.section_key, []);
    seedsMap.get(seed.section_key)!.push(seed.query);
  }
  
  // 4. Combine sections with their seeds
  return sections.map(section => ({
    key: section.key,
    title_fr: section.title_fr,
    title_en: section.title_en,
    ebay_category_id: section.ebay_category,
    is_vehicle: section.is_vehicle,
    min_price_usd: section.min_price,
    include_keywords: section.include_keywords || [],
    exclude_keywords: section.exclude_keywords || [],
    strict: section.strict ?? true,
    active_seed_queries: seedsMap.get(section.key) || [section.see_all_query],
  }));
}
```

**Updated query construction:**

```typescript
// In fetchSectionItems:
const { active_seed_queries, exclude_keywords } = sectionConfig;

// Combine multiple seed queries
const baseQuery = active_seed_queries.slice(0, 5).join(' '); // Use up to 5 seeds
const enhancedQuery = buildEnhancedQuery(baseQuery, exclude_keywords);

// Use section's ebay_category from home_sections
if (sectionConfig.ebay_category_id) {
  searchUrl.searchParams.set("category_ids", sectionConfig.ebay_category_id);
}
```

### Update FALLBACK_SECTIONS

Match the 8 sections from admin:

```typescript
const FALLBACK_SECTIONS = [
  { key: "phones", title_fr: "Téléphones", title_en: "Phones", ebay_category_id: "9355", ... },
  { key: "vehicles", title_fr: "Véhicules", title_en: "Vehicles", ebay_category_id: "6001", is_vehicle: true, ... },
  { key: "gaming", title_fr: "Gaming", title_en: "Gaming", ebay_category_id: "1249", ... },
  { key: "computers", title_fr: "Ordinateurs", title_en: "Computers", ebay_category_id: "58058", ... },
  { key: "clothing", title_fr: "Vêtements & Chaussures", title_en: "Clothing & Shoes", ebay_category_id: "63889", ... },
  { key: "home_garden", title_fr: "Maison & Jardin", title_en: "Home & Garden", ebay_category_id: "11700", ... },
  { key: "refurbished", title_fr: "Reconditionné", title_en: "Refurbished", ebay_category_id: "11800", ... },
  { key: "parts_accessories", title_fr: "Pièces & Accessoires", title_en: "Parts & Accessories", ebay_category_id: "6028", ... },
];
```

### Bump Cache Version

```typescript
// src/lib/catalogCache.ts
const CACHE_PREFIX = 'afrishop_cache:v6:';
```

---

## Files to Modify

1. **Database Migration** - Add `include_keywords`, `exclude_keywords`, `strict` columns to `home_sections` and populate
2. **`supabase/functions/catalog-home/index.ts`** - Switch from `catalog_sections` to `home_sections` + `home_section_seeds`
3. **`supabase/functions/catalog-home-v2/index.ts`** - Same changes
4. **`src/lib/catalogCache.ts`** - Bump version to v6

---

## Expected Results After Fix

- Homepage sections will match exactly what's shown in Admin Portal "Home Curation"
- All 8 sections (Phones, Vehicles, Gaming, Computers, Clothing & Shoes, Home & Garden, Refurbished, Parts & Accessories) will appear
- Seed queries configured in admin will be used for eBay searches
- The "Publish Now" button in admin will trigger prewarm with the correct seeds
- Accessory/parts filtering will continue to work with the migrated exclude_keywords
