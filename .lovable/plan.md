

# Functional Test Results and Fix Plan

## Issues Identified

### ISSUE 1: "Publish" for `homepage` section silently fails in prewarm worker (HIGH)

**Root Cause:** The `catalog-prewarm-home` edge function correctly registers `homepage` in its `HOME_PREWARM_SECTIONS` array (line 28), and creates a prewarm job with `sectionIndex` pointing to it. However, the `catalog-prewarm-worker` loads sections from the `home_sections` **database table** (not the hardcoded array). The `homepage` key does **not exist** in the `home_sections` table. This means:
- The worker loads 11 sections from DB
- The `sectionIndex` from the parent function (index 0 for `homepage`) maps to `phones` (the first DB section)
- So publishing "homepage" actually re-prewarms "phones" instead

**Fix:** Insert a `homepage` row into the `home_sections` database table with the appropriate configuration.

---

### ISSUE 2: `computers` recipe missing from `home_recipes` but present in `home_sections` (MEDIUM)

The `home_sections` table has a `computers` section (sort_order 3) that the prewarm worker uses, but there is no corresponding `computers` entry in `home_recipes`. This means the Rebuild button for `computers` does not exist in the admin Home Recipes page. This is an inconsistency but does not cause errors since the prewarm worker works independently.

**Fix:** No action needed now -- the prewarm pipeline handles `computers` via `home_sections`. However, if admin wants Rebuild control, a `computers` recipe could be added.

---

### ISSUE 3: Hardcoded "Sections: X/8" in HomeCuration admin (LOW)

In `src/pages/admin/HomeCuration.tsx` (line 454), the sections count is hardcoded as `/8`:
```
Sections: {lastPrewarmJob.sections_completed}/8
```
The actual `home_sections` table has **11** rows, so the display shows incorrect data (e.g., "Sections: 11/8").

**Fix:** Replace `/8` with the dynamic `sections_total` from the prewarm job data.

---

### ISSUE 4: Index mismatch between `HOME_PREWARM_SECTIONS` and `home_sections` DB (HIGH)

The `catalog-prewarm-home` function uses its own hardcoded `HOME_PREWARM_SECTIONS` array (12 entries) to calculate `sectionIndex`. But the worker loads sections from the `home_sections` DB table (11 entries, different order). When a per-section publish is triggered, the index from the parent function does NOT map to the correct section in the worker.

For example:
- Parent array: `[homepage(0), phones(1), electronics(2), vehicles(3), gaming(4), computers(5), clothing(6), home_garden(7), sporting_goods(8), toys(9), refurbished(10), parts_accessories(11)]`
- Worker DB: `[phones(0), electronics(1), vehicles(2), gaming(3), computers(4), clothing(5), home_garden(6), refurbished(7), parts_accessories(8), toys(9), sporting_goods(10)]`

Publishing "vehicles" (index 3 in parent) would hit "gaming" (index 3 in worker).

**Fix:** Pass the **section key** instead of the index from `catalog-prewarm-home` to `catalog-prewarm-worker`. The worker should look up the section by key rather than by positional index.

---

### ISSUE 5: `Nike shoes` seed missing from mobile `homepage` recipe (LOW)

The mobile `homepage` recipe has seeds for iPhone, Samsung, laptop, PS5, sofa, smart TV, wireless earbuds -- but no `Nike shoes` seed (which exists in the web recipe). This is a minor content gap.

**Fix:** Add `Nike shoes` seed to the mobile homepage recipe via DB insert.

---

## Implementation Plan

### Step 1: Fix the index-based section mismatch (Issues 1 and 4)

**Changes to `supabase/functions/catalog-prewarm-home/index.ts`:**
- Instead of passing `sectionIndex` (positional) to the worker, pass the `sectionKey` (string).
- Remove the index-based lookup logic.

**Changes to `supabase/functions/catalog-prewarm-worker/index.ts`:**
- Accept an optional `sectionKey` parameter alongside `sectionIndex`.
- When `sectionKey` is provided, find the matching section by key in the loaded config array instead of using positional index.
- This ensures the correct section is processed regardless of ordering differences.

### Step 2: Add `homepage` to `home_sections` DB table (Issue 1)

**Database migration:**
- Insert a new row into `home_sections` with `key = 'homepage'`, `enabled = true`, `sort_order = -1`.
- Insert corresponding `home_section_seeds` entries matching the `home_recipe_seeds` for homepage.

### Step 3: Fix hardcoded sections count in HomeCuration (Issue 3)

**Change in `src/pages/admin/HomeCuration.tsx`:**
- Replace the hardcoded `/8` with the `sections_total` field from the prewarm job response.
- Update the `PrewarmJob` interface to include `sections_total`.

### Step 4: Add missing `Nike shoes` seed to mobile homepage recipe (Issue 5)

**Database insert:**
- Add a seed query `Nike shoes` to the mobile homepage recipe.

### Step 5: Deploy and verify

- Deploy `catalog-prewarm-home` and `catalog-prewarm-worker` edge functions.
- Test individual section Publish from admin portal.
- Verify frontend web app continues to show correct data (no regression).

---

## No-Regression Safeguards

- No changes to frontend rendering code (per project constraint).
- The worker fallback to `sectionIndex` is preserved for backward compatibility.
- All existing section processing logic remains unchanged.
- The `catalog-home` serving function is NOT modified.
- Edge function CORS headers are unchanged.

