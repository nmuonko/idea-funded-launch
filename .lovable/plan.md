

# Fix: Mobile Orders Showing $0

## Root Cause

The `mobile-get-orders` edge function is **crashing** on every request with:

```
Error: supabase.from(...).select(...).eq(...).neq(...).order(...).range is not a function
```

The custom REST client in `_shared/auth.ts` (`createQueryBuilder`) is missing two methods that `mobile-get-orders` uses:

1. **`.range(from, to)`** -- used for pagination (`line 76`)
2. **`.select('*', { count: 'exact', head: true })`** -- the count overload with options object (`line 57`)

Because the function crashes entirely, the mobile app receives an error response and displays `$0` as its fallback for all order totals.

The database has correct prices (e.g., $303.20, $416.60, $1,230.00) -- this is purely a function crash, not a data issue.

## Fix

Add `.range(from, to)` and count-aware `.select()` support to `createQueryBuilder` in `supabase/functions/_shared/auth.ts`.

### 1. Add `range()` method to `createQueryBuilder` (line ~126)

Add a `range` method that stores from/to values and translates them to the PostgREST `Range` header (`Range: from-to`) in the fetch call:

```typescript
range(from: number, to: number) {
  this._rangeFrom = from;
  this._rangeTo = to;
  return this;
}
```

In the `then()` handler, add the `Range` header when `_rangeFrom` is set:

```typescript
if (this._rangeFrom !== null) {
  finalHeaders['Range'] = `${this._rangeFrom}-${this._rangeTo}`;
  finalHeaders['Range-Unit'] = 'items';
}
```

### 2. Support `select('*', { count: 'exact', head: true })` options

Update `createRestClient.from().select()` to detect when the second argument is an options object with `count` and `head`:

- If `head: true` is set, use HTTP `HEAD` method instead of `GET`
- If `count: 'exact'` is set, add `Prefer: count=exact` header
- Parse the `content-range` response header to extract the count value (format: `*/total`)

### 3. No changes to `mobile-get-orders/index.ts`

The function code itself is correct -- it just needs the REST client to support these two methods.

## Files Changed

- **Modified**: `supabase/functions/_shared/auth.ts` -- add `range()` method and count/head support to `createQueryBuilder`

## Deployment

Redeploy `mobile-get-orders` (which uses the shared `auth.ts` module). All other mobile edge functions using the same shared module will also benefit from the fix.

## Verification

After deployment, call `mobile-get-orders` and confirm:
- Response returns `ok: true` with orders containing real `totalUsd`/`totalCdf` values
- Pagination works correctly
- `total_count` returns accurate numbers

