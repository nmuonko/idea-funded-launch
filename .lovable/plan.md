

# Create Debug Search Endpoint for Provider Transparency

## Problem
You want to see exactly what eBay and Amazon return for a search query, without mixing or filtering, to verify the backend is getting the right data.

## Solution
Create a new `catalog-debug-search` edge function that:
1. Calls both eBay and Amazon APIs in parallel
2. Returns RAW results from each provider separately
3. Shows counts, titles, prices without any mixing or filtering

---

## Technical Implementation

### File: `supabase/functions/catalog-debug-search/index.ts`

```typescript
// Simple debug endpoint to show raw provider results
// GET /catalog-debug-search?q=infiniti+qx80

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 20);

  // Parallel fetch from both providers
  const [ebayResult, amazonResult] = await Promise.allSettled([
    searchEbay(query, limit),   // Returns raw eBay items
    searchAmazon(query, limit)  // Returns raw Amazon items
  ]);

  return {
    query,
    ebay: {
      status: ebayResult.status,
      count: ebayResult.value?.items?.length || 0,
      items: ebayResult.value?.items?.map(i => ({
        title: i.title,
        price: i.price_usd,
        provider: "ebay",
        url: i.product_url
      })) || [],
      rawTotal: ebayResult.value?.total || 0
    },
    amazon: {
      status: amazonResult.status,
      count: amazonResult.value?.items?.length || 0,
      items: amazonResult.value?.items?.map(i => ({
        title: i.title,
        price: i.price_usd,
        provider: "amazon",
        url: i.product_url
      })) || [],
      rawTotal: amazonResult.value?.total || 0
    }
  };
});
```

---

## Expected Response Format

```json
{
  "query": "infiniti qx80",
  "ebay": {
    "status": "fulfilled",
    "count": 28,
    "rawTotal": 59505,
    "items": [
      { "title": "2024 Infiniti QX80 Luxe 4WD", "price": 72500, "provider": "ebay" },
      { "title": "Infiniti QX80 Floor Mat Set", "price": 89.99, "provider": "ebay" }
    ]
  },
  "amazon": {
    "status": "fulfilled", 
    "count": 36,
    "rawTotal": 10000,
    "items": [
      { "title": "Infiniti QX80 Key Fob Cover", "price": 12.99, "provider": "amazon" },
      { "title": "Custom Floor Mats for QX80", "price": 149.00, "provider": "amazon" }
    ]
  }
}
```

---

## Files to Create

| File | Description |
|------|-------------|
| `supabase/functions/catalog-debug-search/index.ts` | New debug endpoint showing raw provider results |

---

## Usage

```
GET /catalog-debug-search?q=infiniti+qx80&limit=10
```

This gives you complete transparency into what each provider returns, without any mixing, filtering, or blocking applied.

