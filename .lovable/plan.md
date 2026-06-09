## Goal
Reduce the admin sidebar from ~37 items across 7 sections down to ~12 top-level entries by merging related pages into **tabbed hub pages**. Each hub keeps the existing pages exactly as they are — they just become tabs inside one parent route.

## Hubs to create

| Hub route | Tabs (existing pages, unchanged) |
|---|---|
| `/admin/finance` | Payments · Abandoned Checkouts · Providers |
| `/admin/support` | Live Chat · Support Contact · Chat Routing · Sophie Conversations |
| `/admin/marketing` | Hot Products · Reels · International Products · Telegram Import · Bundle Links · Dubai Uploads · Referrals |
| `/admin/insights` | Analytics · Activity & Funnel · Demand Insights · A/B Tests |
| `/admin/system` (super-admin only) | Home Curation · Price Review · Catalog Config · Catalog Cache · Auto-Learning · Health · Audit Log |

**Operations** and **Settings** stay as-is — their items are already used daily and don't benefit from tabbing.

## What stays the same
- Every existing page component, URL, and permission check is preserved.
- Deep links like `/admin/hot-products` still work (redirect into the hub with that tab active).
- Mobile sidebar behavior, theme, permissions all unchanged.

## Technical approach
1. Create `src/components/admin/AdminHubLayout.tsx` — a reusable layout that renders:
   - A horizontal scrollable tab bar (shadcn `Tabs` + `ScrollArea`) built from a `tabs: { to, label, icon, permission }[]` prop, filtered by `useAdminPermissions`.
   - `<Outlet />` underneath for the active tab's page.
2. Create 5 thin hub page wrappers under `src/pages/admin/hubs/` (FinanceHub, SupportHub, MarketingHub, InsightsHub, SystemHub) that just pass their tab config to `AdminHubLayout`.
3. In `src/App.tsx`, nest the existing routes under each hub route:
   ```tsx
   <Route path="finance" element={<FinanceHub/>}>
     <Route index element={<Navigate to="payments" replace/>} />
     <Route path="payments" element={<AdminPayments/>} />
     ...
   </Route>
   ```
   Keep old paths (`/admin/payments`, etc.) as `<Navigate>` redirects to the new nested paths so existing bookmarks/links still work.
4. In `src/components/layout/AdminLayout.tsx`, replace the 5 merged sections with single sidebar entries pointing at the hub root.

## Out of scope
- No design changes to individual pages.
- No permission model changes.
- No backend changes.

Confirm and I'll implement.