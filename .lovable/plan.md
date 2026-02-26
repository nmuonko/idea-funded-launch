

## Remove Ingestion Target Display from Data Sync Section

### What to do
Remove the "Ingestion Target" block (lines 1579-1594) from the Data Sync card in `src/pages/admin/CatalogCache.tsx`. This block currently exposes a raw backend URL and a warning badge, which is unnecessary UI clutter.

### File: `src/pages/admin/CatalogCache.tsx`

**Remove lines 1579-1594** -- the entire `{/* Target Info */}` div that displays:
- "Ingestion Target" label
- The raw function URL
- The "Points to same environment (self)" / "Routes to Live" badge

The `targetInfo` query and `handlePushToLive` logic that uses it will remain intact (they're still needed for the Push to Live button's validation).

