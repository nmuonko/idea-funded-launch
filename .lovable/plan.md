
## Evolve "Fetch Products" into "On-Demand Fetch"

### What Changes

The current "Fetch Products" tool (category dropdown + provider + quantity) stays but gets upgraded with a **custom search query** field. This lets you say "get me 1,000 cellphones" or "500 iPhone 16 cases" — targeted fetching that Auto-Learning doesn't cover.

### UI Changes

Replace the current Fetch Products card with a redesigned version:

| Field | Current | New |
|-------|---------|-----|
| Title | "Fetch Products" | "On-Demand Fetch" |
| Category | Dropdown (required) | Dropdown (optional — defaults to auto-detect) |
| **Search Query** | -- | **New text input** — e.g. "cellphones", "iPhone 16 Pro Max", "Nike Air Max" |
| Provider | Dropdown | Keep as-is |
| Quantity | Number input | Keep as-is (10–10,000) |
| **Automate Window Run** | Button opens campaign dialog | Keep as-is |

The search query field becomes the primary input. If provided, it overrides the category's default seed queries and tells the builder to focus exclusively on that term.

### Backend Changes

The `run-builder` action in `catalog-refresh-worker` already accepts `category_key` and `max_items_target`. We add an optional `custom_query` parameter:

- If `custom_query` is provided, the builder uses it as the sole search term (instead of rotating through seed queries from `catalog_builder_sources`)
- Category is still used for classification/storage of the fetched items
- If no category is specified but a query is given, the system auto-assigns based on existing category mapping

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/CatalogCache.tsx` | Add search query input field, rename section title, pass `custom_query` to `run-builder` action |
| `supabase/functions/catalog-refresh-worker/index.ts` | Accept `custom_query` param in `run-builder` mode, use it as the search term instead of rotating sources |

### How It Works After

1. You type "cellphones" in the search query, set quantity to 1000, pick eBay
2. Hit "Start Fetching"
3. The builder runs with "cellphones" as the search term, fetching up to 1000 items
4. Items get classified into the appropriate category (phones) and stored
5. Auto-Learning continues running independently for broad catalog growth

### Technical Details

**Frontend** (`CatalogCache.tsx`):

```text
// New state
const [customQuery, setCustomQuery] = useState('');

// Pass to backend
const result = await postAction('run-builder', {
  provider,
  category_key: category || undefined,
  max_items_target: quantity,
  custom_query: customQuery || undefined,  // NEW
});
```

**Backend** (`catalog-refresh-worker/index.ts`):

In the `run-builder` handler, when `custom_query` is present:
- Skip the normal source rotation logic
- Use `custom_query` directly as the eBay/Amazon search term
- Still respect `max_items_target` for pagination limits
- Still apply ingestion guardrails (price floors, junk filters) based on detected category

This keeps Auto-Learning running for broad growth while giving you a precision tool for targeted requests.
