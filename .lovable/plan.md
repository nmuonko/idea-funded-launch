

# SHEIN Catalog Scraper via Firecrawl

## Overview
Create a new edge function `catalog-shein-scraper` modeled after the existing `catalog-car-scraper`, using Firecrawl's Search API to discover and cache SHEIN clothing products into `catalog_items`. Duplicates are prevented via the existing `(provider, provider_product_id)` unique constraint.

## Architecture

The scraper will use the same three-stage Firecrawl pipeline proven with CarGurus/Carvana:
- **Stage 0 (Primary)**: Firecrawl Search API (`/v1/search`) with `site:shein.com` queries
- **Stage A (Fallback)**: Firecrawl markdown scrape of SHEIN category pages
- **Stage B (Last Resort)**: Firecrawl structured extraction

## What Gets Built

### 1. New Edge Function: `supabase/functions/catalog-shein-scraper/index.ts`

- **Provider name**: `shein` (stored in `catalog_items.provider`)
- **Duplicate prevention**: Upsert with `onConflict: "provider,provider_product_id"` -- same as car scraper. Only unique items are inserted; existing ones update `last_seen_at`
- **Product ID extraction**: Parse SHEIN URLs for product IDs (pattern: `/product-pXXXXXXX` where the `p` prefix + digits is the SKU)
- **Category mapping**: `unified_category = "clothing_shoes_accessories"`, `category_key = "clothing_shoes"`
- **Search queries**: Rotate through seed queries like "women dresses site:shein.com", "men shirts site:shein.com", "modest fashion site:shein.com", "maxi dress site:shein.com", "abaya site:shein.com" etc. (aligned with existing clothing curation preferences for modest/long-form apparel)
- **Quality filters**:
  - Must have valid SHEIN product URL (`shein.com` domain with product path)
  - Must have title and price > 0
  - Skip sold/unavailable items
  - Apply existing clothing ingestion guardrails (no appliances, toys, electronics)
- **Auth**: Same `x-cron-secret` / admin JWT pattern as car scraper
- **Batched upsert**: 50 items per batch, same as car scraper
- **Configurable**: `max_pages`, `target_items` (default 20), `search_query`, `dry_run`

### 2. Register in `supabase/config.toml`

Add entry:
```
[functions.catalog-shein-scraper]
verify_jwt = false
```

### 3. Wire into Admin Panel

Add a "Run SHEIN Scraper" action in `admin-catalog-items` (same pattern as `run-car-scraper`) so admins can trigger it manually from the Catalog Cache page.

### 4. Automated Scheduling (Optional / Phase 2)

Add a `pg_cron` job to run the SHEIN scraper periodically (e.g., every 6 hours) to keep the clothing catalog fresh.

## Duplicate Prevention (Zero Duplicates Guaranteed)

The system uses three layers:
1. **In-memory dedup**: `Set` of `provider_product_id` values within a single scrape run
2. **DB-level unique constraint**: `(provider, provider_product_id)` on `catalog_items` -- upsert updates existing rows instead of creating duplicates
3. **Product ID normalization**: Consistent extraction of SHEIN's `pXXXXXXX` SKU from URLs ensures the same product always maps to the same ID

## Technical Details

- Firecrawl API key is already configured (`FIRECRAWL_API_KEY` secret exists and is used by other functions)
- Image URLs from SHEIN use `img.ltwebstatic.com` -- no upgrade needed, they're already high-res
- Price parsing reuses the existing `parseUsd` pattern (strip currency symbols, commas)
- Function timeout budget: 50s (same as car scraper)

## Files Changed
1. **New**: `supabase/functions/catalog-shein-scraper/index.ts` -- main scraper function
2. **Edit**: `supabase/config.toml` -- register new function
3. **Edit**: `supabase/functions/admin-catalog-items/index.ts` -- add `run-shein-scraper` action

