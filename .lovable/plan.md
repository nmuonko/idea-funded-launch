
## Goal
Make search reliably return relevant items for French/local-language queries (example: **“haut talon”** should show high heels, not cars/tires/wheels), while keeping results dynamic and fast.

## What I found
1. The backend currently has polluted cache entries for fashion queries:
   - Query `heels` has cached results containing many **“hot wheels” / wheel / car** items.
2. Main technical cause:
   - In backend relevance scoring, token matching uses substring logic (`title.includes(token)`), so:
     - `heels` matches `wheels`
     - `high` matches many unrelated titles
   - This inflates irrelevant results and then they get cached.
3. Additional risk:
   - “near-match cache” lookup currently does not strictly enforce same intent/category/provider before reusing cached responses, so contamination can spread.
4. Translation path is mostly correct for French terms like `haut talon` (map has `haut talon -> high heels`), but downstream ranking/cache contamination still breaks output quality.

---

## Implementation plan

### 1) Fix core relevance matching in backend scorer (highest impact)
**Files:**
- `supabase/functions/_shared/searchIntentScorer.ts`

**Changes:**
- Replace raw substring token scoring with **word-boundary token matching**.
  - Prevent `heels` matching `wheels`.
- Add a small **generic-token stoplist** for scoring (e.g. `high`, `low`, etc.) so weak adjectives don’t dominate relevance.
- Update “general relevance must match token” check to use boundary matching, not `includes`.
- Strengthen **fashion intent hard-drop** with vehicle/wheel terms (`wheel`, `wheels`, `rim`, `tire`, `tyre`, etc.) and model-toy terms (`hot wheels`, `diecast`, etc.).

**Expected outcome:**
- Fashion searches stop returning automotive/wheel inventory caused by lexical overlap.

---

### 2) Add strict cache safety for near-match reuse
**Files:**
- `supabase/functions/_shared/searchCacheSimilarity.ts`
- `supabase/functions/catalog-search/index.ts` (if needed for metadata wiring)

**Changes:**
- Enforce compatibility checks before accepting near-match candidates:
  - same `intentKey`
  - same category context
  - same provider mode/page shape already intended by key
- Reject near-match candidates whose cached metadata is missing required intent/category fields for current strict mode.

**Expected outcome:**
- Cached “similar query” reuse won’t cross-contaminate fashion with automotive results.

---

### 3) Tighten deterministic-first behavior for clear fashion queries
**Files:**
- `supabase/functions/catalog-search/index.ts`
- (possibly) `supabase/functions/_shared/queryPreNormalizer.ts`

**Changes:**
- For strongly recognized footwear/fashion translations (`high heels`, `women heels`, etc.), reduce chance of AI rewrite overriding deterministic translation.
- Keep AI as fallback for ambiguous cases, but avoid rewriting already-clean high-confidence fashion intents.

**Expected outcome:**
- French/local fashion queries stay stable and predictable.

---

### 4) Invalidate stale bad caches
**Files:**
- `supabase/functions/_shared/catalogCache.ts`
- `src/lib/catalogCache.ts`

**Changes:**
- Bump backend search cache version constant.
- Bump frontend cache prefix version.
- This forces refresh away from polluted cached entries.

**Expected outcome:**
- Users get corrected ranking immediately after rollout, not old wrong cache.

---

### 5) Validation steps (must pass)
1. Search in French:
   - `haut talon`
   - `talon haut`
   - `chaussure dame haut talon`
2. Verify top 20 contain only footwear/fashion-relevant products.
3. Confirm no “wheels/tires/car” contamination.
4. Confirm English equivalents still behave:
   - `high heels`
   - `women heels`
5. Confirm unrelated searches still work (regression check):
   - `ordinateur`
   - `laptop`
   - `toyota tires` (should remain automotive-relevant)

---

## Technical notes
- This is primarily a backend relevance bug, not just frontend rendering.
- The key fix is lexical precision in scorer + safer cache reuse.
- Cache version bump is required, otherwise old polluted entries can keep appearing.
