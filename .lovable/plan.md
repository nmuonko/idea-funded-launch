
# Product Gallery Fix — Summary

## Changes Made

### 1. Interface Fix (TypeScript compilation)
Added `categoryKey` and `vehiclesSubkey` to the `CatalogItem` interface — these were missing and causing a compile error.

### 2. Media Table Integration
Added parallel query to `catalog_item_media` table when fetching product details. eBay items with full galleries stored there now merge into the response.

### 3. DB-First Return (stability fix)
The function now always returns the DB item immediately when found, instead of falling through to a live Rainforest fetch that currently fails (402 — API payment expired).

## Root Cause of Single Images
- **Amazon items**: Only 1 image stored in `catalog_items.images`. The Rainforest API (which would fetch full galleries live) is currently returning HTTP 402 (payment required).
- **eBay items**: Many have full galleries (9+ images) already stored in `catalog_items.images` — these now display correctly.

## Next Steps
- Renew the Rainforest API subscription to restore live Amazon product detail fetches with full galleries.
- Consider a batch job to populate `catalog_items.images` for Amazon products using `catalog_item_media` data.
