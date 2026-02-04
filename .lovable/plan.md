
# Fix Web Shop: Search API, Duplicate Search Bar & Header Layout

## Issues Summary

Based on code analysis and the screenshot, there are three distinct problems:

1. **Search API Not Working** - Products not fetching because the frontend sends POST body but the backend reads GET parameters
2. **Duplicate Search Bars** - Two search bars visible (one in header, one in page content)
3. **Header Layout Wrong** - Language/Cart/Account should be on the far RIGHT, not left

---

## Root Cause Analysis

### Issue 1: Search API Mismatch

**Frontend Code** (`SearchResults.tsx` lines 42-51):
```typescript
const { data, error } = await supabase.functions.invoke('catalog-search', {
  body: {
    query: query || category || 'popular',
    page: pageNum,
    limit: 24,
    sort,
    minPrice: priceRange[0] > 0 ? priceRange[0] : undefined,
    maxPrice: priceRange[1] < 5000 ? priceRange[1] : undefined,
  },
});
```

**Backend Code** (`catalog-search/index.ts` line 1406):
```typescript
const rawQuery = url.searchParams.get("q") || "";
```

The backend only reads from URL query parameters, not from POST body. Same issue exists in `FeaturedCarousel.tsx`.

### Issue 2: Duplicate Search Bars

- `ShopHeader.tsx` line 236 includes a `<SearchBar />`
- `SearchResults.tsx` line 118 adds ANOTHER `<SearchBar />` inside the page content

### Issue 3: Header Layout

Current layout: `[Menu][Logo][Language][Cart][Account][──Search──]`
Required layout: `[Menu][Logo][──────Search──────][Language][Cart][Account]`

---

## Solution

### Fix 1: Convert POST Body to GET Query Parameters

**Files to modify:**
- `src/pages/shop/SearchResults.tsx`
- `src/components/shop/FeaturedCarousel.tsx`

Replace `supabase.functions.invoke` with `fetch` using GET query parameters:

```typescript
// BEFORE (broken):
const { data, error } = await supabase.functions.invoke('catalog-search', {
  body: { query, limit: 24, page: pageNum }
});

// AFTER (fixed):
const params = new URLSearchParams({
  q: query || category || 'popular',
  limit: '24',
  ...(sort && sort !== 'relevance' && { sort }),
  ...(priceRange[0] > 0 && { filters: JSON.stringify({ minPrice: priceRange[0] }) }),
});
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search?${params}`,
  {
    headers: {
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  }
);
const data = await response.json();
```

### Fix 2: Remove Duplicate Search Bar from SearchResults

**File:** `src/pages/shop/SearchResults.tsx`

Remove or hide the `<SearchBar />` component since ShopHeader already has one:

```diff
<div className="pt-24 pb-4 px-4 ...">
  <div className="container mx-auto space-y-4">
-   <SearchBar defaultValue={query} onSearch={handleSearch} />
    
    <CategoryTabs 
      activeCategory={category || 'all'} 
      onCategoryChange={...}
    />
  </div>
</div>
```

### Fix 3: Restructure Header Layout

**File:** `src/components/shop/ShopHeader.tsx`

Move the search bar to the CENTER/LEFT and push Language/Cart/Account to the far RIGHT:

```text
NEW LAYOUT:
┌────────────────────────────────────────────────────────────────────┐
│  ☰  Logo  [──────────── Search Bar ────────────]   🌐  🛒  👤    │
└────────────────────────────────────────────────────────────────────┘
```

```typescript
<div className="flex items-center gap-2 md:gap-3">
  {/* LEFT: Menu + Logo */}
  <Sheet>...</Sheet>
  <Link to="/shop"><img src={afrishopLogo} ... /></Link>
  
  {/* CENTER: Search Bar - Takes most space */}
  <div className="flex-1 mx-2 md:mx-4">
    <SearchBar className="w-full" />
  </div>
  
  {/* RIGHT: Language + Cart + Account */}
  <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
    <LanguageSelector />
    <CartDrawer />
    {user ? <ProfileButton /> : <SignInButton />}
  </div>
</div>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/shop/SearchResults.tsx` | 1) Fix API call to use GET params, 2) Remove duplicate SearchBar |
| `src/components/shop/FeaturedCarousel.tsx` | Fix API call to use GET params |
| `src/components/shop/ShopHeader.tsx` | Restructure layout: Search center, actions on right |

---

## Technical Details

### SearchResults.tsx - API Fix

Replace lines 42-51:
```typescript
const fetchProducts = useCallback(async (pageNum: number, append: boolean = false) => {
  try {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    // Build query parameters for GET request
    const searchQuery = query || category || 'popular';
    const params = new URLSearchParams({
      q: searchQuery,
      limit: '24',
    });
    
    // Add optional parameters
    if (sort && sort !== 'relevance') {
      params.set('sort', sort);
    }
    
    // Build filters object if price range is set
    const filters: Record<string, number> = {};
    if (priceRange[0] > 0) filters.minPrice = priceRange[0];
    if (priceRange[1] < 5000) filters.maxPrice = priceRange[1];
    if (Object.keys(filters).length > 0) {
      params.set('filters', JSON.stringify(filters));
    }
    
    // Add cursor for pagination
    if (pageNum > 1 && cursor) {
      params.set('cursor', cursor);
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search?${params}`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (!response.ok) throw new Error('Search failed');
    const data = await response.json();
    
    // ... rest of the mapping code
  }
});
```

### FeaturedCarousel.tsx - API Fix

Replace lines 42-44:
```typescript
const params = new URLSearchParams({
  q: query,
  limit: '1',
});
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search?${params}`,
  {
    headers: {
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  }
);
if (!response.ok) return null;
const data = await response.json();
```

### ShopHeader.tsx - Layout Fix

Restructure the header flexbox to:
1. Keep Menu + Logo on left
2. SearchBar in the center with `flex-1` to take available space
3. Wrap Language/Cart/Account in a right-aligned container with `flex-shrink-0`

---

## Expected Result

After fixes:
1. **Search works** - Products fetch correctly with GET query parameters
2. **No duplicate search** - Only one search bar in the header
3. **Correct layout** - Search bar is prominent, Language/Cart/Account on far right
4. **Featured carousel loads** - Real products appear in the animated carousel
