

# Pre-Launch Audit: Issues and Improvements

## CRITICAL Issues (Must Fix Before Ads)

### 1. CSP has a stale hardcoded Supabase project ID
**File:** `index.html` (line 7)

The Content Security Policy explicitly lists `https://igmkhxffnyzoogcqvdab.supabase.co` -- an old/wrong project ID. While the wildcards `https://*.supabase.co` and `wss://*.supabase.co` already cover the actual project (`wydajcvmdoaqvovncotu`), the stale entry is misleading and should be removed to avoid confusion.

**Fix:** Remove the explicit old domain from the CSP, keeping only the wildcard entries.

---

### 2. SEO / Social Sharing Meta Tags Say "Admin Portal"
**File:** `index.html` (lines 12, 27-28)

The `<meta name="description">` and all OG/Twitter description tags say:
> "AfriShop Admin Portal - Manage orders, payments, shipping, and customer support..."

When you run ads, link previews on Facebook, WhatsApp, Twitter, etc. will show "Admin Portal" text. This will confuse customers and hurt click-through rates.

**Fix:** Update all meta descriptions to customer-facing copy, e.g.:
> "AfriShop - Shop from USA stores like Amazon & eBay, delivered directly to DR Congo. Fast, reliable, affordable."

Also update the OG image to a customer-facing promotional image (not a preview screenshot).

---

### 3. Hardcoded Old Project ID in Admin Webhook URLs
**File:** `src/pages/admin/PaymentProvidersContent.tsx` (lines 466, 472)

Stripe and PawaPay webhook URLs reference `igmkhxffnyzoogcqvdab` instead of the current project `wydajcvmdoaqvovncotu`. If these are copy-paste instructions for setting up webhooks, they point to the wrong endpoint.

**Fix:** Replace hardcoded URLs with dynamically constructed ones using `import.meta.env.VITE_SUPABASE_URL`.

---

### 4. Unpublished Schema Changes (Production Out of Sync)
The `confirmation_code` column on `orders` and the new "All" tab for My Orders only exist in Test. Production users currently see an empty orders page.

**Fix:** Publish the project immediately after these fixes are applied.

---

## IMPORTANT Issues (Should Fix)

### 5. Database Security: 7 "Always True" RLS Policies (WARN)
The linter found 7 RLS policies using `USING (true)` or `WITH CHECK (true)` on INSERT/UPDATE/DELETE operations. This means any authenticated user could potentially modify data in those tables.

**Fix:** Audit each flagged table and tighten policies to restrict writes to the owning user or admin role only.

### 6. Database Security: Extensions in Public Schema (WARN)
Two extensions are installed in the `public` schema instead of a dedicated `extensions` schema. This is a security best practice warning.

### 7. Database Security: Function Without search_path (WARN)
One function has a mutable `search_path`, which could be exploited in edge cases.

### 8. No Global Error Boundary
Only `ProductDetails` has an error boundary. If the homepage, cart, checkout, or orders pages crash (e.g., from an unexpected API response), users see a blank white screen with no recovery option.

**Fix:** Add a top-level `<ErrorBoundary>` around all routes in `App.tsx` that shows a friendly "Something went wrong" screen with a retry button.

---

## NICE-TO-HAVE Improvements

### 9. Missing `og:url` Meta Tag
No `og:url` is set, which can cause duplicate content issues with social sharing.

### 10. Performance: No `loading="lazy"` on Product Images
Product grids load all images eagerly. For a catalog with 100+ items per page, lazy loading would improve initial page load time significantly.

### 11. Console Logging in Production
The codebase has extensive `console.log` statements (e.g., `[ShopHome]`, `[Auth]`, `[WEB_CHECKOUT]`). These are helpful for debugging but expose internal logic to anyone who opens DevTools.

**Recommendation:** Add a production log filter or remove verbose logs before launch.

### 12. "Remember Me" UX Quirk
If a user doesn't check "Remember me", their session is cleared on the next browser restart. This is unusual for e-commerce -- most shops keep users signed in by default. For DRC users who may have intermittent connectivity, this could cause friction.

---

## Summary Table

| Priority | Issue | Impact |
|----------|-------|--------|
| CRITICAL | Meta tags say "Admin Portal" | Ad link previews look wrong |
| CRITICAL | Unpublished schema changes | Orders page broken in production |
| CRITICAL | Stale webhook URLs in admin | Payment webhooks misconfigured |
| IMPORTANT | 7 overly permissive RLS policies | Security risk |
| IMPORTANT | No global error boundary | White screen crashes |
| NICE | Production console logging | Information leakage |
| NICE | Lazy loading images | Performance |
| NICE | "Remember Me" default | User friction |

## Recommended Implementation Order

1. Fix meta tags in `index.html` (descriptions + OG image)
2. Fix hardcoded webhook URLs in admin
3. Clean up stale CSP entry
4. Add global error boundary
5. Publish to production
6. Audit and fix RLS policies

