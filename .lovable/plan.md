
# Fix: Deploy catalog-product Edge Function

## Root Cause

The `catalog-product` edge function returns **404 "Requested function was not found"** because:

1. **Bundler timeout during deployment** - The function imports `@supabase/supabase-js` SDK directly (line 15) which is a heavy dependency that can cause the bundler to time out
2. **No logs exist** for this function, confirming it was never successfully deployed

The function code exists in `supabase/functions/catalog-product/index.ts` (572 lines) and is registered in `config.toml`, but failed to deploy.

---

## Solution

### 1. Replace Heavy SDK Import with Lightweight REST Client

**Current (causes bundler timeout):**
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
```

**Fixed (SDK-free approach):**
```typescript
import { createAdminPostgrestClient, PostgrestClient } from "../_shared/postgrest.ts";
```

Then update all `supabase.from()` calls to use the lightweight PostgREST client pattern.

### 2. Add POST Method Support

The current implementation only supports GET. Add POST method handling to match `product-resolver`:

```typescript
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID();
  const startTime = Date.now();
  
  let provider: string | null = null;
  let productId: string | null = null;
  
  if (req.method === "POST") {
    try {
      const body = await req.json();
      provider = body.provider;
      productId = body.id;
    } catch {
      // Fall through to GET params
    }
  }
  
  const url = new URL(req.url);
  // Parse from query params if not in body
  if (!productId) {
    const { provider: parsedProvider, productId: parsedId } = parseProductId(url);
    provider = parsedProvider;
    productId = parsedId;
  }
  
  console.log(`[CATALOG_PRODUCT] start correlationId=${correlationId} provider=${provider} idRaw=${productId}`);
  // ... rest of logic
});
```

### 3. Add Structured Correlation ID Logging

Add consistent logging pattern:
- `[CATALOG_PRODUCT] start correlationId=... provider=... idRaw=... idDecoded=...`
- `[CATALOG_PRODUCT] success correlationId=... ms=...`
- `[CATALOG_PRODUCT][ERROR] correlationId=... status=... error=... stack=...`

### 4. Deploy Both Functions

Deploy:
- `catalog-product` - Main product details endpoint
- `health` - Health check endpoint (also returning 404)

---

## Files to Modify

### `supabase/functions/catalog-product/index.ts`

Key changes:
- Replace `@supabase/supabase-js` import with lightweight `_shared/postgrest.ts`
- Add POST method support alongside GET
- Add correlationId logging throughout
- Ensure URL-encoded IDs are properly decoded (`v1%7C` becomes `v1|`)

### Database Calls Refactoring

**Before (SDK):**
```typescript
const supabase = createClient(supabaseUrl, supabaseKey);
const { data: dbItem } = await supabase
  .from("catalog_items")
  .select("*")
  .eq("id", fullProductId)
  .maybeSingle();
```

**After (SDK-free):**
```typescript
const db = createAdminPostgrestClient();
const { data: dbItem, error } = await db
  .from("catalog_items")
  .select("*")
  .eq("id", fullProductId)
  .single();
```

---

## Expected Results After Implementation

- `/functions/v1/catalog-product` returns **200 JSON** with CORS headers
- Clicking any product on homepage **opens product detail page successfully**
- eBay IDs like `v1|127568923109|428695839251` (and URL-encoded `v1%7C127568923109%7C428695839251`) work correctly
- Structured logging with correlationId for debugging
- No bundler timeout during deployment
- Both GET and POST methods supported
