# Dubai Product Upload System

A private, mobile-first upload flow for the Dubai onsite buyer plus an admin review queue and a separated "Articles de Dubai" section on `/hot-products`. Reuses the existing guest checkout path (no payment changes).

## 1. Database

New table `dubai_uploads` (separate from `hot_products_showcase` to avoid polluting the curated catalog while pending):

- `id`, `created_at`, `updated_at`
- `source` (default `dubai`), `category` (iphone/samsung/pixel/other_phone/laptop/accessories/other)
- `model`, `model_other_text`, `refined_title`
- `storage`, `color`, `condition`, `battery_health`, `sim_type`, `network_status`, `face_id`
- `dubai_price_aed`, `dubai_price_usd`, `final_price_usd` (nullable)
- `images text[]`, `raw_images text[]`, `video_url`
- `supplier_notes` (internal), `public_description`, `admin_notes`
- `status` (`pending_review` | `approved` | `rejected`)
- `published_showcase_id` (FK to `hot_products_showcase.id`, set when approved)
- `submitted_by_token_hash` (audit trail)

Storage bucket `dubai-uploads` (public read for approved images; private folder convention `pending/...` vs `approved/...`).

Settings: add `dubai_upload_token` and `dubai_pricing_rules` rows to `app_settings` (or equivalent existing settings table) — token stored hashed.

RLS:
- INSERT via an edge function only (no anon client insert).
- SELECT/UPDATE/DELETE limited to admins.
- Storage bucket: insert via signed edge function; read-only public for approved paths.

Add `link_source = 'dubai'` convention on the published `hot_products_showcase` rows so the frontend can split them out.

## 2. Edge functions

- `dubai-upload-submit` — validates token (compares hash), validates body (zod), uploads images to Storage, inserts `dubai_uploads` row with `status = pending_review`. Returns 200 + JSON only (mobile-safe).
- `dubai-refine-title` — calls Lovable AI Gateway (`google/gemini-3-flash-preview`) to clean a typed phone name into a professional title. Token-gated.
- `dubai-upload-approve` — admin-only (verify_jwt + `is_admin` check). Creates a `hot_products_showcase` row with `link_source='dubai'`, copies title/price/images, marks dubai_upload as `approved`, stores `published_showcase_id`.
- `dubai-upload-reject` — admin-only, marks rejected (and optionally deletes images).

## 3. Frontend pages

### `/dubai-upload` (route guarded by `?token=`)
- Mobile-first form with progressive disclosure (category → model → details → photos → price → notes → submit).
- Image picker uses `<input type="file" accept="image/*" capture="environment" multiple>` so phones open the camera.
- Client-side compress/resize before upload (canvas → JPEG ~1600px max edge ~80% quality); keep originals as `raw_images` (uploaded separately, untouched).
- "Refine title" button calls `dubai-refine-title`.
- Final-price suggestion: client calls a helper that applies pricing rules (display only).
- Token read from URL, sent in `x-dubai-token` header to all edge functions. If missing/invalid → friendly "Access denied" screen.

### `/admin/dubai-uploads`
- Pending queue with thumbnails. Edit dialog: title, final price, public description, condition, battery health, stock status, image reorder/remove.
- Buttons: Approve (publishes), Reject (deletes).
- Wire into existing AdminLayout sidebar under Catalog with admin permission check.

### `/hot-products`
- Fetch `hot_products_showcase` as today, then split:
  - Existing products (current logic, unchanged ordering)
  - Dubai products: `link_source = 'dubai'`, rendered in a separate grid under a big heading "🔥 Articles de Dubai" with a short tagline ("Livraison RDC incluse · Livraison estimée 2–4 semaines · Vérifié avant expédition").
- Dubai cards reuse the same `<Button>` calling the existing `handleBuyNow` flow (adds item + navigates to `/checkout?hp={id}`). No new checkout, no cart-required step, guest-checkout already supported by that route.
- Dubai card extras: condition badge, battery health line, "Commander / Payer sur le site" label on the main button, plus a green "Problème ? Contactez-nous sur WhatsApp" button below with prefilled product-aware message.

## 4. Reuse, NOT replace

- Checkout / Stripe / pawaPay / mobile money / totals: **untouched**.
- The Dubai card's main button uses the same `addItem` → `/checkout?hp=...` flow already used by other hot products and the link generator.
- WhatsApp is only support/contact — never an order channel.

## 5. Security

- Token compared via `crypto.subtle.digest` (SHA-256) against the hashed value in settings; constant-time compare.
- Edge functions return HTTP 200 with JSON `{ ok:false, error:'...' }` on failure (per project mobile contract).
- File type/size validation server-side: images ≤ 10 MB each, max 8; video optional ≤ 50 MB.
- Server-side title sanitization to prevent injection in product titles.

## 6. Out of scope (intentionally)

- No public navigation entry for `/dubai-upload`.
- No "Voir tous les produits" link.
- No category filter chips on `/hot-products`.
- No changes to existing hot-products data or ordering.

## Open question

I'll generate one shared static token stored hashed in app settings and ask you to set its plaintext value via the Admin → Dubai Uploads page after approval. Acceptable?
