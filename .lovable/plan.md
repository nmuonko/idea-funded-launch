

## Make Shipping Weight-Based and Admin-Controllable

### What exists today
- **Admin Settings** (`/admin/settings`): Markup = 20% (admin-editable, stays unchanged), Shipping = $40 flat + 10% of item total
- **Shipping Item Types** (`/admin/shipping-types`): 5 categories with estimated weights — but these weights are **decorative only**, never used in pricing
- The shipping types page is hidden behind a permission and not easy to find

### What changes

**Markup stays exactly as-is** — 20% (or whatever admin sets). No change.

**Shipping becomes weight-based per category**, fully admin-editable:

#### 1. Database: Add columns to `shipping_item_types`
- `flat_shipping_usd` (decimal, nullable) — for categories your agency charges a flat rate (phones, tablets = $50)
- `shipping_buffer_percent` (decimal, default 25) — per-category buffer you control

#### 2. Database: Add `shipping_rate_per_kg` to `settings`
- Default $20 — your agency's per-kg rate, editable in main settings

#### 3. Update the Shipping Types admin page (`/admin/shipping-types`)
Add two new columns to the table and edit form:
- **Flat Shipping ($)** — if set, overrides weight calculation (e.g., $50 for phones)
- **Buffer (%)** — per-category buffer (default 25%)

So in admin you'd see:

```text
Category              Weight   Flat Ship   Buffer   Manual Quote
─────────────────────────────────────────────────────────────────
Clothes / Shoes       0.5 kg   —           25%      No
Small electronics     0.7 kg   $50.00      25%      No
Laptop / Tablet       2.5 kg   $50.00      25%      No
Console / Medium      6.0 kg   —           30%      No
TV / Large appliance  12 kg    —           —        Yes (manual)
```

#### 4. New shipping formula (replaces $40 flat + 10%)

```text
Per item:
  If flat_shipping_usd is set:
    shipping = flat_shipping_usd × quantity
  Else:
    shipping = est_weight_kg × shipping_rate_per_kg × quantity

  Apply buffer:
    shipping = shipping × (1 + buffer_percent / 100)
```

#### 5. Price comparison ($15 t-shirt example)

| | Old (flat $40 + 10%) | New (0.5kg × $20/kg + 25% buffer) |
|---|---|---|
| Base price | $15 | $15 |
| Markup (20%) | $3 | $3 |
| Shipping | $40 + $1.50 = **$41.50** | $10 × 1.25 = **$12.50** |
| **Total** | **$59.50** | **$30.50** |

### Files to change

1. **Migration SQL** — Add `flat_shipping_usd`, `shipping_buffer_percent` to `shipping_item_types`; add `shipping_rate_per_kg` to `settings`; set flat rates for phones/tablets
2. **`src/pages/admin/ShippingTypes.tsx`** — Add flat shipping and buffer fields to table + edit dialog
3. **Admin Settings page** — Add "Shipping Rate per KG" field next to existing shipping settings; remove or relabel the old flat fee fields
4. **`supabase/functions/_shared/allInclusivePricing.ts`** — Use category weight/flat rate instead of flat fee
5. **`supabase/functions/_shared/cart/pricing.ts`** — Same logic change for cart calculations
6. **`src/lib/shippingCalculation.ts`** — Client-side equivalent
7. **`src/lib/allInclusivePrice.ts`** — Client-side equivalent
8. **`supabase/functions/public-shipping-config/index.ts`** — Expose new fields to frontend
9. **Edge functions** (`mobile-cart`, catalog endpoints) — Pass category info through pricing pipeline

### What you control as admin
- **Markup %** — unchanged, in main settings
- **Shipping rate per kg** — new field in main settings (default $20)
- **Per-category flat shipping** — in Shipping Types page (e.g., $50 for phones)
- **Per-category buffer %** — in Shipping Types page (e.g., 25% default, adjustable per category)
- **Weight per category** — already exists in Shipping Types page

Everything is admin-editable. Nothing is hardcoded.

