
# Fix Category Tabs + Search Pagination

## Changes

### 1. Rename "Tout/All" tab to "Accueil/Homepage"
**Why**: The "All" tab currently triggers a search for "popular" which can return irrelevant items (books). Instead, it should navigate back to the homepage which shows the curated feed.

**Files**:
- `src/lib/i18n/translations.ts`: Change `all: 'All'` to `all: 'Homepage'` (EN line 278) and `all: 'Tout'` to `all: 'Accueil'` (FR line 670)
- `src/components/shop/CategoryTabs.tsx`: Change `navigate('/browse')` to `navigate('/')` in `handleTabClick` for the `all` key (line 137)

### 2. Rename "Electronics" tab to "Gaming" and fix results
**Why**: The electronics tab returns broad results including cars. Switching to the `gaming` key routes to eBay category 1249 (Video Games & Consoles) which returns Xbox, PS5, etc. The backend already has `gaming` mapped correctly.

**Files**:
- `src/lib/i18n/translations.ts`: Change `electronics: 'Electronics'` to `electronics: 'Gaming'` (EN line 261) and `electronics: 'Électronique'` to `electronics: 'Jeux Vidéo'` (FR line 653)
- `src/components/shop/CategoryTabs.tsx`: Change the default tab from `{ key: 'electronics', ... icon: Cpu }` to `{ key: 'gaming', ... icon: Gamepad2 }` (line 58)

### 3. Increase search results to 100 per page, max 3 pages
**Why**: Users want to see more items at once and have a clear limit.

**File**: `src/pages/shop/SearchResults.tsx`
- Change `limit: 24` to `limit: 100` (line 58)
- Cap pagination at 3 pages: update `setHasMore` to include `&& pageNum < 3` (line 117)

## Summary of File Changes

| File | Change |
|------|--------|
| `src/lib/i18n/translations.ts` | Rename `all` to Homepage/Accueil, rename `electronics` to Gaming/Jeux Video |
| `src/components/shop/CategoryTabs.tsx` | Change `electronics` tab key to `gaming` with Gamepad2 icon; navigate to `/` for `all` |
| `src/pages/shop/SearchResults.tsx` | `limit: 100`, cap at 3 pages |
