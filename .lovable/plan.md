

# Performance Optimization Plan: Faster Search & Checkout

## Executive Summary
This plan addresses two distinct performance bottlenecks:
1. **Search (No Cache Hit)**: Still takes 500-1500ms due to sequential provider calls
2. **"Payez Maintenant" Button**: Backend API call delays navigation to payment method selection

---

## Part 1: Faster Search (When Cache Misses)

### Current Bottlenecks Identified

```text
Current Search Flow (Cache Miss):
1. Rewrite query (DB lookup) ........... ~30-50ms
2. Load catalog settings (DB) .......... ~20-50ms  
3. Amazon budget check (DB) ............ ~20-30ms
4. Amazon API/cache lookup ............. ~100-500ms
5. eBay LIVE API call .................. ~300-800ms  ← SEQUENTIAL!
6. Mix results ......................... ~5ms
7. Media enrichment .................... ~50-100ms
                                        ───────────
                                Total: ~525-1535ms
```

**Key Issue**: Steps 4 (Amazon) and 5 (eBay) run **sequentially** when they could run in parallel.

### Solution: Parallel Provider Fetching

Modify `catalog-search/index.ts` to run Amazon and eBay calls concurrently using `Promise.all`:

```text
Optimized Search Flow:
1. Rewrite query + Settings (PARALLEL) .. ~30-50ms
2. Amazon + eBay calls (PARALLEL) ....... ~300-800ms (was ~400-1300ms)
3. Mix + Filter + Enrich ................ ~55-105ms
                                         ───────────
                                   Total: ~385-955ms (30-40% faster)
```

### Technical Changes

**File: `supabase/functions/catalog-search/index.ts`**

1. **Parallelize query rewrite + settings load** (lines ~423-486):
```typescript
// BEFORE: Sequential
const searchMeta = await rewriteSearchQuery(supabase, qOriginal, {...});
const settings = await getCatalogSettings(supabase);

// AFTER: Parallel
const [searchMeta, settings] = await Promise.all([
  rewriteSearchQuery(supabase, qOriginal, {...}),
  getCatalogSettings(supabase),
]);
```

2. **Parallelize Amazon + eBay provider calls** (lines ~508-830):
```typescript
// BEFORE: Sequential
// ... Amazon fetch (lines 521-728)
// ... eBay fetch (lines 730-829) - waits for Amazon to complete!

// AFTER: Parallel with Promise.allSettled
const [amazonResult, ebayResult] = await Promise.allSettled([
  fetchAmazonItems(supabase, { query, page, limit, settings, ... }),
  fetchEbayItems(supabase, { query, page, limit, isVehicle, ... }),
]);

// Process results safely (handle individual failures)
if (amazonResult.status === 'fulfilled') {
  amazonItems = amazonResult.value.items;
  amazonHasMore = amazonResult.value.hasMore;
}
if (ebayResult.status === 'fulfilled') {
  ebayItems = ebayResult.value.items;
  ebayHasMore = ebayResult.value.hasMore;
}
```

3. **Add performance timing** for monitoring:
```typescript
const perfLog = { rewrite_ms: 0, settings_ms: 0, amazon_ms: 0, ebay_ms: 0 };
// ... track each operation
console.log(`[SEARCH_PERF] requestId=${requestId}`, perfLog);
```

### Expected Improvement

| Scenario | Before | After | Improvement |
|----------|--------|-------|-------------|
| Both providers available | ~1000ms | ~600ms | **40% faster** |
| Amazon only | ~500ms | ~450ms | 10% faster |
| eBay only | ~800ms | ~750ms | 6% faster |

---

## Part 2: Faster "Payez Maintenant" (Checkout Flow)

### Current Bottlenecks Identified

The `mobile-checkout` endpoint already has good parallel fetching (profile, order, settings, payment_settings). However, several sequential operations remain:

```text
Current Checkout Flow:
1. Auth verification ................... ~50ms
2. Parse body .......................... ~5ms
3. Parallel fetch (profile/order/settings) ~80-150ms  ✓ Already optimized
4. Fetch order items ................... ~30-50ms     ← Sequential
5. Dedupe + validate items ............. ~10-20ms
6. Recompute totals .................... ~20-30ms
7. Create checkout order ............... ~40-60ms     ← Sequential
8. Copy items to new order ............. ~40-60ms     ← Sequential
9. Create checkout session ............. ~30-50ms     ← Sequential
                                        ───────────
                                  Total: ~305-475ms
```

