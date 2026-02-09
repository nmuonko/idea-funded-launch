
# Replace Language Section with Disconnect Button + Fix Home Tab Content

## 1. Profile Page: Replace "Langue / Language" with Disconnect Button

**File:** `src/pages/Profile.tsx`

- Remove the `LanguageDropdown` import and the `Globe` icon import
- Replace the entire "Langue / Language" section (lines 421-428) with a **Disconnect / Sign Out** button
- Add `LogOut` icon import from lucide-react
- The button calls `signOut()` from the auth context and navigates to `/`
- Style: red/destructive variant to make it clearly a sign-out action

```
Before:
  [Separator]
  Globe icon - "Langue / Language"
  LanguageDropdown component

After:
  [Separator]
  LogOut icon - "Disconnect / Deconnexion"
  Red "Sign Out" button
```

---

## 2. Fix Home Tab Showing Knives/Kitchen Utensils Instead of Furniture

The problem is that old cached data plus multiple seed/fallback query lists still target small kitchen appliances. Four files need updating:

### 2A. `supabase/functions/_shared/homeSeedTemplates.ts` (lines 138-160+)

Replace the `home_garden` seed array. Remove all small appliances (air fryer, vacuum, blender, Instant Pot, KitchenAid, etc.) and replace with furniture-focused queries:

```
home_garden: [
  "living room sofa set",
  "sectional sofa couch",
  "dining table set 6 chairs",
  "dining room table set",
  "kitchen cabinet set",
  "TV stand entertainment center",
  "coffee table living room",
  "bookshelf storage cabinet",
  "bedroom furniture set",
  "recliner sofa chair",
  "bar stool kitchen counter",
  "office desk chair set",
  "shoe rack entryway",
  "dresser bedroom storage",
  "nightstand bedside table",
]
```

### 2B. `supabase/functions/catalog-category/index.ts` (line 96)

Update `CATEGORY_FALLBACK_QUERIES` for `home_garden`:

```
home_garden: [
  "living room sofa set",
  "dining table set chairs",
  "kitchen cabinet storage",
  "TV stand entertainment center"
]
```

(line 134 `AMAZON_DEFAULT_QUERIES` already updated to furniture — keep as is)

### 2C. `supabase/functions/catalog-home/index.ts` (line 158) and `catalog-home-v2/index.ts` (line 152)

Update the `home_garden` section keywords from generic terms to furniture-focused:

```
keywords: ["sofa", "couch", "dining table", "living room", "sectional",
           "cabinet", "bookshelf", "dresser", "recliner", "furniture set"]
```

Remove: "decor", "garden", "bed", "lamp" (too generic, pulls in kitchen items)

### 2D. After deploying: Admin must clear cache

The old cached results (knives, air fryers) will persist until the cache is cleared. After deployment, go to Admin > Cache Settings > Clear Search Cache, then re-seed the homepage.

---

## Summary

| File | Change |
|------|--------|
| `src/pages/Profile.tsx` | Replace Language section with Sign Out button |
| `supabase/functions/_shared/homeSeedTemplates.ts` | Replace home_garden seeds with furniture queries |
| `supabase/functions/catalog-category/index.ts` line 96 | Update fallback queries to furniture |
| `supabase/functions/catalog-home/index.ts` line 158 | Update keywords to furniture-focused |
| `supabase/functions/catalog-home-v2/index.ts` line 152 | Update keywords to furniture-focused |
