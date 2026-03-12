

# Fix Hot Products Email — 4 Issues

## Issues Identified

1. **No logo** — Header is just text "AfriShop USA". The logo is already hosted at `https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png` (used in invite email template).

2. **Product links go to /paste-link** — Two causes:
   - Test mode (line 118-120) hardcodes `product_url: 'https://afrishop-usa.com/paste-link'` for all sample products
   - Paste-link products (line 191) use the raw retailer URL instead of constructing an AfriShop product page URL. Should build `https://afrishop-usa.com/product/{provider}/{provider_product_id}` when provider info is available, otherwise link to the AfriShop search or the original URL.

3. **Images not displaying** — Some email clients block images from unfamiliar CDNs. The `toHighResImage()` regex patterns may also break valid URLs. Will ensure proper `alt` text and fallback, and verify the regex is correct.

4. **Email lands in Promotions** — Gmail categorizes based on content signals. Improvements:
   - Remove promotional language ("Hot Picks", "Produits Vedettes")
   - Use a more personal/transactional subject line
   - Reduce image-to-text ratio
   - Remove the "Paste a Link" marketing CTA section from the email (keep it minimal)
   - Add more plain text content relative to HTML

## Changes

### File: `supabase/functions/send-hot-products-email/index.ts`

**Email HTML template (`buildEmailHtml`):**
- Add AfriShop logo image in header: `<img src="https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png" width="140" alt="AfriShop USA" />`
- Change subject to something more transactional: `"Votre selection de la semaine - AfriShop USA"` (sounds personal, not promotional)
- Remove or tone down "Paste a Link" CTA section (this screams promotional to Gmail)
- Keep email short and personal-sounding
- Ensure product images have proper `alt` text and explicit dimensions

**Test mode sample products (lines 117-121):**
- Fix `product_url` to use realistic AfriShop product page URLs instead of `/paste-link`

### File: `src/pages/admin/HotProducts.tsx`

**`extractFromLink` function (line 191):**
- When `data.provider` and `data.providerId` are available, construct the proper AfriShop product URL: `https://afrishop-usa.com/product/${provider}/${providerId}`
- Fall back to original URL only if no provider info

**`buildPreviewHtml` function:**
- Add the logo image in the preview header to match the actual email
- Remove emoji from header (anti-spam)

