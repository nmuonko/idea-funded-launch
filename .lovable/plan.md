

# Fix Homepage Section Relevance: Exclude Accessories

## Problem Summary

Homepage sections display irrelevant accessories instead of primary items:
- **Ordinateurs**: Shows laptop bags, sleeves, stickers instead of actual laptops
- **Véhicules**: Shows seat covers, hooks, organizers instead of real vehicles  
- **Video Games**: Shows repair kits, screwdrivers instead of consoles/games
- **Téléphones**: Shows cases, screen protectors instead of actual phones

The eBay category filtering alone is insufficient because categories include both primary items and their accessories.

---

## Solution Architecture

### A. Database Schema Enhancement

Add new columns to `catalog_sections` table:

| Column | Type | Purpose |
|--------|------|---------|
| `include_keywords` | TEXT[] | Primary item keywords that MUST appear in title |
| `exclude_keywords` | TEXT[] | Accessory keywords to filter OUT |
| `min_price_usd` | NUMERIC | Price floor to exclude cheap accessories |
| `strict` | BOOLEAN | Whether to enforce strict filtering |

### B. Two-Layer Filtering Strategy

**Layer 1 - Query Enhancement (eBay API)**
- Build query with negative keywords: `q = "laptop macbook -case -sleeve -bag -skin"`
- eBay supports `-term` to exclude matching items

**Layer 2 - Server-Side Post-Filtering**
- After fetching, scan each item's title
- Remove any item where title contains excluded keywords
- Apply regex patterns for common accessory indicators

---

## Technical Implementation

### 1. Database Migration

```sql
ALTER TABLE catalog_sections 
ADD COLUMN include_keywords TEXT[] DEFAULT '{}',
ADD COLUMN exclude_keywords TEXT[] DEFAULT '{}',
ADD COLUMN min_price_usd NUMERIC DEFAULT NULL,
ADD COLUMN strict BOOLEAN DEFAULT true;

-- phones: actual phones only
UPDATE catalog_sections SET
  include_keywords = ARRAY['iphone','samsung','galaxy','pixel','smartphone','unlocked','android','5g','pro max','ultra'],
  exclude_keywords = ARRAY['case','cover','screen protector','tempered','charger','cable','parts','repair','lcd','digitizer','housing','frame','back glass','lot','bulk','battery','replacement'],
  min_price_usd = 50,
  strict = true
WHERE key = 'phones';

-- video_games: consoles and games only
UPDATE catalog_sections SET
  include_keywords = ARRAY['ps5','playstation 5','xbox series','nintendo switch','console','game','controller','gaming'],
  exclude_keywords = ARRAY['repair','tool','kit','screwdriver','shell','housing','replacement','mod','thumbstick','joystick','charging port','parts','flex cable','ribbon'],
  min_price_usd = 20,
  strict = true
WHERE key = 'video_games';

-- computers: laptops/desktops only
UPDATE catalog_sections SET
  include_keywords = ARRAY['laptop','macbook','thinkpad','dell','hp','lenovo','surface','notebook','chromebook','desktop','pc','computer','workstation'],
  exclude_keywords = ARRAY['case','sleeve','skin','sticker','decal','bag','cover','keyboard cover','trackpad','stand','mousepad','vinyl','protector','screen protector','holder','dock','hub','charger','adapter'],
  min_price_usd = 100,
  strict = true
WHERE key = 'computers';

-- vehicles: real vehicles only (most strict)
UPDATE catalog_sections SET
  include_keywords = ARRAY['toyota','honda','ford','bmw','mercedes','chevy','chevrolet','nissan','hyundai','kia','volkswagen','audi','lexus','mazda','subaru'],
  exclude_keywords = ARRAY['seat cover','steering wheel cover','sticker','decal','hook','organizer','trim','handle cover','floor mat','parts','accessories','kit','emblem','badge','keychain','air freshener','phone holder','cup holder','tissue box','visor','sunshade'],
  min_price_usd = 1000,
  strict = true
WHERE key = 'vehicles';

-- fashion: actual clothing/shoes
UPDATE catalog_sections SET
  include_keywords = ARRAY['shoes','sneakers','boots','nike','adidas','jordan','puma','new balance','dress','shirt','jacket','pants','jeans'],
  exclude_keywords = ARRAY['laces','insole','cleaner','protector','crease','shield','storage','organizer','spray','brush','polish'],
  min_price_usd = 15,
  strict = true
WHERE key = 'fashion';
```

### 2. Update Edge Functions

Add filtering logic in both `catalog-home` and `catalog-home-v2`:

**A. Update SectionConfig interface:**
```typescript
interface SectionConfig {
  key: string;
  title_fr: string;
  title_en: string;
  seed_query: string;
  mode: string;
  ebay_category_id?: string;
  include_keywords?: string[];
  exclude_keywords?: string[];
  min_price_usd?: number;
  strict?: boolean;
}
```

