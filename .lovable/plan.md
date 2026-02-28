
# Fix: "Topicrem DA" and similar niche searches returning zero results

## Root Cause (from live logs)

The logs show the exact failure chain:
1. **eBay is rate-limited (429)** on ALL cascade attempts -- the cascade fires 3 eBay API calls in rapid succession, but since the first one already got 429'd, the next two always fail too (wasted calls).
2. **DB has no "topicrem" items** because they were never cached (first-time search for this brand).
3. **Negative cache is skipped** (correct behavior), but the user still sees "No products found."

The cascade mechanism (added in the previous fix) is structurally correct but has two critical bugs:
- It doesn't detect 429 from the first call and stop early -- it blindly tries all 3 candidates against a rate-limited API.
- `fetchEbayItems` **swallows the rate-limit warning** from `searchEbay` and returns `{ items: [], total: 0 }` with no signal that the failure was due to rate limiting vs genuinely empty results.

## Implementation Plan

### 1. Propagate rate-limit signal from fetchEbayItems

**File**: `supabase/functions/_shared/ebayFetcher.ts`

Add a `rateLimited` boolean to `EbayFetchResult` interface. When `searchEbay` returns a warning with code `RATE_LIMITED`, set `rateLimited: true` in the return value so callers can detect this.

### 2. Stop cascade on first 429 detection

**File**: `supabase/functions/catalog-search/index.ts` (lines ~1711-1750)

In the last-resort cascade loop, check `lastResortResult.rateLimited`. If true:
- Record the failure in the circuit breaker (`recordProviderFailure("ebay", 429)`)
- Break the loop immediately (no point trying more candidates)
- Log the early exit

### 3. Auto-retry on frontend when rate-limited with 0 results

**File**: `supabase/functions/catalog-search/index.ts` (response building, line ~1757)

When all fallbacks return 0 AND the reason is rate limiting (not genuine empty), include a signal in the response:
```json
{ "retryable": true, "retryAfterMs": 3000 }
```

**File**: `src/pages/shop/SearchResults.tsx` (lines ~329-390)

When `data.retryable === true` and `returnedCount === 0`:
- Don't show "No products found" immediately
- Show a "Loading products..." spinner
- Auto-retry after `retryAfterMs` (default 3s), up to 2 retries
- Only show empty state after retries are exhausted

### 4. Record rate-limit in circuit breaker from provider fetch path

**File**: `supabase/functions/catalog-search/index.ts` (lines ~1081-1104)

When the primary eBay provider fetch returns 0 items with a rate-limit warning, call `recordProviderFailure("ebay", 429)` so that subsequent searches within the cooldown window skip eBay entirely (and rely on DB + Amazon).

## Technical Details

### ebayFetcher.ts changes
- Add `rateLimited?: boolean` and `warning?: { message: string; code: string }` to `EbayFetchResult`
- Propagate `ebayResult.warning` to the return value
- When `ebayResult.warning?.code === "RATE_LIMITED"`, set `rateLimited: true`

### catalog-search/index.ts changes (last-resort cascade)
- After each cascade attempt, check `lastResortResult?.rateLimited`
- If rate-limited, log and break the loop
- Call `recordProviderFailure("ebay", 429)` on rate-limit detection
- When returning empty after rate-limit, add `retryable: true, retryAfterMs: 3000` to response

### SearchResults.tsx changes (frontend auto-retry)
- Add `retryCountRef` to track retry attempts (max 2)
- In `fetchProducts`, detect `data.retryable === true` with 0 items
- Set a timer for `data.retryAfterMs || 3000` to re-call `fetchProducts`
- During retry, show loading state instead of empty state
- Reset retry counter on new search queries

## Expected Outcome

- "Topicrem DA" search: first attempt may hit 429, frontend auto-retries after 3s, second attempt succeeds (rate limit window passed) and shows products
- No more wasted cascade calls (3x API calls reduced to 1x on rate limit)
- Circuit breaker prevents other concurrent users from also hitting 429
- User never sees "No products found" for a temporarily rate-limited query -- they see a brief loading state instead
