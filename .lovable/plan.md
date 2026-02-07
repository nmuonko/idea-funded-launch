
# Fix "Load More" Showing Duplicate Results

## Problem
When clicking "Load More" on the search results page, the same products are displayed again instead of new ones. This happens because:

1. The backend uses **cursor-based pagination** - it returns a `nextCursor` token in each response
2. The frontend **never reads or sends** this cursor - every "Load More" request is identical to the first request, so the backend returns the same results

## Solution
Pass the `nextCursor` from the backend response back in subsequent requests. This is a frontend-only fix in one file.

## Technical Details

**File: `src/pages/shop/SearchResults.tsx`**

Changes:
1. Add a `nextCursor` state variable (initialized to `null`)
2. When `pageNum > 1`, include the cursor in the request params: `params.cursor = nextCursor`
3. After receiving the response, store `data.nextCursor` in state
4. Reset `nextCursor` to `null` when query/category/sort changes (same place `page` is reset)
5. Set `hasMore` based on whether `nextCursor` exists (not just item count)

The key change in `fetchProducts`:
- Add `if (pageNum > 1 && nextCursor) { params.cursor = nextCursor; }` before the fetch call
- After response: `setNextCursor(data?.nextCursor || null)`
- Update hasMore: `setHasMore(!!data?.nextCursor)`
