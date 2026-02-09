

# Web App Improvements - Multi-Fix Plan

This plan addresses 7 distinct issues reported on the web app.

---

## Issue 1: Hamburger Menu Restructure

**Current state:** The hamburger menu sits after the logo and opens a side drawer with category filters and price ranges that duplicate what's already on the homepage.

**Changes:**
- **`src/components/shop/ShopHeader.tsx`**: 
  - Move the hamburger (Menu icon) to the far left, before the logo
  - Remove all filter content (categories, price ranges) from the side drawer
  - Move the Account icon and Language selector INTO the hamburger drawer as menu items
  - This frees up horizontal space so the search bar can be wider on mobile
  - The right side of the header will only have the Cart icon

---

## Issue 2: Profile Settings - Show Editable Address

**Current state:** The Profile page (`src/pages/Profile.tsx`) only shows name, email, and phone. No address fields are displayed or editable.

**Changes:**
- **`src/pages/Profile.tsx`**: Add address fields (Address Line 1, Address Line 2, City, Province, Country) that are loaded from the user's profile and can be edited
  - Pre-populate from the existing profile data
  - Include these fields in the save/upsert operation
  - Use the same DRC provinces dropdown from the registration form

---

## Issue 3: Hide Chat Bubble on Admin Portal

**Current state:** `FloatingContactWidget` is rendered globally in `src/App.tsx` (line 133), so it appears on ALL pages including admin routes.

**Changes:**
- **`src/components/shop/FloatingContactWidget.tsx`**: Add a route check using `useLocation()` - if the current path starts with `/admin`, return `null` (don't render the chat bubble)

---

## Issue 4: Registration Edge Function Error

**Current state:** The screenshot shows "Edge Function returned a non-2xx status code" error on registration. The `auth-register` edge function has a bug: it attempts to send a verification email (lines 241-316) BEFORE checking if user creation actually failed (line 318). If the Resend API call fails or times out, it could crash the function.

**Changes:**
- **`supabase/functions/auth-register/index.ts`**: 
  - Move the verification email sending block (lines 242-316) to AFTER the `authError` check (after line 342)
  - Wrap the entire Resend email sending in a try/catch that doesn't abort the registration flow
  - Ensure the function always returns a 200 on successful user creation, even if email sending fails
- **Redeploy** the `auth-register` edge function

---

## Issue 5: Similar Products Not Clickable

**Current state:** Similar products on the product details page use `ProductGrid` which renders `ProductCard` components. Each `ProductCard` is wrapped in a `<Link>` tag. The products from the similar products search may have IDs that don't match the expected format for the product URL.

**Changes:**
- **`src/pages/shop/ProductDetails.tsx`**: When mapping similar product data (lines 185-193), ensure the `id` field is properly set for URL routing (the `provider_product_id` may contain prefixes that `ProductCard.getProductIdForUrl()` strips). Ensure `productUrl` is always passed through so the detail page can fetch the product.
- Verify the `ProductCard` link generation works for similar products by ensuring provider normalization is correct

---

## Issue 6: Checkout Asks for Already-Entered Info

**Current state:** The checkout page loads the profile and pre-fills the address. However, the `hasSavedAddress` check requires `fullName`, `addressLine1`, `city`, AND `country` to all be present. If `addressLine1` was not provided at registration (it's shown but might be skipped), the checkout falls back to the full form.

**Changes:**
- **`src/pages/shop/Checkout.tsx`**: Relax the `hasSavedAddress` check - if user has `fullName` and `country`, show the saved address card (even if some fields are partially filled). Pre-populate whatever data exists from the profile so users don't have to re-enter everything.

---

## Issue 7: Vehicles Tab Shows "No Products Found"

**Current state:** Based on image-223, clicking the "Vehicules" tab shows empty results. This is likely a search/category routing issue where the vehicles tab triggers a search with an empty query.

**Changes:**
- This appears to be a separate catalog search issue. The vehicles category tab likely sends a search request with category=vehicles but the backend returns no results because the vehicles are on a separate Cars page. Will investigate the category tab handler to ensure it routes to the correct endpoint or cars page.

---

## Technical Summary

| File | Changes |
|------|---------|
| `src/components/shop/ShopHeader.tsx` | Move hamburger left, remove filters, add account/language to drawer |
| `src/pages/Profile.tsx` | Add address fields (editable) |
| `src/components/shop/FloatingContactWidget.tsx` | Hide on `/admin` routes |
| `supabase/functions/auth-register/index.ts` | Fix email sending order, prevent crash |
| `src/pages/shop/ProductDetails.tsx` | Fix similar products click navigation |
| `src/pages/shop/Checkout.tsx` | Relax `hasSavedAddress` check, better pre-fill |

