
Goal: fix the still-broken Amazon links in the Admin Orders surfaces by correcting the actual rendered URL strategy, not just preserving ASINs.

What I found
- All 3 admin surfaces already use the same helper: `src/lib/orderProductLinks.ts`
  - Orders list: `src/pages/admin/Orders.tsx`
  - Order drawer: `src/components/admin/OrderDetailsDrawer.tsx`
  - Order detail page: `src/pages/admin/OrderDetail.tsx`
- Current helper behavior:
  - Uses slugged `product_url` if it already looks like an Amazon detail page.
  - Otherwise falls back to `canonical_url`.
  - If neither is a detail URL, it rebuilds `https://{host}/dp/{ASIN}`.
- Database evidence from current Amazon order items:
  - 41 Amazon order items total
  - 41/41 have a bare `/dp/{ASIN}` `canonical_url`
  - 26/41 still have slugged `product_url`
  - 15/41 do not have slugged URLs available anymore, so the admin UI must currently fall back to bare `/dp/{ASIN}`
- This strongly suggests the remaining bug is on the fallback path: bare `/dp/{ASIN}` links are still being rendered for many historical rows, and those are the links you are clicking.

Exact root cause to fix
- The app is still rendering `canonical_url` values in bare Amazon `/dp/{ASIN}` form for a large subset of existing orders.
- Even though those URLs are product-specific in theory, your real-world report says they are not landing on the product page in practice.
- Because all 3 admin surfaces share the same helper, the bug is centralized and can be fixed in one place plus one data-repair pass.

Implementation plan
1. Harden Amazon URL reconstruction in `src/lib/orderProductLinks.ts`
- Replace the current simple fallback strategy with a stricter resolver:
  - Prefer valid slugged `product_url`
  - Else prefer valid slugged `canonical_url`
  - Else build a more stable admin-safe Amazon URL from:
    - marketplace host
    - title slug
    - ASIN
  - If title is present, generate:
    - `https://{host}/{slug}/dp/{ASIN}`
  - If title is absent, only then fall back to bare `/dp/{ASIN}`
- Add stronger validation so homepage/search/cart URLs are never returned.

2. Add explicit admin diagnostics
- Add a small helper output path or temporary console logging in admin render surfaces showing:
  - chosen source field (`product_url`, `canonical_url`, rebuilt-slugged, rebuilt-dp`)
  - parsed ASIN
  - final href
- This will make it easy to verify which records are still using rebuilt links.

3. Repair existing historical Amazon order items
- Add a migration/backfill to update existing Amazon `canonical_url` values where possible:
  - if `product_url` is a valid slugged detail URL, copy that into `canonical_url`
  - else if ASIN + title exist, generate slugged canonical URL from title + ASIN
  - preserve correct Amazon marketplace host when available
- This reduces dependence on runtime reconstruction and makes admin data durable.

4. Keep future orders safe
- Audit the order creation path(s) that currently populate `canonical_url` and change Amazon canonical generation from bare `/dp/{ASIN}` to slugged detail URL when title exists.
- Preserve ASIN and host as today, but generate a better stored canonical link up front.

5. Verify all 3 admin surfaces
- Re-check the 3 shared render points:
  - Orders list item links
  - OrderDetailsDrawer link
  - OrderDetail “View Product” link
- Confirm they all continue to call the same centralized helper so the fix applies everywhere consistently.

Proof I would provide after implementation
- Files changed, including:
  - `src/lib/orderProductLinks.ts`
  - admin render files if diagnostics/UI tweaks are needed
  - migration/backfill file for existing order items
  - any order-creation function that writes `canonical_url`
- Exact final code for:
  - ASIN extraction
  - Amazon URL validation
  - slug generation from title
  - final admin href resolution
  - historical backfill SQL
- Runtime evidence:
  - sample affected rows before/after
  - final rendered href for current admin rows
  - which rows were upgraded from bare `/dp/` to slugged detail URLs
- Clear separation of:
  - render-time fallback fix
  - durable data repair for existing orders
  - future-order canonical URL fix

Why this plan matches your report
- Your complaint is specifically about current Amazon links under Orders still not landing on the product page.
- The codebase shows one shared link helper, and the database shows many current orders still depend on bare `/dp/{ASIN}` canonical URLs.
- So the remaining work is not “add more identity fields”; it is:
  - stop rendering brittle Amazon fallback URLs,
  - backfill better canonical links for existing records,
  - and store the better link format for future orders.
