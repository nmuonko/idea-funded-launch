

# Weekly Hot Products Email Campaign System

## Overview
Build an admin-managed "Hot Products" email campaign system where admins select up to 3 featured products from the catalog, preview the email with product images/prices/links, approve it, and send it to all registered users.

## Database Changes

**New table: `hot_product_campaigns`**
- `id` (uuid, PK)
- `title` (text) — campaign name, e.g. "Week of March 12"
- `status` (text) — `draft` | `approved` | `sending` | `sent`
- `products` (jsonb) — array of selected products: `[{id, title, image_url, price_usd, total_price_usd, product_url, provider, provider_product_id}]`
- `approved_by` (uuid, FK to auth.users)
- `approved_at` (timestamptz)
- `sent_at` (timestamptz)
- `sent_count` (int)
- `failed_count` (int)
- `created_by` (uuid, FK to auth.users)
- `created_at` / `updated_at`
- RLS: admin-only via `has_role()`

## Frontend — Admin Page (`src/pages/admin/HotProducts.tsx`)

1. **Product Picker**: Search/browse `catalog_products` table, select up to 3 products. For each product, show image, title, base price. Admin sets the "total price" (includes shipping + markup) manually per product — since markup/shipping varies.

2. **Email Preview**: Live preview of the bilingual HTML email showing:
   - AfriShop logo at top
   - 3 product cards with images, titles, total prices in USD
   - Each product links to `https://afrishop-usa.com/product/{provider}/{provider_product_id}`
   - "Paste Any Link" section at the bottom (linking to `/paste-link`)
   - French first, English below (standard bilingual format)

3. **Approve & Send Flow**:
   - "Save Draft" saves the campaign
   - "Approve & Send" sets status to `approved`, then triggers the edge function
   - Status indicator shows sending progress

4. **Campaign History**: List of past campaigns with sent/failed counts

## Route & Navigation
- Add route `/admin/hot-products` guarded by `can_view_settings` permission
- Add nav item in admin sidebar under Marketing or similar section

## Edge Function — `send-hot-products-email`

- Accepts `{ campaignId }` in body
- Requires admin JWT or cron secret
- Reads campaign from `hot_product_campaigns`
- Builds HTML email from product data (bilingual, product cards with images + prices + links)
- Fetches all users via GoTrue admin API (same pattern as `send-bulk-announcement`)
- Sends with 600ms delay between emails (respecting Resend rate limits)
- Updates campaign status and counts as it progresses

## Email Template Design

```text
┌─────────────────────────────────┐
│         [AfriShop Logo]         │
│                                 │
│  🇫🇷 Produits Vedettes          │
│  Cette Semaine                  │
│                                 │
│  ┌───────────┐ ┌───────────┐   │
│  │ [Image 1] │ │ [Image 2] │   │
│  │ iPhone 17 │ │ Tesla Y   │   │
│  │ $1,450    │ │ $45,000   │   │
│  │ [Acheter] │ │ [Acheter] │   │
│  └───────────┘ └───────────┘   │
│       ┌───────────┐             │
│       │ [Image 3] │             │
│       │ Nike Air  │             │
│       │ $185      │             │
│       │ [Acheter] │             │
│       └───────────┘             │
│                                 │
│  🔗 Paste Any Link section      │
│  ─────────────────              │
│  🇬🇧 English version below      │
│  (same layout)                  │
│                                 │
│  ── Footer ──                   │
└─────────────────────────────────┘
```

Each product card links directly to `https://afrishop-usa.com/product/{provider}/{id}` so users land on the product detail page to purchase.

## Implementation Steps

1. Create `hot_product_campaigns` table with RLS (migration)
2. Build the admin page with product picker, price input, email preview, and send button
3. Add route in `App.tsx` and nav link in admin sidebar
4. Create `send-hot-products-email` edge function using existing `sendEmail` helper and bulk-send pattern
5. Deploy edge function

