

# Admin Portal and Web App Fixes (9 Items)

## 1. Payments Page: Show Stripe and PawaPay, Not MaishaPay

**File**: `src/pages/admin/Payments.tsx`

The current Payments page under Finance queries `maisha_payments` table and references "MaishaPay" throughout. This needs to be renamed/rebranded to reflect Stripe and PawaPay as the actual payment providers.

Changes:
- Rename "MaishaPay payment records" to "Stripe & PawaPay payment records" (or "Payment Transactions")
- Rename "MaishaPay Ref" column header to "Reference"
- Rename "MaishaPay Details" section in the detail dialog to "Payment Details"
- Remove "MaishaPay Status" label, just call it "Provider Status"
- The underlying table name (`maisha_payments`) stays the same since renaming DB tables is risky; only the UI labels change

## 2. Move Vehicle Quotes Under Operations Tab

**File**: `src/components/layout/AdminLayout.tsx`

Currently Vehicle Quotes is under "Finance". Move it to "Operations" section.

Change line 61 (`quote-requests` item) from the Finance section to the Operations section (after "Carts").

## 3. Chat Routing: Show All Admins (from user_roles, not admin_users)

**File**: `src/pages/admin/ChatRouting.tsx`

Currently the dropdown for adding agents queries `admin_users` table which only has 1 entry. The actual admins are in `user_roles` table (7 entries with `role = 'admin'`). Need to query `user_roles` joined with auth info to show all admin staff.

Changes:
- Replace the `admin_users` query with a query to `user_roles` table
- Join with `profiles` table to get names/emails
- Fall back to auth email if profile is missing
- Show admin name (from profiles) in the dropdown instead of just email

Since `profiles` table has no data for these users, we'll also query from `admin_users` as a fallback and combine both sources. Or better: query `user_roles` and show the user_id with whatever name data is available. We'll use the `admin_users` email as fallback since at least 3 admins have emails there.

Actually, looking at the data: `admin_users` only has 1 row (futurescopellc@gmail.com). The `user_roles` table has 7 admin entries, 3 with auth emails. We should query `user_roles` and use auth emails from a separate lookup. Since we can't query `auth.users` from client, we'll need to use profiles or a server-side approach.

Best approach: Query `user_roles` table for all admins, then look up their profiles. If profiles don't have email, we'll show user_id shortened. Alternatively, we can create a simple edge function or use the existing `admin_users` view. Let me check if there's an `admin_staff` or similar view.

Simplest fix: Also insert the 2 additional staff into `admin_users` table so they appear in the dropdown. But that requires knowing their emails. Instead, we'll update ChatRouting to query `user_roles` WHERE role='admin', then look up `profiles` for names/emails, and fall back to user_id.

## 4. Support Contact: Move Under Support Section (Not Inside Live Chat)

**Files**: `src/components/layout/AdminLayout.tsx`, `src/App.tsx`

Currently Support Contact is a tab inside the Live Chat (Support Inbox) page. Move it to be its own nav item under the "Support" section, right below "Live Chat".

Changes:
- Add a new nav item in AdminLayout: `{ to: '/admin/support-contact', icon: Headphones, label: 'Support Contact' }`
- Add a new route in App.tsx for `/admin/support-contact` rendering `SupportContactSettings`
- Remove the "Contact/Settings" tab from `SupportInbox.tsx`

## 5. Chat Bubble Welcome Message: Language-Aware, Better Copy

**File**: `supabase/functions/support-start/index.ts`

Currently the welcome message is hardcoded in French: "Chat demarre. Comment puis-je vous aider?" 

Changes:
- Accept `language` in the request body from the client
- Use language-appropriate welcome message:
  - **en**: "Leave us a message describing your need and an agent will respond as soon as possible."
  - **fr**: "Laissez-nous un message decrivant votre besoin et un agent vous repondra dans les plus brefs delais."
  - **sw**: "Tuachie ujumbe kuhusu hitaji lako na wakala atajibu haraka iwezekanavyo."
  - **ln**: "Tika biso message mpo na mposa na yo mpe agent akozongisela yo noki."

**File**: `src/components/shop/FloatingContactWidget.tsx`
- Pass `language` in the `support-start` request body

## 6. Apply i18n Translations Everywhere (Checkout Page)

**File**: `src/pages/shop/Checkout.tsx`

The checkout page has ~30+ hardcoded English strings. All need to use the `shop` translations object.

Key strings to translate:
- "Shipping Address", "Full Name", "Phone Number", "Address Line 1/2", "City", "State/Province", "Country", "Postal Code"
- "Payment Method", "Mobile Money", "Credit/Debit Card"
- "I agree to the Terms of Service and Privacy Policy"
- "Place Order", "Processing...", "Checkout", "Back to Cart"
- "Your cart is empty", "Please sign in to checkout", "Continue Shopping", "Sign In"
- "Edit Address", "Using your saved shipping address", "Back to saved address"
- "Shipping Quote Required" (already partially translated)

Add new translation keys to `src/lib/i18n/translations.ts` for all 4 languages (en, fr, sw, ln) under the `shop` section.

## 7. Chat Bubble Visibility on Mobile

**File**: `src/components/shop/FloatingContactWidget.tsx`

Currently the bubble is at `bottom-20 right-4` on mobile. This may overlap with the bottom navigation bar. Adjust positioning to ensure visibility.

Changes:
- Increase `bottom` value on mobile to clear the bottom nav bar (which has safe-area-inset-bottom)
- Change from `bottom-20` to `bottom-24` or `bottom-28` on mobile
- Ensure the chat window doesn't overflow on small screens

## 8. Move Payments Settings Under Finance, Rename

**File**: `src/components/layout/AdminLayout.tsx`

Currently "Payments" settings (providers/limits) is under "Settings" section. Move it under "Finance" and rename to avoid confusion with the existing Payments (transactions) tab.

Changes:
- Move `payments-settings` nav item from Settings section to Finance section
- Rename from "Paiements" / "Payments" to "Fournisseurs" / "Providers" (since it manages payment providers and limits)

## 9. Pre-Launch Verification

No code changes -- this is a confirmation that all the above fixes are implemented without regressions. The existing functionality (cart, checkout, orders, vehicle quotes, shipping calculations) remains intact.

---

## Technical Summary

| # | File(s) | Change |
|---|---------|--------|
| 1 | `src/pages/admin/Payments.tsx` | Replace "MaishaPay" labels with "Stripe & PawaPay" / generic labels |
| 2 | `src/components/layout/AdminLayout.tsx` | Move Vehicle Quotes from Finance to Operations |
| 3 | `src/pages/admin/ChatRouting.tsx` | Query `user_roles` instead of `admin_users` for admin list |
| 4 | `AdminLayout.tsx`, `App.tsx`, `SupportInbox.tsx` | Add Support Contact as separate nav item, remove from inbox tabs |
| 5 | `supabase/functions/support-start/index.ts`, `FloatingContactWidget.tsx` | Language-aware welcome message |
| 6 | `src/pages/shop/Checkout.tsx`, `src/lib/i18n/translations.ts` | Full i18n for checkout page |
| 7 | `src/components/shop/FloatingContactWidget.tsx` | Adjust mobile positioning for chat bubble |
| 8 | `src/components/layout/AdminLayout.tsx` | Move Payments Settings to Finance, rename to "Providers" |

