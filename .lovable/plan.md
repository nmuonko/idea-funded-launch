

## Plan: WhatsApp Product Sharing with Images

### The Problem
WhatsApp `wa.me/?text=...` links only support plain text — you can't attach images directly. So just pasting an image URL in the message won't show the photo inline.

### The Solution: Shareable Product Pages with Open Graph

Create a **public product page** for each generated link (e.g., `/share/hp/{id}`) that includes Open Graph meta tags with the product image. When you paste that URL into WhatsApp, **WhatsApp automatically fetches the page and shows the product image as a rich preview** — title, description, and 1-2 photos, no extra work needed.

```text
How it works:

  Admin clicks "Share on WhatsApp"
       │
       ▼
  Opens wa.me with message containing:
    🛒 *iPhone 15 Pro Max*
    📱 French description...
    💰 $1,250
    👉 https://idea-funded-launch.lovable.app/share/hp/abc123
       │
       ▼
  WhatsApp fetches that URL, reads og:image
       │
       ▼
  Customer sees product photo + title + price
  in the WhatsApp chat bubble automatically
```

### Steps

1. **Database migration** — Add `description_fr` and `gallery_images` columns to `hot_products_showcase`
   - `description_fr TEXT` — French product description (editable)
   - `gallery_images TEXT[]` — store 1-2 extra product images from extraction

2. **Edge function: `translate-product`** — Auto-generate a short French product description from the English title using Lovable AI (Gemini Flash). Called during extraction, result is editable.

3. **Update extraction flow** — When extracting a product, also save up to 2 gallery images (already returned by `extract-price`) into the new column.

4. **Create `/share/hp/:id` public page** — A lightweight page that:
   - Fetches the product from `hot_products_showcase`
   - Sets `og:image`, `og:title`, `og:description` meta tags for WhatsApp preview
   - Shows the product with 1-2 images, French description, and price
   - Has a "Buy / Order" CTA button

5. **Add WhatsApp share button** to the Generated Links list in admin — Opens `wa.me/?text=...` with a pre-formatted French message including the shareable product URL.

6. **Make `description_fr` editable** — In both the extraction preview and the post-save edit mode, alongside the existing price fields.

### What the Customer Sees in WhatsApp
- A rich link preview with the product image (automatic from OG tags)
- French product name and description
- Price
- A link they can tap to view the product and order

### Files to Change
| File | Change |
|---|---|
| DB migration | Add `description_fr`, `gallery_images` columns |
| `supabase/functions/translate-product/index.ts` | New edge function for EN→FR |
| `src/pages/share/HotProductShare.tsx` | New public share page with OG tags |
| `src/pages/admin/HotProducts.tsx` | WhatsApp button, description field, gallery storage |
| `src/App.tsx` | Add `/share/hp/:id` route |

