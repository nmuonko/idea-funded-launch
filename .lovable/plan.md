
# Diagnostic Headers — IMPLEMENTED

All `catalog-product` responses now include:
- `X-Variants-Cache: HIT | MISS | SKIP`
- `X-Provider: amazon | ebay`
- `X-Upstream-Ms: <number>`
- `X-Total-Ms: <number>`
- `X-Source: db | db+variants_cache | db-legacy | live-rainforest | live-ebay`

CORS `Access-Control-Expose-Headers` updated so frontend DevTools can read them.
