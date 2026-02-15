

# Clean Up Unused Support Page and Import

## What Changes

Remove the orphaned `/support` route and unused imports left over from removing the Support link in the hamburger menu.

## Technical Details

### File: `src/components/shop/ShopHeader.tsx`
- Remove `HelpCircle` from the lucide-react import statement (it is no longer used anywhere in the file).

### File: `src/App.tsx`
- Remove the `import Support from "./pages/Support";` line (line 31).
- Remove the `/support` route block (lines 220-224) that wraps `<Support />` in a `<ProtectedRoute>`.

### File: `src/pages/Support.tsx`
- Delete this file entirely since it is no longer reachable from the UI. The in-app chat fully replaces it.

**Note:** The admin-side support pages (`AdminSupportInbox`, `SupportContactSettings`, `ChatRouting`, etc.) remain untouched -- those are backend/admin tools, not the customer-facing ticket page.

## Files Changed
- `src/components/shop/ShopHeader.tsx` -- remove unused `HelpCircle` import
- `src/App.tsx` -- remove Support import and `/support` route
- `src/pages/Support.tsx` -- delete file