**B. Add query builder with negative keywords:**
```typescript
function buildEnhancedQuery(seedQuery: string, excludeKeywords: string[]): string {
  if (!excludeKeywords || excludeKeywords.length === 0) {
    return seedQuery;
  }
  // eBay supports up to ~10 negative terms effectively
  const negatives = excludeKeywords.slice(0, 10).map(kw => `-${kw.replace(/\s+/g, '')}`);
  return `${seedQuery} ${negatives.join(' ')}`;
}
```

**C. Add server-side relevance filter:**
```typescript
function filterRelevantItems(
  items: CatalogItem[],
  config: SectionConfig,
  correlationId: string
): { filtered: CatalogItem[]; excluded: number; topExcluded: string[] } {
  const { exclude_keywords = [], min_price_usd, strict = true } = config;
  
  // Build exclusion regex from keywords
  const excludePatterns = exclude_keywords.map(kw => 
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
  );
  
  // Common accessory patterns
  const accessoryRegex = /(case|cover|sleeve|skin|sticker|decal|protector|replacement|repair|tool|kit|parts|holder|mount|stand|charger|cable|adapter|bag|pouch|wallet|strap|hook|organizer|mat|trim|emblem)/i;
  
  const topExcluded: string[] = [];
  
  const filtered = items.filter(item => {
    const title = (item.title || '').toLowerCase();
    const price = item.price_usd ?? item.priceUsd ?? 0;
    
    // Price floor check
    if (min_price_usd && price < min_price_usd) {
      if (topExcluded.length < 5) topExcluded.push(`price<${min_price_usd}: ${title.substring(0,40)}`);
      return false;
    }
    
    // Excluded keywords check
    for (const pattern of excludePatterns) {
      if (pattern.test(title)) {
        if (topExcluded.length < 5) topExcluded.push(`keyword: ${title.substring(0,40)}`);
        return false;
      }
    }
    
    // General accessory pattern check (when strict)
    if (strict && accessoryRegex.test(title)) {
      if (topExcluded.length < 5) topExcluded.push(`accessory: ${title.substring(0,40)}`);
      return false;
    }
    
    return true;
  });
  
  console.log(`[SECTION_RELEVANCE] key=${config.key} before=${items.length} after=${filtered.length} excluded=${items.length - filtered.length} topExcluded=${JSON.stringify(topExcluded)}`);
  
  return { filtered, excluded: items.length - filtered.length, topExcluded };
}
```

**D. Update DB query to fetch new columns:**
```typescript
const response = await fetch(
  `${supabaseUrl}/rest/v1/catalog_sections?is_active=eq.true&order=sort_order.asc&select=key,title_fr,title_en,seed_query,mode,ebay_category_id,include_keywords,exclude_keywords,min_price_usd,strict`,
  // ...
);
```

**E. Apply filtering in fetchSectionItems:**
```typescript
// After getting raw items from eBay...
const { filtered, excluded, topExcluded } = filterRelevantItems(rawMappedItems, sectionConfig, correlationId);

// For vehicles mode, apply additional vehicle-specific filtering
if (mode === 'vehicle') {
  console.log(`[VEHICLE_STRICT] key=${key} before=${rawMappedItems.length} after=${filtered.length} droppedParts=${excluded}`);
}

return { items: filtered, ms: Date.now() - startMs };
```

**F. Update FALLBACK_SECTIONS with default filters:**
```typescript
const FALLBACK_SECTIONS = [
  { 
    key: "phones", 
    title_fr: "Téléphones", 
    title_en: "Phones", 
    seed_query: "iphone samsung smartphone unlocked -case -cover -parts",
    mode: "general", 
    ebay_category_id: "9355",
    exclude_keywords: ["case","cover","screen protector","charger","parts","repair","lot","lcd"],
    min_price_usd: 50,
    strict: true
  },
  // ... similar for other sections
];
```

### 3. Bump Cache Version

```typescript
// src/lib/catalogCache.ts
const CACHE_PREFIX = 'afrishop_cache:v5:';
```

---

## Files to Modify

1. **Database Migration** - Add columns: `include_keywords`, `exclude_keywords`, `min_price_usd`, `strict`
2. **`supabase/functions/catalog-home/index.ts`** - Add filtering logic
3. **`supabase/functions/catalog-home-v2/index.ts`** - Add same filtering logic
4. **`src/lib/catalogCache.ts`** - Bump version to v5

---

## Expected Results

After implementation:
- **Phones**: Shows actual iPhones, Samsung Galaxy, Pixels (not cases/parts)
- **Video Games**: Shows PS5, Xbox, Nintendo consoles (not repair toolkits)
- **Computers**: Shows MacBooks, Dell laptops, HP notebooks (not sleeves/stickers)
- **Vehicles**: Shows actual car listings (not seat covers/hooks)
- **Fashion**: Shows actual shoes/clothing (not laces/cleaners)

### Logging Output
```
[SECTION_RELEVANCE] key=computers before=24 after=12 excluded=12 topExcluded=["keyword: laptop bag for...","accessory: laptop sleeve..."]
[VEHICLE_STRICT] key=vehicles before=24 after=8 droppedParts=16
```

---

## Constraints Met

- No supabase-js SDK usage
- Response contract unchanged
- Backend-only changes (no frontend modifications)
- Lightweight implementation to avoid bundler timeout

