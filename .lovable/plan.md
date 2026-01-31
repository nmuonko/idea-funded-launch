
# Admin-Curated Homepage Implementation Plan

## Overview

This plan implements an admin-controlled homepage system where each section (phones, vehicles, gaming, etc.) can be driven by:
- **Manual seed queries** entered by admin
- **Generate Suggestions** button that proposes curated queries per section  
- **Approve & Publish** flow to control what appears on the homepage
- **12-hour rotation prewarm** that uses approved seeds to fetch mixed Amazon+eBay items

The existing `/catalog-home` endpoint contract remains unchanged - it continues serving from cache.

---

## Phase 1: Database Schema

### New Tables

**1. `home_sections`** - Section configuration
```sql
CREATE TABLE home_sections (
  key text PRIMARY KEY,
  title_en text NOT NULL,
  title_fr text NOT NULL,
  enabled boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  default_category_key text,
  ebay_category text,
  is_vehicle boolean DEFAULT false,
  min_price numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
```

**2. `home_section_seeds`** - Active seed queries for each section
```sql
CREATE TABLE home_section_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL REFERENCES home_sections(key) ON DELETE CASCADE,
  query text NOT NULL,
  enabled boolean DEFAULT true,
  weight integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**3. `home_seed_suggestions`** - Pending suggestions awaiting approval
```sql
CREATE TABLE home_seed_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL REFERENCES home_sections(key) ON DELETE CASCADE,
  query text NOT NULL,
  source text NOT NULL,
  score integer DEFAULT 0,
  approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

### Indexes
- `home_section_seeds`: (section_key, enabled), (section_key, weight DESC)
- `home_seed_suggestions`: (section_key, approved), (section_key, created_at DESC)
- `home_seen_items`: (section_key, seen_at DESC) - already exists

### Seed Initial Data
Insert default sections matching current `HOME_SECTIONS` config with titles and category mappings.

---

## Phase 2: Admin Settings Keys

Add to `admin_settings` table:
- `home_seed_mode`: "manual" | "auto" | "hybrid" (default: "manual")
- `home_seed_max_queries_per_section`: 12
- `home_generate_suggestion_count`: 30

Existing settings to leverage:
- `home_rotation_interval_minutes`: 720
- `home_cache_ttl_seconds`: 43200
- `home_items_per_section`: 120
- `home_avoid_repeat_days`: 7
- `mixed_amazon_first_count`, `mixed_blend_amazon`, `mixed_blend_ebay`

---

## Phase 3: Edge Functions

### 3.1 `admin-home-sections` (GET/POST)

**GET**: Returns all home sections with seed counts
```typescript
// Response
{
  sections: [
    { 
      key: "phones", 
      title_en: "Phones", 
      enabled: true,
      seed_count: 5,
      suggestion_count: 12
    },
    ...
  ],
  seed_mode: "manual"
}
```

**POST**: Update section (enabled, sort_order, titles)

### 3.2 `admin-home-seeds` (GET/POST/DELETE)

**GET `?section_key=phones`**: Returns seeds sorted by weight
**POST**: Upsert seed query (add/edit)
**DELETE**: Remove seed by ID

### 3.3 `admin-home-seed-suggestions` (POST generate, POST approve, GET list)

**POST /generate**: Generate suggestions using hardcoded TEMPLATE_LIBRARY
```typescript
const TEMPLATE_LIBRARY = {
  phones: [
    "iPhone 15 unlocked", "iPhone 14 unlocked", "Samsung Galaxy S24", 
    "Google Pixel unlocked", "Tecno Spark", "Infinix Hot", "Redmi Note"
  ],
  vehicles: [
    "Toyota RAV4", "Toyota Land Cruiser", "Honda CR-V", "Ford Explorer",
    "Tesla Model 3", "Jeep Wrangler", "Toyota Hilux", "Nissan Patrol"
  ],
  gaming: [
    "PlayStation 5 console", "Xbox Series X", "Nintendo Switch",
    "gaming laptop", "gaming headset", "gaming monitor"
  ],
  clothing: [
    "women sneakers", "men running shoes", "women handbag",
    "men jeans", "baby clothes", "designer dress"
  ],
  // ... other sections
};
```

**POST /approve**: Copy approved suggestions to `home_section_seeds`

**GET `?section_key=phones`**: List pending suggestions

### 3.4 Update `catalog-prewarm-worker`

Modify to read seeds from database instead of hardcoded arrays:

