

# Admin Portal Cleanup and Feature Improvements (9 Items)

This plan covers all 9 requests in a single implementation pass.

---

## 1. Print Label -- Always Visible on Orders

**Current**: The "Print Label" button only shows when `status === 'PENDING_PAYMENT' || status === 'DRAFT'` AND `!payment_verified_at`.

**Change**: Remove the conditional wrapper so the Print Label button always appears in the orders table actions, regardless of order status or payment verification.

**File**: `src/pages/admin/Orders.tsx` (line 1056) -- remove the condition wrapping the Print Label button.

---

## 2. Remove AI Actions Panel from Dashboard

**Current**: `AIActionsPanel` component is rendered on the Dashboard sidebar.

**Change**: Remove the `<AIActionsPanel />` from the Dashboard and remove its import.

**File**: `src/pages/admin/Dashboard.tsx` -- remove import (line 6) and usage (line 203).

---

## 3. Hide Bank Transfer Option

**Current**: Bank Transfer settings page exists in admin sidebar, and `PendingBankTransfersWidget` shows on Dashboard.

**Changes**:
- Remove "Bank Transfer" nav item from admin sidebar (`AdminLayout.tsx` line 85)
- Remove the `PendingBankTransfersWidget` from Dashboard (`Dashboard.tsx` lines 193-194)
- Remove the route from `App.tsx` (the bank-transfer-settings route)
- Keep the files themselves intact (just hidden, not deleted) in case needed later

---

## 4. Show User Initials Instead of Account Name on Web App

**Current**: The Account page (`src/pages/shop/Account.tsx` line 69-71) shows a generic `User` icon inside a gradient circle.

**Change**: Replace the `User` icon with the user's initials (first letters of first and last name) derived from `profile?.full_name` or `user.email`.

**File**: `src/pages/shop/Account.tsx` -- replace the icon with a text element showing initials.

---

## 5. Active Carts & Saved Items: Platform Column + Reminder Buttons

### 5a. Platform Column in Active Carts
**Current**: Active carts table has no "Platform" column.

**Change**:
- In `admin-get-carts` edge function, join `profiles.signup_platform` to the query
- Pass it through as `platform` in the response
- Add a "Platform" column to the table in `ActiveCartsContent.tsx` showing Mobile/Web badge (same icon pattern as Customers page)
- Add `platform` to the `Cart` interface

### 5b. Web Saved Items Linked to Admin Saved Items
**Current**: `SavedCartsContent.tsx` fetches from `saved_items` table. Web app saved items (from `useShopCart`) use the same `saved_items` table, so they are already linked.

**Change**: No data linkage change needed -- they already share the same table.

### 5c. Manual + Auto Reminder Buttons
**Current**: `SavedCartsContent.tsx` has a "Send Reminders" bulk button. No individual reminder button per user. Active carts has no reminder button.

**Changes**:
- **Saved Items**: Add a "Send Reminder" button per user row (calls `saved-cart-reminders` with a specific user ID filter)
- **Active Carts**: Add a "Send Reminder" button per cart row (invokes `saved-cart-reminders` or a new targeted reminder for that user)
- Both pages already have the bulk reminder capability; we add per-row manual send

---

## 6. Remove Price Review Option

**Current**: "Price Reviews" / `PriceConfirmations` appears in the Finance nav section and has a route.

**Changes**:
- Remove from admin sidebar (`AdminLayout.tsx` line 63)
- Remove the route from `App.tsx` (price-confirmations route)
- Keep the file intact (hidden, not deleted)

---

## 7. Replace Ticket Analytics with Chat Routing / Assignment Control

**Current**: "Ticket Analytics" tab shows stats about support tickets.

**Change**: Replace with a **Chat Assignment Manager** that allows the master admin to:
- See all admin users authorized to receive chats
- Toggle each admin's chat availability (on/off)
- Set a round-robin order (Admin 1, Admin 2, etc.)
- View current assignment queue and who gets the next chat
- Auto-routing: when a new chat arrives at `waiting_agent`, the system assigns it to the next available admin in the rotation

**Implementation**:
- **New page**: `src/pages/admin/ChatRouting.tsx` -- UI for managing chat assignment
- **Database**: New table `chat_routing_config` with columns: `id`, `admin_user_id`, `is_available`, `priority_order`, `chats_assigned_count`, `last_assigned_at`
- **Edge function update**: Modify the support conversation assignment logic to check `chat_routing_config` and assign round-robin
- **Sidebar**: Replace the ticket-analytics nav item with the new Chat Routing page
- **Route**: Replace the ticket-analytics route in `App.tsx`

---

## 8. Remove Transfer Proofs

**Current**: "Transfer Proofs" page appears in the Finance nav section.

**Changes**:
- Remove from admin sidebar (`AdminLayout.tsx` line 61)
- Remove the route from `App.tsx` (transfer-proofs route)
- Keep the file intact (hidden, not deleted)

---

## 9. Move Support Contact Settings to Live Support Tab

**Current**: `SupportContactSettings` is a tab inside `PaymentsSettings` (the "Support" tab).

**Change**:
- Remove the "Support" tab from `PaymentsSettings.tsx` (change from 3-col grid to 2-col)
- Move `SupportContactSettings` into the Support Inbox / Live Chat area. Add it as a settings section within the `SupportInbox.tsx` page (e.g., a collapsible settings panel or a tab alongside Active/Closed conversations).

---

## Summary of Files Modified

| File | Changes |
|---|---|
| `src/pages/admin/Orders.tsx` | Remove Print Label condition |
| `src/pages/admin/Dashboard.tsx` | Remove AIActionsPanel + PendingBankTransfersWidget |
| `src/components/layout/AdminLayout.tsx` | Remove bank-transfer, transfer-proofs, price-confirmations nav items; replace ticket-analytics with chat-routing |
| `src/App.tsx` | Remove routes for bank-transfer-settings, transfer-proofs, price-confirmations; replace ticket-analytics route with chat-routing |
| `src/pages/shop/Account.tsx` | Show user initials instead of User icon |
| `src/pages/admin/ActiveCartsContent.tsx` | Add Platform column + per-row reminder button |
| `supabase/functions/admin-get-carts/index.ts` | Include `signup_platform` in query |
| `src/pages/admin/SavedCartsContent.tsx` | Add per-row manual reminder button |
| `src/pages/admin/PaymentsSettings.tsx` | Remove Support tab (now 2 tabs) |
| `src/pages/admin/SupportInbox.tsx` | Add SupportContactSettings section |
| **NEW**: `src/pages/admin/ChatRouting.tsx` | Chat assignment manager page |
| **DB Migration** | Create `chat_routing_config` table |

