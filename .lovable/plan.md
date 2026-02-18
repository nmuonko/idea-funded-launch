

# Fix: "Mes commandes" Showing Empty

## Root Cause

There are two issues:

1. **Missing status in tab filters**: All orders in the database have status `PENDING_PAYMENT`, which only appears under the "En cours" (Active) tab. When the user clicks "Historique" (Past), it filters for `DELIVERED`, `COMPLETED`, `CANCELLED` only -- so it shows nothing. But `PENDING_PAYMENT` is also NOT showing under "En cours" if there's an additional problem.

2. **`PENDING` status not included**: The `ACTIVE_STATUSES` array includes `PENDING_PAYMENT` but not plain `PENDING`. If any order has status `PENDING`, it falls through both filters and is invisible.

3. **Default tab UX**: User lands on "Historique" (from their screenshot) and sees nothing because all orders are `PENDING_PAYMENT`. There's no "All Orders" view.

## Fix (in `src/pages/shop/MyOrders.tsx`)

### Change 1: Add an "All" tab as default
Add a third tab option "Tous" / "All" that shows all non-draft orders, and make it the default. This ensures users always see their orders when they open the page.

### Change 2: Expand status lists to catch edge cases
- Add `PENDING` to `ACTIVE_STATUSES`
- Add `REFUNDED` to `PAST_STATUSES`
- The "All" tab shows everything regardless of status

### Change 3: Show order count on each tab
Already implemented but will now work correctly with the "All" tab.

## Technical Details

| File | Change |
|------|--------|
| `src/pages/shop/MyOrders.tsx` | Add "All" tab as default, expand status arrays, ensure all orders are visible |

### Key Code Changes

```typescript
// Add new tab type
type OrderTab = 'all' | 'active' | 'past';

// Expand statuses
const ACTIVE_STATUSES = ['PENDING', 'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED'];
const PAST_STATUSES = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

// Default to 'all'
const [activeTab, setActiveTab] = useState<OrderTab>('all');

// Filter logic
const filteredOrders = orders.filter(order => {
  if (activeTab === 'all') return true;
  const statusUpper = order.status.toUpperCase();
  if (activeTab === 'active') return ACTIVE_STATUSES.includes(statusUpper);
  return PAST_STATUSES.includes(statusUpper);
});
```

A new "Tous" / "All" tab button will be added before the existing "En cours" and "Historique" tabs, styled consistently with the existing tab design.

