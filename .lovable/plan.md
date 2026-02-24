

## Speed Up the Admin Portal

### Root Cause

The admin dashboard fires **8+ separate database queries simultaneously** when it loads, and every widget manages its own loading state with raw `useEffect`/`useState`. Key issues:

1. **No query caching**: Every navigation back to the dashboard re-fetches everything from scratch. TanStack Query is configured (2-min staleTime) but the dashboard doesn't use it.
2. **Waterfall queries**: The Dashboard component itself runs 4 sequential queries (current period orders, order items, previous period orders, previous order items). CustomerOverviewWidget runs 4 more. PendingActionsSidebar runs 3. That's 11+ queries on every dashboard load.
3. **30-second polling**: PendingActionsSidebar polls every 30 seconds with `setInterval`, hammering the database even when idle.
4. **OrdersOverviewChart fetches ALL orders**: It queries all non-DRAFT orders without any date filter or limit, pulling the entire orders table.
5. **ConversionFunnel also fetches all orders**: Same issue -- no limit, potentially thousands of rows.
6. **Inactive tab content still fetches**: Both `ChartTabs` and `OperationalInsightsTabs` use Radix Tabs which mount all tab content eagerly, so hidden tabs (Shipping, Payments, Saved Carts, Conversion Funnel) all fetch data even though only one tab is visible.

### Plan

#### 1. Convert dashboard widgets to TanStack Query hooks
Replace raw `useEffect`/`useState` with `useQuery` in all dashboard components. This gives us:
- **2-minute caching**: Navigating away and back won't re-fetch
- **Background refetch**: Data stays fresh without blocking the UI
- **Deduplication**: Multiple components requesting the same data get one query

**Files**: All 8 files in `src/components/admin/dashboard/`

#### 2. Consolidate dashboard stats into a single query
Replace the 4 sequential queries in `Dashboard.tsx` (current orders + items + previous orders + items) with a single backend function call or a single query that returns all needed stats.

**File**: `src/pages/admin/Dashboard.tsx`

#### 3. Fix OrdersOverviewChart to use date range
Add date filtering and a row limit so it doesn't pull the entire orders table.

**File**: `src/components/admin/dashboard/OrdersOverviewChart.tsx`

#### 4. Replace 30s polling with longer refetchInterval
Change PendingActionsSidebar from `setInterval(30s)` to TanStack Query's `refetchInterval: 120000` (2 minutes) -- enough to stay current without hammering the database.

**File**: `src/components/admin/dashboard/PendingActionsSidebar.tsx`

#### 5. Defer hidden tab content
Only render tab content when the tab is active (using conditional rendering inside `TabsContent`) so Shipping, Saved Carts, and other hidden panels don't fire queries until clicked.

**Files**: `src/components/admin/dashboard/ChartTabs.tsx`, `src/components/admin/dashboard/OperationalInsightsTabs.tsx`

### Technical Details

**TanStack Query conversion pattern** (applied to each widget):

```text
// Before (every component)
const [data, setData] = useState(initial);
const [loading, setLoading] = useState(true);
useEffect(() => { fetchData(); }, [deps]);

// After
const { data, isLoading } = useQuery({
  queryKey: ['admin', 'widget-name', deps],
  queryFn: fetchData,
  staleTime: 2 * 60 * 1000,
});
```

**Deferred tab rendering pattern**:

```text
// Before (all tabs mount and fetch)
<TabsContent value="shipping"><ShippingMetrics /></TabsContent>

// After (only active tab mounts)
<TabsContent value="shipping" forceMount={undefined}>
  {activeTab === 'shipping' && <ShippingMetrics />}
</TabsContent>
```

**Consolidated dashboard stats** -- combine the 4 Dashboard.tsx queries into one function:

```text
// Single query that returns all KPI stats
const loadStats = async () => {
  const [currentOrders, previousOrders] = await Promise.all([
    supabase.from('orders').select('id, status, total_usd, ...').gte(...).lte(...),
    supabase.from('orders').select('id, status, total_usd, ...').gte(...).lte(...),
  ]);
  // Calculate all stats from the two parallel queries instead of 4 sequential ones
};
```

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/Dashboard.tsx` | Use `useQuery`, parallelize fetches |
| `src/components/admin/dashboard/PendingActionsSidebar.tsx` | Use `useQuery` with `refetchInterval: 120000` |
| `src/components/admin/dashboard/CustomerOverviewWidget.tsx` | Use `useQuery` |
| `src/components/admin/dashboard/OrdersOverviewChart.tsx` | Use `useQuery`, add date filter + limit |
| `src/components/admin/dashboard/ConversionFunnel.tsx` | Use `useQuery` |
| `src/components/admin/dashboard/ChartTabs.tsx` | Defer inactive tab rendering |
| `src/components/admin/dashboard/OperationalInsightsTabs.tsx` | Defer inactive tab rendering |
| `src/components/admin/dashboard/ShippingMetrics.tsx` | Use `useQuery` |
| `src/components/admin/dashboard/PaymentsBreakdown.tsx` | Use `useQuery` |
| `src/components/admin/dashboard/SavedCartsReport.tsx` | Use `useQuery` |

### Expected Impact

- Dashboard load: **11+ sequential/parallel queries** reduced to **~4 parallel queries** (only visible widgets)
- Return navigation: **instant** (cached for 2 minutes)
- Polling: **30s** reduced to **2 minutes**
- Chart data: **full table scan** reduced to **date-filtered + limited query**

