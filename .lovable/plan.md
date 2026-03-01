

# Full Order Lifecycle Audit: Buy to Delivery

## Current Flow Analysis

Here's what exists today and the gaps identified:

### What Works Well
1. **Purchase to Payment**: Customer buys -> order created as PENDING_PAYMENT -> payment via Stripe/PawaPay -> marked PAID. This flow is solid.
2. **Admin Order Management**: Admin can view orders, change statuses via dropdown or quick action buttons (Processing + Notify, Shipped + Notify, Delivered + Notify).
3. **Shipping Label**: Print Label button exists on the Orders page -- generates a 4x6 printable label with customer name, address, and items.
4. **Shipping Tab** (`/admin/shipping`): Has 3 tabs -- Ready to Ship (PAID/PROCESSING), In Transit (SHIPPED), Delivered (COMPLETED). Supports tracking number, carrier, estimated delivery, actual shipping cost.
5. **Email Notifications**: Three email functions exist and work: `send-order-processing-email`, `send-order-shipped-email`, `send-order-delivered-email`.
6. **Customer Tracking**: `/track-order` page lets customers enter a confirmation code to see order progress with a visual step tracker.

### Issues and Gaps Found

#### Issue 1: No Push Notifications on Status Changes
Email notifications are sent, but **push notifications are NOT triggered** when an order status changes. The `send-push-notification` edge function exists and works (used for cart reminders), but it's never called during order status updates. Mobile app users won't get real-time alerts.

**Fix**: Add push notification calls alongside email sends in the status update flow (in `OrderDetail.tsx` admin and `Shipping.tsx`).

#### Issue 2: No "Delivery Agent" Role for DRC Person
The current admin roles are: `super_admin`, `finance`, `operations`, `support`. There is **no delivery agent role** for the person in DRC who needs to mark items as delivered. They would need full admin access today, which is a security risk.

**Fix**: Add a `delivery` role to `StaffRoleSelector` and `useAdminPermissions`. Create a simplified delivery portal page that only shows SHIPPED/READY_FOR_PICKUP orders and lets the delivery person mark them as COMPLETED (delivered) with one tap + send notification.

#### Issue 3: No "Ready for Pickup" Transition Button
The `READY_FOR_PICKUP` status exists in the database enum but there's **no quick action button** to move an order to this state. The Shipping page tabs don't include it either. This status is important for your DRC operations where items arrive at a pickup point.

**Fix**: Add a "Ready for Pickup + Notify" button in admin order detail and shipping page. Add a tab in the shipping page for READY_FOR_PICKUP orders.

#### Issue 4: Shipping Page Missing "Ready for Pickup" Tab
The shipping page has only 3 tabs: Ready to Ship, In Transit, Delivered. There's no tab for orders that are at the DRC pickup point waiting for customer collection.

**Fix**: Add a 4th tab "Ready for Pickup" showing READY_FOR_PICKUP orders.

#### Issue 5: No Email Template for "Ready for Pickup"
There are emails for Processing, Shipped, and Delivered, but **none for Ready for Pickup** -- which is arguably the most important notification for DRC customers.

**Fix**: Create a `send-order-ready-email` edge function.

## Implementation Plan

### 1. Add "delivery" admin role
- Update `StaffRoleSelector.tsx` to include a "Delivery" role with a MapPin icon
- Update `useAdminPermissions.ts` to grant delivery agents permission to view shipping and update order statuses (but not access finance, users, settings, etc.)

### 2. Create Delivery Portal page
- New page at `/admin/delivery` -- a simplified mobile-friendly view
- Shows only SHIPPED and READY_FOR_PICKUP orders assigned to the delivery area
- Large tap-friendly buttons: "Mark Ready for Pickup" and "Mark Delivered"
- Auto-sends email + push notification on each action
- Add to admin sidebar, visible to `delivery` and `operations` roles

### 3. Add push notifications on status changes
- In the admin order status update flow (`OrderDetail.tsx` and `Shipping.tsx`), call `send-push-notification` after sending email
- Trigger for: PROCESSING, SHIPPED, READY_FOR_PICKUP, COMPLETED
- Push notification titles/body in French (primary audience is DRC)

### 4. Add "Ready for Pickup" support
- Add `send-order-ready-email` edge function with bilingual template
- Add "Ready for Pickup + Notify" quick action button in `OrderDetail.tsx`
- Add 4th tab "Ready for Pickup" in `Shipping.tsx`
- Add push notification for this status

### 5. Add "Ready for Pickup" tab to Shipping page
- New tab between "In Transit" and "Delivered"
- Shows READY_FOR_PICKUP orders
- Grid changes from 3 to 4 columns

## Files to Create
- `src/pages/admin/Delivery.tsx` -- Delivery agent portal
- `supabase/functions/send-order-ready-email/index.ts` -- Ready for pickup email

## Files to Edit
- `src/components/admin/StaffRoleSelector.tsx` -- Add delivery role
- `src/hooks/useAdminPermissions.ts` -- Add delivery role permissions
- `src/pages/admin/OrderDetail.tsx` -- Add push notifications + Ready for Pickup button
- `src/pages/admin/Shipping.tsx` -- Add Ready for Pickup tab + push notifications
- `src/components/layout/AdminLayout.tsx` -- Add Delivery link in sidebar
- `src/App.tsx` -- Add route for delivery page

## Summary of What Users Will Experience After Fix
- **Customer gets email AND push notification** at every status change (Processing, Shipped, Ready for Pickup, Delivered)
- **Admin (you)** can print shipping labels, mark orders as Processing/Shipped from the Orders or Shipping page
- **DRC delivery person** has their own simplified Delivery portal to mark "Ready for Pickup" and "Delivered" with one tap
- **Shipping page** now has 4 clear tabs tracking the full journey: Ready to Ship -> In Transit -> Ready for Pickup -> Delivered
