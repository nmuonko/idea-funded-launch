

# Fix: Cart Item Duplication (Root Cause Confirmed)

## Root Cause

The `canonicalItemKey` function joins `provider` with the normalized URL. But:

- Local optimistic items get `provider = "amazon"` (lowercase, from the catalog/frontend)
- Server items get `provider = "AMAZON"` (uppercase, from `detectStore()` in the edge function)

This means the canonical keys never match:
- Local: `amazon|www.amazon.com/dp/B0CQRG5LP6`  
- Server: `AMAZON|www.amazon.com/dp/B0CQRG5LP6`

So the `syncCart` merge logic keeps BOTH the server item AND the local optimistic item, causing the duplicate.

## Fix

In `src/contexts/ShopCartContext.tsx`, normalize the provider to lowercase in `canonicalItemKey`:

```typescript
const canonicalItemKey = (item: CartItem) => {
  const urlOrId = item.productUrl || (item as any).product_url || (item as any).canonical_url || item.productId || 'unknown';
  const normalized = urlOrId.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const provider = (item.provider || 'unknown').toLowerCase();
  return [provider, normalized].join('|');
};
```

One line change: `item.provider || 'unknown'` becomes `(item.provider || 'unknown').toLowerCase()`.

## Files Changed

| File | Change |
|------|--------|
| `src/contexts/ShopCartContext.tsx` | Add `.toLowerCase()` to provider in `canonicalItemKey` (line 318) |

## Why This Is the Permanent Fix

This is the ONLY place where local and server items are compared for deduplication. Once the keys match correctly, the existing merge logic (`serverKeys.has(canonicalItemKey(it))`) will correctly identify the local item as a duplicate of the server item and drop it. No other changes needed.