```typescript
// Get active seeds based on mode
async function getSectionQueries(supabase, sectionKey, mode, maxQueries) {
  if (mode === "auto") {
    return TEMPLATE_LIBRARY[sectionKey]?.slice(0, maxQueries) || [];
  }
  
  // Manual or hybrid: fetch from home_section_seeds
  const { data: seeds } = await supabase
    .from("home_section_seeds")
    .select("query, weight")
    .eq("section_key", sectionKey)
    .eq("enabled", true)
    .order("weight", { ascending: false })
    .limit(maxQueries);
  
  const dbQueries = seeds?.map(s => s.query) || [];
  
  if (mode === "hybrid" && dbQueries.length < maxQueries) {
    // Fill remaining from template
    const remaining = maxQueries - dbQueries.length;
    const templates = TEMPLATE_LIBRARY[sectionKey] || [];
    const fillers = templates
      .filter(t => !dbQueries.includes(t))
      .slice(0, remaining);
    return [...dbQueries, ...fillers];
  }
  
  return dbQueries;
}
```

---

## Phase 4: Admin UI Page

### New Page: `/admin/home-curation`

Location: `src/pages/admin/HomeCuration.tsx`

**Layout:**
```text
+--------------------------------------------------+
|  Home Curation                    [Publish Now]  |
+--------------------------------------------------+
|  Section: [phones v]  Mode: [manual v]           |
+--------------------------------------------------+
|  ACTIVE SEEDS                 | SUGGESTIONS      |
|  +-------------------------+  | +---------------+|
|  | iPhone 15 unlocked  [x] |  | | Generate [30] ||
|  | Samsung Galaxy S24  [x] |  | +---------------+|
|  | Google Pixel 8      [x] |  | [x] Tecno Spark ||
|  +-------------------------+  | [x] Infinix Hot ||
|  [+ Add Seed Query]           | [ ] Redmi Note  ||
|                               | [Approve (2)]   ||
+--------------------------------------------------+
|  Current Rotation: 2026-01-31-b0                 |
|  Last Prewarm: 2026-01-31 14:32 (5 min ago)      |
+--------------------------------------------------+
```

**Components:**
1. Section dropdown selector
2. Seeds list with enable/disable toggle
3. Add new seed input
4. Generate Suggestions button
5. Suggestions checklist with Approve button
6. Publish Now button (triggers prewarm)
7. Status display (rotation key, last prewarm time)

### Add Route

```typescript
// App.tsx
<Route path="home-curation" element={
  <AdminRouteGuard requiredPermission="can_view_settings">
    <HomeCuration />
  </AdminRouteGuard>
} />
```

### Add Sidebar Link

```typescript
// AdminLayout.tsx - System section
{ 
  to: '/admin/home-curation', 
  icon: Home, 
  label: language === 'fr' ? 'Curation Accueil' : 'Home Curation',
  permission: 'can_view_settings' 
}
```

---

## Phase 5: Update catalog-home

Minimal change - add section titles from database if available:

```typescript
// catalog-home/index.ts
// Load enabled sections from home_sections table
const { data: dbSections } = await supabase
  .from("home_sections")
  .select("*")
  .eq("enabled", true)
  .order("sort_order", { ascending: true });

// Use db sections if available, else fall back to hardcoded HOME_SECTIONS
const activeSections = dbSections?.length > 0 
  ? dbSections.map(s => ({
      key: s.key,
      categoryKey: s.default_category_key,
      title: s.title_en, // or based on locale
      isVehicle: s.is_vehicle,
      minPrice: s.min_price,
      ebayCategory: s.ebay_category,
      // ... map other fields
    }))
  : HOME_SECTIONS;
```

---

## Files to Create/Modify

### Database
1. **Migration**: Create `home_sections`, `home_section_seeds`, `home_seed_suggestions` tables
2. **Seed data**: Insert default sections

### Edge Functions
3. **Create**: `supabase/functions/admin-home-sections/index.ts`
4. **Create**: `supabase/functions/admin-home-seeds/index.ts`
5. **Create**: `supabase/functions/admin-home-seed-suggestions/index.ts`
6. **Modify**: `supabase/functions/catalog-prewarm-worker/index.ts` - Read seeds from DB
7. **Modify**: `supabase/functions/catalog-home/index.ts` - Read sections from DB

### Frontend
8. **Create**: `src/pages/admin/HomeCuration.tsx`
9. **Modify**: `src/App.tsx` - Add route
10. **Modify**: `src/components/layout/AdminLayout.tsx` - Add sidebar link

