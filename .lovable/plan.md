

# Demand Insights — Admin Feature

## What It Does
A new admin page ("Demand Insights") showing two ranked tables:
1. **Top Searched Terms** — aggregated from `search_query_log` (last 7/30/90 days selectable)
2. **Most Added/Ordered Items** — aggregated from `order_items` (by title, with total quantity and order count)

Both tables show rank, item/term, count, and a trend indicator. A date range selector (7d / 30d / 90d) filters both tables. This gives you a single view to identify what customers want most, directly informing your Hot Products campaigns.

## Data Sources (Already Exist)
- `search_query_log` — has `q_norm`, `created_at`, `category_guess` (already populated with real data)
- `order_items` — has `title`, `quantity`, `store`, `product_image_url`, `created_at` (already populated)

No new tables or migrations needed. Both tables already have admin-accessible RLS policies.

## Changes

### 1. New Page — `src/pages/admin/DemandInsights.tsx`
- Date range selector (7d / 30d / 90d)
- **Top Searches** card: Query `search_query_log`, group by `q_norm`, count occurrences, order desc, limit 20. Show rank, search term, count, category guess.
- **Most Ordered Items** card: Query `order_items` joined with `orders` (excluding DRAFT), group by `title`, sum quantity & count distinct orders, order desc, limit 20. Show rank, product image thumbnail, title, store badge, total quantity, order count.
- Styled with existing admin Card/Table components, matching the dark admin theme.
- Bilingual labels (EN/FR) using existing `getAdminTranslation` pattern.

### 2. Route — `src/App.tsx`
- Add route under admin: `path="demand-insights"` with `AdminRouteGuard` (`can_view_analytics` permission)
- Lazy-load the component

### 3. Admin Sidebar Navigation
- Add "Demand Insights" link with a TrendingUp icon, placed near the Analytics menu item

### Files
| File | Action |
|------|--------|
| `src/pages/admin/DemandInsights.tsx` | Create |
| `src/App.tsx` | Add route |
| Admin sidebar/nav component | Add menu link |

