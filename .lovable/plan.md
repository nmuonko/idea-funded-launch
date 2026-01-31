
# Fix: Home Curation Buttons Not Working

## Root Cause Analysis

Two critical issues are causing the home curation feature to completely fail:

### Issue 1: Missing Export in auditLog.ts

The edge functions import a non-existent function:

```text
Error: The requested module '../_shared/auditLog.ts' does not provide 
an export named 'logAdminAction'
```

**Affected functions:**
- `admin-home-sections/index.ts` (line 10)
- `admin-home-seeds/index.ts` (line 11)
- `admin-home-seed-suggestions/index.ts` (line 11)

All three functions fail to boot because `logAdminAction` doesn't exist in `auditLog.ts`. The file only exports:
- `generateTraceId`
- `logAuditEvent`
- `logAudit`

### Issue 2: Missing Constant in catalog-prewarm-worker

The worker references `HOME_PREWARM_SECTIONS` on lines 282, 630, 638, and 639, but this constant is:
- Defined only in `catalog-prewarm-home/index.ts`
- Not exported from that file
- Never imported into `catalog-prewarm-worker`

---

## Solution

### Fix 1: Add `logAdminAction` to auditLog.ts

Add a new exported function that matches how the edge functions are calling it:

```typescript
// Current usage in edge functions:
await logAdminAction(supabase, {
  adminId: authResult.user.id,
  actionType: "UPDATE_HOME_SECTION",
  targetSection: "home_sections",
  targetId: key,
  details: updates,
});
```

The function will write to `admin_audit_logs` table:

```typescript
export async function logAdminAction(
  supabase: SupabaseClientAny,
  params: {
    adminId: string;
    actionType: string;
    targetSection: string;
    targetId: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase
      .from('admin_audit_logs')
      .insert({
        admin_id: params.adminId,
        action_type: params.actionType,
        target_section: params.targetSection,
        target_id: params.targetId,
        details: params.details || {},
      });
  } catch (err) {
    console.error('[AuditLog] Admin action log failed:', err);
  }
}
```

### Fix 2: Add HOME_PREWARM_SECTIONS to catalog-prewarm-worker

Add the missing constant definition at the top of `catalog-prewarm-worker/index.ts`:

```typescript
// Default home sections for prewarm (fallback when DB is empty)
const HOME_PREWARM_SECTIONS = [
  { key: "phones", categoryKey: "electronics_phones" },
  { key: "vehicles", categoryKey: "vehicles_cars_trucks" },
  { key: "gaming", categoryKey: "electronics_gaming" },
  { key: "computers", categoryKey: "electronics_computers" },
  { key: "clothing", categoryKey: "clothing_shoes_accessories" },
  { key: "home_garden", categoryKey: "home_garden" },
  { key: "refurbished", categoryKey: "refurbished" },
  { key: "parts_accessories", categoryKey: "parts_accessories" },
];
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/_shared/auditLog.ts` | Add `logAdminAction` function |
| `supabase/functions/catalog-prewarm-worker/index.ts` | Add `HOME_PREWARM_SECTIONS` constant |

---

## Deployment

After making changes, redeploy the affected edge functions:
- `admin-home-sections`
- `admin-home-seeds`
- `admin-home-seed-suggestions`
- `catalog-prewarm-worker`

---

## Testing After Fix

1. Navigate to `/admin/home-curation`
2. Verify section dropdown loads and shows 8 sections
3. Select "phones" section - verify seeds list loads
4. Click "Generate Suggestions" - verify suggestions appear
5. Add a manual seed query - verify it saves
6. Click "Publish Now" - verify prewarm job starts and progresses
