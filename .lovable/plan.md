

# Replace iPhone 17 Pro Max with Refurbished Version in Trending

## What's happening now
The "Tendances" section uses `sortByLuxury()` which sorts items by luxury keywords first, then by **highest price descending**. This means a $2k new iPhone 17 Pro Max always outranks the $918 Amazon Renewed version.

## What exists in the catalog
There's an **"Apple iPhone 17 Pro Max (Renewed)" at $918 from Amazon** already in the catalog — perfect match for what you want.

## Plan

### 1. Add "renewed/refurbished" boost to trending sort logic
**File**: `src/lib/categoryConfig.ts`

Modify `sortByLuxury()` to give a bonus to items with "renewed" or "refurbished" in the title when they're in the phone category. This makes the $918 renewed version rank higher than the $2k new version, while keeping luxury sorting for other categories.

Additionally, add a price ceiling preference: for phones in trending, prefer items in the $500–$1,500 range over items above $1,500. This naturally surfaces the more affordable refurbished models that are realistic purchases for the target market.

### 2. Filter out "for parts/repair" and "cracked" items from trending
**File**: `src/pages/shop/ShopHome.tsx`

Add a filter in the `trendingFeed` memo to exclude items with titles containing "parts", "repair", "cracked", "AS-IS", or "READ DESCRIPTION" — these are showing up in the catalog and could leak into trending.

## Result
The trending section will show the ~$918 Amazon Renewed iPhone 17 Pro Max instead of the ~$2k new one, which is more realistic for your DRC audience.

