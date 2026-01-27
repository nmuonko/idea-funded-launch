
# Native Product Catalog + Provider Plug-ins + Staging Environment

## Executive Summary

This plan implements a native product catalog system with plug-in providers while maintaining zero impact on live production users. The architecture extends existing patterns (`mobile-public-config`, `app-bootstrap`) with new catalog capabilities controlled by feature flags and environment routing.

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         MOBILE APP                                   │
│  ┌─────────────────┐    ┌─────────────────┐                         │
│  │ catalogMode:    │    │ catalogMode:    │                         │
│  │ "webview"       │    │ "native"        │                         │
│  │ (current flow)  │    │ (new native UI) │                         │
│  └────────┬────────┘    └────────┬────────┘                         │
│           │                      │                                   │
└───────────┼──────────────────────┼──────────────────────────────────┘
            │                      │
            ▼                      ▼
┌───────────────────┐    ┌───────────────────────────────────────────┐
│  PRODUCTION       │    │  STAGING BACKEND                          │
│  (existing)       │    │  ┌─────────────────────────────────────┐  │
│                   │    │  │  /catalog/home                      │  │
│  WebView scraping │    │  │  /catalog/search                    │  │
│  get-product-info │    │  │  /catalog/category/:id              │  │
│  mobile-get-cart  │    │  │  /catalog/product/:id               │  │
│                   │    │  │                                     │  │
└───────────────────┘    │  │  ┌──────────────────────────────┐   │  │
                         │  │  │  PROVIDER AGGREGATOR          │   │  │
                         │  │  │  ┌─────────┐ ┌─────────┐     │   │  │
                         │  │  │  │ Amazon  │ │ Walmart │ ... │   │  │
                         │  │  │  │ Adapter │ │ Adapter │     │   │  │
                         │  │  │  └────┬────┘ └────┬────┘     │   │  │
                         │  │  └───────┼───────────┼──────────┘   │  │
                         │  │          ▼           ▼              │  │
                         │  │    ┌─────────────────────┐          │  │
                         │  │    │  catalog_products   │          │  │
                         │  │    │  (cache table)      │          │  │
                         │  │    └─────────────────────┘          │  │
                         │  └─────────────────────────────────────┘  │
                         └───────────────────────────────────────────┘
```

---

## Deliverable A: Environment Separation Strategy

### Recommended Approach: Single Supabase Project with Environment Flags

Given Lovable Cloud limitations, I recommend using the **same Supabase project** with environment-based routing rather than a separate project. This is safer and more maintainable.

### Implementation

#### 1. New `environments` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | "production" or "staging" |
| `is_default` | boolean | Default environment for requests |
| `catalog_enabled` | boolean | Whether native catalog is enabled |
| `catalog_mode` | text | "webview", "native", "hybrid" |
| `api_base_url` | text | Base URL for catalog APIs |
| `provider_secrets_prefix` | text | Prefix for staging secrets (e.g., "STAGING_") |
| `min_app_version` | text | Minimum supported app version |
| `ota_channel` | text | "production" or "staging" |
| `created_at` | timestamptz | Creation timestamp |

#### 2. Environment Detection in Edge Functions

Edge functions will detect environment from:
1. **Header**: `X-Afrishop-Environment: staging` (sent by mobile app)
2. **Query param**: `?env=staging` (for testing)
3. **Default**: production

```typescript
function getEnvironment(req: Request): "production" | "staging" {
  const header = req.headers.get('X-Afrishop-Environment');
  if (header === 'staging') return 'staging';
  
  const url = new URL(req.url);
  if (url.searchParams.get('env') === 'staging') return 'staging';
  
  return 'production';
}
```

#### 3. Storage Bucket Separation

- **Existing**: `bank_transfer_proofs`, `payment-proofs`
- **New**: `catalog-images-staging` (for testing)
- **Production**: Share existing buckets when ready

---

## Deliverable B: Extended `/mobile-public-config` Response

### Updated Response Interface

```typescript
interface PublicConfigResponse {
  // Existing fields (unchanged)
  success: boolean;
  configValid: boolean;
  exchangeRate: number;
  markup: { type: "percent" | "fixed"; value: number; vehicleValue?: number };
  shipping: { mode: "flat" | "percent" | "combined"; flatUsd: number; percentValue: number };
  serviceFee: { percent: number; minUsd: number };
  limits: { maishapayMaxUsd: number; maishapayMaxCdf: number };
  currency: string;
  updated_at: string;
  version: number;
  
  // NEW: Catalog configuration
  catalog: {
    enabled: boolean;              // Feature flag for catalog
    mode: "webview" | "native" | "hybrid";
    apiBaseUrl: string;            // Base URL for catalog endpoints
    providers: string[];           // List of enabled providers
    refreshIntervalMs: number;     // How often to refresh home feed
  };
  