**Key Issue**: Steps 7, 8, 9 are sequential database writes that could be optimized.

### Solution: Optimistic UI + Backend Pipeline

#### A. Frontend: Immediate Navigation (No Backend Change)
The mobile app should navigate immediately to the payment method selection screen **before** the API call completes, then update with real data when it arrives.

```text
User taps "Payez Maintenant"
     ↓
1. IMMEDIATELY show payment selection screen with skeleton/loading state
2. Call POST /mobile-checkout in background
3. When response arrives, populate payment methods and amounts
```

This is a frontend change (React Native side) that eliminates perceived latency.

#### B. Backend: Pipeline Database Writes

**File: `supabase/functions/mobile-checkout/index.ts`**

1. **Combine order creation + item copy into single transaction** (lines ~1980-2064):
```typescript
// BEFORE: 3 separate DB operations
const { data: checkoutOrder } = await supabase.from('orders').insert({...});
await supabase.from('orders').update({ maisha_transaction_id: reference });
const { data: insertedItems } = await supabase.from('order_items').insert(copiedItems);

// AFTER: Single RPC call or batched operations
// Use a database function that handles all 3 atomically
const { data: result } = await supabase.rpc('create_checkout_order', {
  p_user_id: user.id,
  p_cart_items: copiedItems,
  p_totals: totalsBreakdown,
  p_reference: reference,
});
```

2. **Pre-compute available payment methods** in parallel with totals (already done ✓):
The `available_methods` array is already included in the checkout response, eliminating a second API call.

3. **Skip unnecessary validation for cached sessions**:
When a `checkout_session_id` is provided, the existing session reuse logic (lines ~492-700) already provides a fast path.

### Database Function (Optional Enhancement)

Create a new RPC function for atomic checkout order creation:

```sql
CREATE OR REPLACE FUNCTION create_checkout_order(
  p_user_id UUID,
  p_cart_items JSONB,
  p_totals JSONB,
  p_reference TEXT
) RETURNS JSONB AS $$
DECLARE
  v_order_id UUID;
  v_session_id UUID;
BEGIN
  -- Insert order
  INSERT INTO orders (...) VALUES (...) RETURNING id INTO v_order_id;
  
  -- Insert items in batch
  INSERT INTO order_items (...)
  SELECT ... FROM jsonb_to_recordset(p_cart_items) AS x(...);
  
  -- Create session
  INSERT INTO checkout_sessions (...) VALUES (...) RETURNING id INTO v_session_id;
  
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'session_id', v_session_id
  );
END;
$$ LANGUAGE plpgsql;
```

### Expected Improvement

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| API Response Time | ~350ms | ~250ms | **30% faster** |
| Perceived Latency (with optimistic UI) | ~350ms | ~50ms | **85% faster** |

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/catalog-search/index.ts` | Parallelize rewrite+settings, parallelize Amazon+eBay calls |
| `supabase/functions/mobile-checkout/index.ts` | Batch DB writes, add performance markers |
| (Optional) Database migration | Add `create_checkout_order` RPC function |

---

## Implementation Order

1. **Search parallelization** (biggest impact, lower risk)
   - Refactor Amazon/eBay fetching into separate async functions
   - Use `Promise.allSettled` for fault tolerance
   - Add performance logging

2. **Checkout DB batching** (medium impact)
   - Create database RPC function for atomic order creation
   - Update mobile-checkout to use RPC

3. **Frontend optimistic navigation** (requires mobile app changes)
   - This is a frontend recommendation for the React Native team

---

## Monitoring

Add structured performance logs:

```typescript
// Search
console.log('[SEARCH_PERF]', {
  requestId,
  rewrite_ms: 45,
  settings_ms: 30,
  amazon_ms: 350,
  ebay_ms: 420,
  mix_ms: 5,
  total_ms: 450, // Parallel = max(amazon, ebay) not sum
});

// Checkout
console.log('[CHECKOUT_PERF]', {
  parallel_fetch_ms: 120,
  items_fetch_ms: 40,
  totals_compute_ms: 25,
  order_create_ms: 150, // Combined with RPC
  total_ms: 335,
});
```

