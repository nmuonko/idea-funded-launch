
# Plan: Add Bulk Delete Functionality to Home Curation

## Overview

Add the ability to select multiple seed queries and delete them in bulk from the Home Curation admin page. This will allow admins to quickly clean up old seeds and refresh homepage content with new queries.

## Current State

- Individual seed deletion exists via the trash icon button (calls `handleDeleteSeed`)
- Backend `admin-home-seeds` DELETE endpoint only supports deleting one seed at a time by `id`
- No checkbox selection UI for seeds (unlike the Suggestions panel which has selection)

## Changes Required

### 1. Backend: Update `admin-home-seeds` DELETE endpoint

**File:** `supabase/functions/admin-home-seeds/index.ts`

Add support for bulk delete by accepting an array of IDs:

```text
Current: { id: string }
New: { id?: string, ids?: string[] }
```

- If `ids` array is provided, delete all matching seeds in a single operation
- Log bulk delete action to audit log with count and details
- Return count of deleted items

### 2. Frontend: Add selection state for seeds

**File:** `src/pages/admin/HomeCuration.tsx`

Add new state variable:
```typescript
const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());
```

### 3. Frontend: Add checkbox to each seed row

Update the seed row UI to include a checkbox for selection:
- Checkbox appears before the drag handle
- Clicking checkbox toggles selection
- Visual highlighting when selected (similar to suggestions panel)

### 4. Frontend: Add bulk action toolbar

Add a toolbar above the seeds list with:
- "Select All / Deselect All" button
- "Delete Selected (N)" button (destructive, only visible when items selected)
- Confirmation dialog before bulk delete

### 5. Frontend: Add bulk delete handler

New function to handle bulk deletion:
```typescript
const handleBulkDeleteSeeds = async () => {
  // Show confirmation
  // Call DELETE endpoint with ids array
  // Clear selection
  // Refresh seeds list
}
```

## UI Mockup

```text
┌─────────────────────────────────────────────────────────┐
│ Active Seeds                                        20  │
│ Queries used to populate this section                   │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ New query...                                  [+] │   │
│ └───────────────────────────────────────────────────┘   │
│                                                         │
│ [Select All]                    [🗑 Delete Selected (3)]│ ← NEW toolbar
│ ─────────────────────────────────────────────────────── │
│ [☑] ⋮⋮ Samsung Galaxy A54           [toggle] [🗑]       │ ← checkbox added
│ [☑] ⋮⋮ Google Pixel 7a              [toggle] [🗑]       │
│ [☑] ⋮⋮ iPhone 14 unlocked           [toggle] [🗑]       │
│ [ ] ⋮⋮ Samsung Galaxy S24 Ultra     [toggle] [🗑]       │
│ [ ] ⋮⋮ Motorola Edge                [toggle] [🗑]       │
└─────────────────────────────────────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/admin-home-seeds/index.ts` | Add bulk delete support for `ids[]` parameter |
| `src/pages/admin/HomeCuration.tsx` | Add selection state, checkboxes, toolbar, bulk delete handler, confirmation dialog |

## Technical Details

### Backend DELETE Handler Updates

```typescript
// In DELETE method handler
const body = await req.json();
const { id, ids } = body;

// Support both single and bulk delete
const idsToDelete = ids ? ids : (id ? [id] : []);

if (idsToDelete.length === 0) {
  return error response;
}

// Get seed info before deleting for audit
const { data: seedsInfo } = await supabase
  .from("home_section_seeds")
  .select("id, section_key, query")
  .in("id", idsToDelete);

// Bulk delete
const { error: deleteError } = await supabase
  .from("home_section_seeds")
  .delete()
  .in("id", idsToDelete);

// Log bulk action
await logAdminAction(..., {
  actionType: idsToDelete.length > 1 ? "BULK_DELETE_HOME_SEEDS" : "DELETE_HOME_SEED",
  details: { count: idsToDelete.length, seeds: seedsInfo }
});
```

### Frontend State and Handlers

```typescript
// New state
const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());
const [deletingSeeds, setDeletingSeeds] = useState(false);

// Toggle individual seed selection
const toggleSeedSelection = (seedId: string) => {
  setSelectedSeeds(prev => {
    const next = new Set(prev);
    if (next.has(seedId)) next.delete(seedId);
    else next.add(seedId);
    return next;
  });
};

// Select/deselect all seeds
const selectAllSeeds = () => {
  if (selectedSeeds.size === seeds.length) {
    setSelectedSeeds(new Set());
  } else {
    setSelectedSeeds(new Set(seeds.map(s => s.id)));
  }
};

// Bulk delete handler
const handleBulkDeleteSeeds = async () => {
  if (selectedSeeds.size === 0) return;
  
  setDeletingSeeds(true);
  try {
    const response = await apiDelete("admin-home-seeds", { 
      ids: Array.from(selectedSeeds) 
    });
    
    if (response.data?.ok) {
      toast({ title: "Deleted", description: `${response.data.count} seeds removed` });
      setSelectedSeeds(new Set());
      fetchSeeds(selectedSection);
      fetchSections();
    }
  } catch (error) {
    toast({ title: "Error", variant: "destructive" });
  } finally {
    setDeletingSeeds(false);
  }
};
```

### Confirmation Dialog

Use AlertDialog to confirm bulk deletion:
```typescript
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive" disabled={selectedSeeds.size === 0}>
      <Trash2 className="h-4 w-4 mr-2" />
      Delete Selected ({selectedSeeds.size})
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {selectedSeeds.size} seeds?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. The selected queries will be permanently removed.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleBulkDeleteSeeds}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## Edge Cases Handled

1. **Clear selection on section change**: Reset `selectedSeeds` when switching sections
2. **Disable bulk delete while loading**: Prevent double-clicks during API calls
3. **Handle partial failures**: If some deletes fail, show appropriate error message
4. **Refresh counts after delete**: Update the section seed counts in the dropdown

## Testing Steps

1. Navigate to Admin → System → Home Curation
2. Select a section with seeds (e.g., Phones)
3. Check individual seed checkboxes - verify selection highlighting
4. Click "Select All" - verify all seeds are selected
5. Click "Deselect All" - verify all cleared
6. Select 3-5 seeds, click "Delete Selected"
7. Verify confirmation dialog appears
8. Confirm deletion - verify seeds removed and count updates
9. Check audit log for bulk delete entry
