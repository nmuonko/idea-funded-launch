
# Fix Homepage "Accueil" Tab Showing Wrong Products

## Problem Found

The homepage "Accueil" tab is showing cheap car phone holders and phone cases instead of actual phones, laptops, and gaming consoles you seeded. This happens because:

1. The homepage recipe seeds are too broad -- "iPhone" and "Samsung Galaxy" match cheap accessories like "Car Phone Mount for iPhone" ($3.99)
2. There's no minimum price filter on the homepage recipe, so $3 car phone holders rank alongside $800 iPhones
3. The database query sorts by most recently updated, so cheap eBay accessories dominate

Category tabs (Gaming, Vehicles, etc.) work correctly because they have more specific seeds.

## Fix Plan

### 1. Update Homepage Recipe Seeds (Database)

Replace the 7 generic homepage seeds with more specific, diverse queries that represent a curated "featured" mix:

| Current Seed | Problem | Replacement Seeds |
|---|---|---|
| "iPhone" | Matches car phone holders | "iPhone 15 Pro Max", "iPhone 14 Pro" |
| "Samsung Galaxy" | Matches phone cases | "Samsung Galaxy S24 Ultra", "Samsung Galaxy Z Flip" |
| "laptop computer" | OK but vague | "MacBook Pro", "gaming laptop" |
| "PlayStation 5" | OK | Keep |
| "sofa set living room" | OK | Keep |
| "smart TV" | OK but vague | "Samsung 65 inch TV", "LG OLED TV" |
| "Google pixel" | OK | "Google Pixel 8 Pro" |

Additional new seeds for variety: "Air Jordan shoes", "LEGO set", "Apple Watch", "Nike sneakers", "Dyson vacuum"

### 2. Set Minimum Price on Homepage Recipe (Database)

Set `min_price_usd = 25` on the homepage recipe to filter out cheap accessories ($3-17 phone mounts, cases, screen protectors).

### 3. Rebuild the Web Cache

After updating seeds and min price, trigger a rebuild of the web homepage cache so the changes take effect immediately.

### 4. Fix the `fetchItemsFromDB` Query (Code Change)

In `supabase/functions/_shared/homeRecipeBuilder.ts`, the current query has a bug: when `min_price_usd` is set, it adds a second `price_usd` filter that conflicts with the existing `price_usd=gt.0`. Fix the filter construction to use `gte` properly.

## Technical Details

### Files Modified
| File | Change |
|---|---|
| Database: `home_recipes` table | Set `min_price_usd = 25` for homepage recipe |
| Database: `home_recipe_seeds` table | Delete old generic seeds, insert specific ones |
| `supabase/functions/_shared/homeRecipeBuilder.ts` | Fix duplicate price filter bug (lines 146-153) |

### Database Updates (Production)
These need to run in Live environment after publishing:
- Update homepage recipe min_price_usd
- Delete old seeds, insert new specific seeds
- Trigger cache rebuild via admin panel or edge function call

### Verification
After rebuild, the Accueil tab should show a diverse mix of high-value products (phones, laptops, TVs, consoles, furniture) instead of cheap car phone holders.