### Shared
11. **Create**: `supabase/functions/_shared/homeSeedTemplates.ts` - Hardcoded template library

---

## Technical Details

### Template Library (Hardcoded Fallback)

```typescript
// _shared/homeSeedTemplates.ts
export const TEMPLATE_LIBRARY: Record<string, string[]> = {
  phones: [
    "iPhone 15 unlocked", "iPhone 14 Pro Max", "Samsung Galaxy S24 Ultra",
    "Samsung Galaxy A54", "Google Pixel 8 Pro", "Google Pixel 7a",
    "Tecno Spark 20", "Tecno Camon 20", "Infinix Hot 40", "Infinix Note 30",
    "Redmi Note 13", "Xiaomi 14", "OnePlus 12", "Motorola Edge"
  ],
  vehicles: [
    "Toyota RAV4", "Toyota Land Cruiser", "Toyota Hilux pickup",
    "Honda CR-V", "Honda Accord", "Ford Explorer", "Ford F-150",
    "Tesla Model 3", "Tesla Model Y", "Jeep Wrangler", "Jeep Grand Cherokee",
    "Nissan Patrol", "Mercedes GLE", "BMW X5", "Range Rover Sport"
  ],
  gaming: [
    "PlayStation 5 console", "PS5 digital edition", "Xbox Series X",
    "Xbox Series S", "Nintendo Switch OLED", "Nintendo Switch Lite",
    "gaming laptop RTX", "ASUS ROG laptop", "gaming headset", "gaming monitor 144hz",
    "gaming chair", "PS5 controller", "Xbox controller"
  ],
  computers: [
    "MacBook Pro M3", "MacBook Air M2", "Dell XPS 15", "HP Spectre",
    "ThinkPad X1 Carbon", "ASUS ZenBook", "gaming laptop", "Chromebook",
    "iPad Pro", "Surface Pro", "desktop computer", "all-in-one PC"
  ],
  clothing: [
    "Nike Air Max", "Nike sneakers women", "Adidas running shoes",
    "Jordan sneakers", "women designer handbag", "men leather jacket",
    "women summer dress", "men jeans Levis", "baby clothes organic",
    "women workout leggings", "men hoodie", "winter jacket"
  ],
  home_garden: [
    "robot vacuum Roomba", "air fryer Ninja", "Instant Pot",
    "Dyson vacuum", "Nespresso coffee machine", "KitchenAid mixer",
    "smart thermostat", "Ring doorbell", "outdoor furniture", "garden tools"
  ],
  refurbished: [
    "refurbished iPhone 13", "refurbished MacBook Pro", "refurbished iPad",
    "certified refurbished laptop", "refurbished Samsung Galaxy",
    "refurbished Apple Watch", "refurbished AirPods"
  ],
  parts_accessories: [
    "iPhone case", "Samsung phone case", "laptop charger USB-C",
    "car phone mount", "wireless earbuds", "screen protector",
    "laptop stand", "keyboard mouse combo", "USB hub", "webcam HD"
  ],
};
```

### Data Flow

```text
Admin clicks "Generate Suggestions"
        │
        ▼
admin-home-seed-suggestions (POST /generate)
        │ returns 30 suggestions from TEMPLATE_LIBRARY
        ▼
Admin selects 5 suggestions, clicks "Approve"
        │
        ▼
admin-home-seed-suggestions (POST /approve)
        │ copies to home_section_seeds
        ▼
Admin clicks "Publish Now"
        │
        ▼
catalog-prewarm-home → catalog-prewarm-worker
        │ reads from home_section_seeds
        │ fetches Amazon + eBay items
        │ mixes using providerMixer
        ▼
catalog_cache updated with new rotation
        │
        ▼
catalog-home serves fresh mixed content
```

---

## Testing Checklist

1. Add 6 vehicle seed queries manually (Toyota, Tesla, Ford)
2. Run "Publish Now"
3. Verify `/catalog-home` vehicles section returns mixed results
4. Disable a seed → next publish changes results
5. Generate suggestions → approve 5 → publish shows new results
6. Verify rotation key changes after 12h bucket
7. Verify existing frontend continues working unchanged

---

## Security

- All admin endpoints protected with `verifyAndGetUser` + admin role check
- Audit logging for seed changes
- RLS policies restrict table access to authenticated admins

---

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Seed control | Hardcoded in worker | Admin-configurable |
| Flexibility | Deploy to change | Real-time changes |
| Suggestions | None | Template-based generation |
| Visibility | No insight | Full dashboard |
| Brand curation | Manual code edits | Point-and-click |
