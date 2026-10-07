# AI Clothing Importer + VIP Storefront

Build an automated bulk clothing import, AI pricing, and publishing system with a dedicated public storefront at `/vip`, per the two uploaded specs.

## Database (new tables, all with RLS + GRANTs)

- `vip_categories` — name, name_fr, default_weight_kg, shipping_rate_per_kg, active flag. Seeded with the spec's pricing table (Pants 1kg/$30, Shirt 0.5/$30, Polo 0.5/$30, Jeans 2/$35, Suits 3/$40, Wedding Dress 10/$105, Formal Dress 3/$40, Italian Shoes = no rate → cannot publish until set).
- `vip_settings` — singleton row: shipping_buffer_percent (default 10), profit_markup_percent (default 30), rounding rule. Super-admin editable only.
- `vip_batches` — one row per upload batch: admin, category, shared purchase price, weight, rate, colors, sizes, status, timestamps.
- `vip_products` — per image: batch_id, category_id, AI French name + description, image_url, full price breakdown (purchase_price, weight, rate, shipping_cost, buffer, profit, final_price, percentages applied — for audit), status (`draft` / `available` / `unavailable` / `hidden`), admin-confirmed colors/sizes, AI-suggested attributes kept separate, published_at.
- `vip_product_variants` — size/color combinations with per-variant `available` flag, so one combo can be out of stock while another is purchasable.
- Public read access only to `available`/`unavailable` published products and active categories; all writes admin-only; settings super-admin only.

## Edge functions (server-side, all prices calculated here)

- `vip-ai-process` — for each uploaded image: AI vision identifies the item, generates a professional French name + unique French description, suggests colors, OCRs visible text. Flags images that don't match the batch category for review. Detects unknown categories (returns a suggestion; never auto-creates). Computes final price server-side with decimal-safe math:
  `final = purchase_price + (weight × rate) + 10% of shipping + 30% of purchase_price`, rounded to 2 dp, using the *current* settings percentages, stored with the product.
- `vip-publish` — publish/unpublish/delete/status changes (single, bulk, whole batch), with server-side validation: no publishing without category, rate, and final price. Settings changes never retroactively change published prices.
- Availability enforced server-side at order time: the VIP order path rejects unavailable products/variants.

## Admin UI

- **Operations → AI Clothing Importer** (`/admin/vip-importer`) — ChatGPT-style workspace, 6 steps: upload images → AI category recognition (with "Create New Category / Choose Existing / Skip" prompt when AI finds an unknown category — inline form: name, weight, rate/kg, status; duplicate-name check) → shared batch details (purchase price, category, weight, rate, colors, sizes, default availability) → AI processing with per-image progress + retry → review table (thumbnails, names, descriptions, full admin-only cost breakdown, inline editing, per-item overrides of price/category/weight/colors/sizes, regenerate description) → publish all or selected.
- **VIP Products** (`/admin/vip-products`) — searchable/filterable table (category, status, price, date, batch) with image, full cost/profit breakdown, status, publish date, batch; stats cards (total, published, drafts, batches, est. profit/item, total est. inventory profit — clearly labeled as estimated, not realized); bulk status changes, mark sold out, replace image, edit price/description.
- **VIP Pricing Settings** (`/admin/vip-pricing`) — edit buffer %, markup %, per-category weights/rates/names, activate/deactivate categories, add categories.
- Color manager: searchable multi-select with the spec's bilingual preset list + custom colors; batch apply + per-product override. Size manager: presets for adult (XS–5XL), baby (Newborn–24m), kids (2T–16), shoes (US/UK/EU with system selector) + custom sizes; per-size availability.

## Public storefront

- `/vip` — premium mobile-first storefront in existing AfriShop branding: product grid with real uploaded photos, French names/descriptions, final USD price only (never purchase price, shipping, buffer, or profit), category filters, search, sorting, stock status ("Disponible" / "Rupture de stock").
- `/vip/:id` — product detail: image viewer, color/size selection (unavailable variants disabled), "Acheter maintenant".
- Purchase reuses the existing cart/order/checkout architecture at the locked final price. **No changes to Stripe, Mobile Money, webhooks, price-locking, or checkout calculation logic.** If wiring the buy button requires touching protected checkout code, I will stop and ask first.
- `/vip` is standalone — not added to main navigation, homepage, or mobile feeds. Draft/hidden products never appear publicly.

## Restrictions honored

No changes to existing payment flows, live orders, published products, homepage categories, mobile feeds, or non-VIP import mechanisms. Existing Telegram/Turkey importer untouched.

## Verification

- Unit-test the pricing formula against the spec example (Polo: $12 + $15 + $1.50 + $3.60 = $32.10).
- End-to-end: create batch → AI process → review → publish → visible on `/vip` → unavailable variant cannot be purchased.
- Confirm non-admins cannot reach admin pages or call VIP mutations.
