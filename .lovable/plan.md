

# Fix: "Products Per Category" Bars Appear Static

## Root Cause

The `admin-auto-learning` edge function is **not deployed** (404 error). Every call to fetch category counts (`backfill-status` action) silently fails, so the UI either shows stale data from the initial failed load or zeros.

Additionally, there is no periodic refresh -- the category data only updates when:
- You click "Refresh Status" (which calls the broken function)
- Auto-polling runs (only active during bulk import)

## Fix

### Step 1: Deploy the `admin-auto-learning` edge function

This is the primary fix. The function code exists at `supabase/functions/admin-auto-learning/index.ts` but was never deployed. Once deployed, the `backfill-status` action will return live category counts from the database.

### Step 2: Add automatic periodic refresh for category counts

Update `AutoLearning.tsx` to periodically refresh the backfill status (every 60 seconds) so the bars visually update without requiring manual clicks. This uses a simple `setInterval` that runs independently of the bulk import polling.

### Step 3: Add a direct DB fallback for category counts

Similar to the fix applied to the Catalog Cache page, add a fallback in the frontend: if the edge function call fails, query the `admin_catalog_category_counts` RPC directly via Supabase client so the bars always show real data.

## Technical Details

### Edge function deployment
- Deploy `admin-auto-learning`

### File: `src/pages/admin/AutoLearning.tsx`

**Add periodic auto-refresh (near line 217):**
```typescript
// Auto-refresh category counts every 60 seconds
useEffect(() => {
  const interval = setInterval(() => fetchBackfillStatus(), 60_000);
  return () => clearInterval(interval);
}, []);
```

**Add DB fallback in `fetchBackfillStatus` (lines 203-215):**
```typescript
const fetchBackfillStatus = async (showToast = false) => {
  setRefreshingStatus(true);
  try {
    const result = await api.post<BackfillStatus>(
      "admin-auto-learning?action=backfill-status", {}
    );
    if (result.error) throw new Error(result.error);
    setBackfillStatus(result.data);
    if (showToast) toast.success("Status refreshed");
  } catch (err: any) {
    console.warn("Edge fn failed, using DB fallback for category counts", err);
    // Fallback: call the RPC directly
    const { data: cats } = await supabase.rpc('admin_catalog_category_counts');
    if (cats) {
      setBackfillStatus({
        queue: { queued: 0, running: 0 },
        categories: cats,
      });
      if (showToast) toast.success("Status refreshed (from database)");
    } else if (showToast) {
      toast.error("Failed to refresh status");
    }
  }
  setRefreshingStatus(false);
};
```

### Summary of changes
- **Deploy**: `admin-auto-learning` edge function
- **Edit**: `src/pages/admin/AutoLearning.tsx` -- add 60s auto-refresh interval and direct DB fallback for category counts