  // NEW: Environment info
  env: {
    name: "production" | "staging";
    minSupportedAppVersion: string;
    ota: {
      enabled: boolean;
      channel: "production" | "staging";
    };
  };
}
```

### Environment-Specific Responses

| Field | Production | Staging |
|-------|------------|---------|
| `catalog.enabled` | `false` | `true` |
| `catalog.mode` | `"webview"` | `"native"` |
| `catalog.apiBaseUrl` | (empty) | `https://...supabase.co/functions/v1` |
| `env.name` | `"production"` | `"staging"` |
| `env.ota.channel` | `"production"` | `"staging"` |

---

## Deliverable C: Provider Plug-in Architecture

### Database Schema

#### 1. `catalog_providers` Table

```sql
CREATE TABLE IF NOT EXISTS public.catalog_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,          -- "amazon", "walmart", "bestbuy"
  display_name TEXT NOT NULL,         -- "Amazon", "Walmart", "Best Buy"
  enabled BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 50,         -- Higher = shown first
  config JSONB DEFAULT '{}',          -- API keys, region, affiliate IDs
  rate_limit_per_minute INTEGER DEFAULT 60,
  environment TEXT DEFAULT 'all',     -- 'production', 'staging', 'all'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 2. `catalog_products` Table (Normalized Cache)

```sql
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES catalog_providers(id) ON DELETE CASCADE,
  provider_product_id TEXT NOT NULL,   -- External product ID
  title TEXT,
  brand TEXT,
  description TEXT,                    -- Short description
  image_url TEXT,
  product_url TEXT,
  price_usd NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  in_stock BOOLEAN DEFAULT true,
  category_path TEXT[],                -- ["Electronics", "Phones", "Smartphones"]
  rating NUMERIC(3,2),
  review_count INTEGER,
  raw JSONB,                           -- Full provider response
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '4 hours'),
  UNIQUE(provider_id, provider_product_id)
);
```

#### 3. `catalog_categories` Table

```sql
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES catalog_providers(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES catalog_categories(id),
  icon_url TEXT,
  priority INTEGER DEFAULT 50,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Edge Functions

#### 1. `catalog-home` - Featured content for home screen

**Path**: `GET /catalog/home`  
**Auth**: Public (no JWT required)  
**Environment-aware**: Yes

```typescript
// Returns featured categories, trending products, deals
{
  success: true,
  featured: [
    { type: "category", id: "...", name: "Electronics", imageUrl: "...", productCount: 150 },
    { type: "deal", title: "Flash Sale", products: [...] }
  ],
  trending: [
    { id: "...", title: "iPhone 15", priceUsd: 999, imageUrl: "..." }
  ],
  categories: [
    { id: "...", name: "Electronics", icon: "📱", children: [...] }
  ]
}
```

#### 2. `catalog-search` - Aggregated search across providers

**Path**: `GET /catalog/search?q=...&page=...&provider=...`  
**Auth**: Public  
**Environment-aware**: Yes

```typescript
// Aggregates results from all enabled providers
{
  success: true,
  query: "iphone 15",
  page: 1,
  pageSize: 20,
  totalResults: 150,
  products: [
    {
      id: "uuid",
      providerId: "amazon",
      providerProductId: "B0...",
      title: "Apple iPhone 15 Pro",
      priceUsd: 999.00,
      imageUrl: "https://...",
      productUrl: "https://amazon.com/...",
      inStock: true,
      rating: 4.5
    }
  ],
  filters: {
    priceRange: { min: 100, max: 2000 },
    providers: ["amazon", "walmart"],
    categories: ["Electronics > Phones"]
  }
}
```

#### 3. `catalog-product` - Single product detail

**Path**: `GET /catalog/product/:id`  
**Auth**: Public  
**Environment-aware**: Yes

```typescript
{
  success: true,
  product: {
    id: "uuid",
    title: "Apple iPhone 15 Pro",
    brand: "Apple",
    description: "...",
    priceUsd: 999.00,
    imageUrl: "https://...",
    images: ["url1", "url2"],
    productUrl: "https://amazon.com/...",
    inStock: true,
    rating: 4.5,
    reviewCount: 1250,
    specifications: { ... },
    categoryPath: ["Electronics", "Phones", "Smartphones"]
  },
  // Optional: estimate pricing (mobile shows this)
  estimates: {
    priceUsd: 999.00,
    // NOT included by default - mobile calculates from public-config
  }
}
```

#### 4. `catalog-refresh` - Admin-only cache refresh

**Path**: `POST /catalog/refresh`  
**Auth**: Admin JWT required  
**Purpose**: Force refresh of product cache from providers

### Provider Adapter Interface

Create a shared module `supabase/functions/_shared/catalogProviders.ts`:

```typescript
interface CatalogProduct {
  providerProductId: string;
  title: string;
  brand?: string;
  description?: string;
  imageUrl?: string;
  productUrl: string;
  priceUsd: number;
  currency: string;
  inStock: boolean;
  categoryPath?: string[];
  rating?: number;
  reviewCount?: number;
  raw: Record<string, unknown>;
}

interface ProviderAdapter {
  name: string;
  search(query: string, page: number, filters?: SearchFilters): Promise<CatalogProduct[]>;
  getProduct(externalId: string): Promise<CatalogProduct | null>;
  getCategories(): Promise<Category[]>;
}
```

### Provider Priority & Aggregation

The aggregator respects provider priority from `catalog_providers.priority`:

1. Query all enabled providers in parallel
2. Merge results, de-duplicate by title similarity
3. Sort by provider priority, then by relevance score
4. Return normalized payload

---

## Deliverable D: Pricing Consistency

### Catalog Endpoints Return Raw Prices Only

```typescript
// catalog-search and catalog-product responses:
{
  priceUsd: 999.00,     // Raw price from provider
  // NO markup, NO shipping - mobile calculates using public-config
}
```

### Optional: Estimated Totals Flag

If requested via query param `?includeEstimates=true`:

```typescript
{
  priceUsd: 999.00,
  estimates: {
    markupEstimateUsd: 299.70,     // 30% of 999
    shippingEstimateUsd: 139.90,   // $40 + 10% of 999
    totalEstimateUsd: 1438.60
  }
}
```

**Default**: No estimates in response. Mobile uses `mobile-public-config` values for local calculation.

---

## Deliverable E: Safety & Observability

### Logging Standards

All catalog functions include structured logging:

```typescript
console.log('[CATALOG_DEBUG]', JSON.stringify({
  env: 'staging',
  fn: 'catalog-search',
  query: 'iphone',
  providersEnabled: ['amazon', 'walmart'],
  cacheHit: true,
  resultCount: 25,
  durationMs: 120
}));
```

### Production Protection

| Check | Implementation |
|-------|---------------|
| Catalog disabled by default | `environments.catalog_enabled = false` for production |
| Mode locked to webview | `environments.catalog_mode = 'webview'` for production |
| Admin-only toggle | `catalog-admin-toggle` edge function with admin JWT |
| Provider secrets isolated | Staging uses `STAGING_*` prefixed secrets |

### Feature Flag Rollout Path

1. **Phase 1**: Staging only (`catalog_enabled: false` in prod)
2. **Phase 2**: Hybrid mode in prod (webview + native preview)
3. **Phase 3**: Full native in prod (after provider validation)

---

## File Changes Summary

### New Database Migrations

| Table | Purpose |
|-------|---------|
| `environments` | Environment configuration & feature flags |
| `catalog_providers` | Provider registration & config |
| `catalog_products` | Normalized product cache |
| `catalog_categories` | Category tree per provider |

### New Edge Functions

| Function | Path | Auth | Purpose |
|----------|------|------|---------|
| `catalog-home` | `GET /catalog/home` | Public | Home screen content |
| `catalog-search` | `GET /catalog/search` | Public | Aggregated search |
| `catalog-product` | `GET /catalog/product/:id` | Public | Product detail |
| `catalog-category` | `GET /catalog/category/:id` | Public | Category products |
| `catalog-refresh` | `POST /catalog/refresh` | Admin | Force cache refresh |

### Modified Edge Functions

| Function | Changes |
|----------|---------|
| `mobile-public-config` | Add `catalog.*` and `env.*` fields |
| `app-bootstrap` | Add environment detection, catalog status |

### New Shared Modules

| Module | Purpose |
|--------|---------|
| `_shared/catalogProviders.ts` | Provider adapter interface |
| `_shared/catalogAggregator.ts` | Multi-provider query aggregation |
| `_shared/environmentResolver.ts` | Environment detection logic |

---

## Implementation Order

1. **Database migrations** (environments, catalog_providers, catalog_products, catalog_categories)
2. **Shared modules** (environmentResolver, catalogProviders interface)
3. **Update mobile-public-config** (add catalog.*, env.* sections)
4. **catalog-home** (basic implementation with mock data)
5. **catalog-search** (aggregator + caching)
6. **catalog-product** (single product detail)
7. **First provider adapter** (Amazon or similar with existing credentials)
8. **Testing & validation** on staging
9. **Documentation update** (MOBILE_APP_INTEGRATION.md)

---

## Acceptance Criteria

- [ ] Production users continue using current WebView flow (no changes)
- [ ] Staging returns `catalogMode: "native"` from `/mobile-public-config`
- [ ] `/catalog/search?q=iphone&env=staging` returns real products from at least 1 provider
- [ ] Adding new provider row + enabling it results in new items appearing without app update
- [ ] Prices returned in USD, no markup/shipping pre-applied
- [ ] Logs include `[CATALOG_DEBUG]` with env, providers_enabled, cache_hit

---

## Technical Notes

### Secrets Management

For staging provider keys, use secret naming convention:
- **Production**: `AMAZON_API_KEY`
- **Staging**: `STAGING_AMAZON_API_KEY`

Edge functions resolve secrets based on environment:
```typescript
const apiKey = Deno.env.get(
  env === 'staging' ? 'STAGING_AMAZON_API_KEY' : 'AMAZON_API_KEY'
);
```

### Rate Limiting

Each provider has `rate_limit_per_minute` in `catalog_providers`. The aggregator respects these limits using the existing `rateLimiter.ts` shared module.

### Cache Strategy

1. Check `catalog_products` cache first (4-hour TTL)
2. If stale/missing, query provider API
3. Save normalized result to cache
4. Return immediately from cache for fast UX

