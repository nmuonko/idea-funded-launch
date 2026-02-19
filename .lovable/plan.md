

# Fix: "Mes commandes" Empty on Production

## Root Cause

The production database is missing the `confirmation_code` column on the `orders` table. The MyOrders page query includes this column:

```typescript
.select('id, created_at, status, total_usd, confirmation_code')
```

When this query runs against the Live database, it throws:
```
column orders.confirmation_code does not exist
```

This causes the entire query to fail silently, so zero orders are returned -- regardless of which tab is selected.

## Fix

Make the `confirmation_code` column **optional** in the query so it doesn't break if missing, OR publish the schema changes to production so the column exists.

The safest approach is both:

1. **Publish the project** to sync the database schema (including the `confirmation_code` column) from Test to Live.
2. **As a defensive measure**, update the query in `MyOrders.tsx` to handle the error gracefully -- if the initial query fails, retry without `confirmation_code`.

### File Changes

| File | Change |
|------|--------|
| `src/pages/shop/MyOrders.tsx` | Add fallback query without `confirmation_code` if the primary query fails |

### Code Change (lines 60-68)

```typescript
// Try fetching with confirmation_code first, fall back without it
let data, error;
({ data, error } = await supabase
  .from('orders')
  .select('id, created_at, status, total_usd, confirmation_code')
  .eq('user_id', user.id)
  .neq('status', 'DRAFT')
  .order('created_at', { ascending: false })
  .limit(100));

// Fallback if confirmation_code column doesn't exist yet
if (error) {
  ({ data, error } = await supabase
    .from('orders')
    .select('id, created_at, status, total_usd')
    .eq('user_id', user.id)
    .neq('status', 'DRAFT')
    .order('created_at', { ascending: false })
    .limit(100));
}

if (error) throw error;
```

This makes the page work on both the current production schema (without `confirmation_code`) and after publishing (with it).

## After Implementation

You should also **publish the project** so the Live database schema gets the `confirmation_code` column and all other recent fixes (cart dedup, tabs, etc.) go live.

