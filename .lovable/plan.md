

# Admin Portal Cleanup: Remove Redundant Code and Fix Slowness

## Problem

The admin portal has accumulated dead code, duplicate components, and orphaned pages that increase bundle size and slow down loading. Several pages/components are either not routed, not linked in the sidebar, or duplicate functionality already covered by other pages.

## Identified Redundancies

### 1. Dead Files (no route, no import, or superseded)

| File | Reason | Action |
|------|--------|--------|
| `src/pages/admin/HomeCuration.tsx` (779 lines) | Route removed; comment in App.tsx says "consolidated into home-recipes". Only self-references. | DELETE |
| `src/pages/admin/TicketAnalytics.tsx` | No route in App.tsx, no sidebar link, no import anywhere | DELETE |
| `src/pages/admin/Marketers.tsx` | No route in App.tsx, no sidebar link, no import anywhere | DELETE |
| `src/pages/admin/SupportTickets.tsx` | No route in App.tsx, no sidebar link. SupportInbox replaced it. | DELETE |
| `src/components/admin/SupabaseDiagnostics.tsx` (270 lines) | Zero imports anywhere in the codebase | DELETE |
| `src/components/admin/OrderTimeline.tsx` | Duplicate of `OrderTimelineComponent.tsx`. Only used in `OrderDetailsDrawer.tsx` (the drawer), while `OrderTimelineComponent.tsx` is used in `OrderDetail.tsx` (the page). Two components doing the same thing. | CONSOLIDATE: keep `OrderTimelineComponent.tsx`, update `OrderDetailsDrawer.tsx` to use it, delete `OrderTimeline.tsx` |

### 2. Duplicate / Overlapping Admin Pages

| Pages | Overlap | Action |
|-------|---------|--------|
| `CacheSettings.tsx` (609 lines) vs `CatalogSourcesSettings.tsx` (1055 lines) | Both manage TTL settings, cache controls, and provider config. CacheSettings has response cache + global TTL + per-category overrides. CatalogSourcesSettings has provider mode + API limits + prewarm. They split what should be one "Catalog Config" page into two confusing pages. | MERGE into single `CatalogSourcesSettings.tsx` by moving the unique CacheSettings sections (response cache TTL, clear cache button, per-category overrides) into it, then delete `CacheSettings.tsx`. Update sidebar and routes. |

### 3. Lazy Import Bloat in App.tsx

The following are lazy-imported in App.tsx but never routed (dead imports adding to build overhead):

| Import | Status |
|--------|--------|
| `BankTransferSettings` | Route commented out ("removed") but import remains |
| `PriceConfirmations` | Route commented out ("removed") but import remains |
| `TransferProofs` | Route commented out ("removed") but import remains |
| `AdminKnowledgeBase` | Route exists but no sidebar link (check if intentional) |

Remove the dead lazy imports for BankTransferSettings, PriceConfirmations, and TransferProofs.

### 4. Dashboard Performance Concern

`CustomerOverviewWidget` on the dashboard loads ALL non-admin profiles + ALL their orders on mount (no pagination), which will degrade as the user base grows. This is a direct contributor to dashboard slowness.

Fix: Limit the query to top 5 customers by using an RPC or a more targeted query rather than loading all profiles and filtering in JS.

### 5. Health Page Fake Stats

`Health.tsx` `loadEdgeFunctionStats()` fabricates latency numbers (hardcoded `avgLatency: 450`, `avgLatency: 320`, etc.) and derives error counts from unrelated order data. This is misleading and adds unnecessary queries.

Fix: Remove the fabricated edge function stats section. The real provider health is now in `provider_health_status` table (from the Catalog Builder work). The circuit breaker and system load widgets already provide genuine status.

## Implementation Steps

### Step 1: Delete dead files
- Delete `HomeCuration.tsx`, `TicketAnalytics.tsx`, `Marketers.tsx`, `SupportTickets.tsx`, `SupabaseDiagnostics.tsx`, `OrderTimeline.tsx`

### Step 2: Consolidate OrderTimeline
- Update `OrderDetailsDrawer.tsx` to import from `OrderTimelineComponent` instead of `OrderTimeline`

### Step 3: Clean App.tsx
- Remove lazy imports for `BankTransferSettings`, `PriceConfirmations`, `TransferProofs`
- Remove `CacheSettings` lazy import and its route after merging

### Step 4: Merge CacheSettings into CatalogSourcesSettings
- Move the 3 unique sections from CacheSettings (response cache TTLs, clear cache, per-category overrides) into CatalogSourcesSettings as new tabs or collapsible sections
- Remove the `/admin/cache-settings` route from App.tsx
- Update `AdminLayout.tsx` sidebar: remove the "Cache" nav item, keep "Catalog Sources" (rename to "Catalog Config")

### Step 5: Fix CustomerOverviewWidget
- Replace the "load all profiles" approach with a targeted query: select top 5 customers by total_spent using a join or existing RPC, limited to 5 rows

### Step 6: Clean Health page fake stats
- Remove the `loadEdgeFunctionStats` function and the "Edge Function Performance" card that shows fabricated data
- Keep the real health checks (DB, Auth, Edge, Storage), circuit breakers, system load, and cache stats

## Estimated Impact

- ~3,500 lines of dead code removed (HomeCuration 779 + TicketAnalytics ~150 + Marketers ~250 + SupportTickets ~350 + SupabaseDiagnostics 270 + OrderTimeline ~100 + CacheSettings 609 + fake stats ~100 + dead imports ~10)
- Fewer lazy chunks in the admin bundle
- Dashboard loads faster (no full profiles scan)
- Health page shows only real data
- Sidebar is cleaner (one fewer "Cache" link)

## What Does NOT Change

- All functional admin pages remain (Dashboard, Orders, Customers, Shipping, Carts, Payments, etc.)
- Catalog Builder and Catalog Cache pages are untouched
- Auto-Learning pipeline unchanged
- Home Recipes page (the one that replaced HomeCuration) unchanged
- All routes that are actually used remain intact

