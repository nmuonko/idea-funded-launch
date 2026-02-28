
Goal: make search consistently return relevant items (no false “0 products”), increase result depth, and ensure product pages reliably show full galleries.

What I found from your live backend + code:
1) Primary root cause of “no products” for valid searches
- For “Topicrem DA”, logs show:
  - query rewritten to “topicrem da balm”
  - eBay last-resort call executed with that term
  - eBay returned 429 rate-limited
  - response stayed empty
- There is also a hard filter in eBay search URL builder:
  - `buyingOptions:{FIXED_PRICE}`
  - `itemLocationCountry:US`
  These filters reduce recall for beauty/skincare and international listings.
- Current last-resort only tries one strict rewritten phrase, so one miss/rate limit still yields 0.

2) Why unrelated items appear
- The “loose DB fallback” uses OR token matching with tokens as short as 2 chars.
- Example: token `da` matches many unrelated titles.
- This fallback currently does not apply strict final relevance scoring before returning.

3) Why result count feels too small
- Over-strict provider query selection (AI rewrite suffixes like “balm”) can narrow recall.
- eBay global filter restrictions (US + fixed-price only) further reduce pool.
- Provider health can stay unhealthy/rate-limited, and with sparse DB index for niche terms that leads to very few results.

4) Why “no full gallery” can happen
- Product details page starts with one thumbnail from search state.
- If detail fetch fails silently (with nav-state fallback), user still sees product page but can remain with single image.
- Gallery enrichment is implemented backend-side, but if detail fetch path fails/doesn’t resolve the right item, frontend can stay on partial gallery.

Implementation plan (what I will change next after approval):
Phase 1 — Fix recall and “no results” behavior in catalog-search
A. Safer query cascade (from most precise to broader), not just one rewritten query
- Add ordered fallback query candidates:
  1. canonical original user query
  2. AI query_en (if confidence high)
  3. original query (raw)
  4. token-pruned version (drop low-signal suffixes)
- For last-resort provider search, iterate through candidates with short per-attempt budgets and stop at first non-empty result.
- Keep dedupe across attempts.

B. Relax eBay filters in fallback mode
- In fallback mode only:
  - remove mandatory `itemLocationCountry:US`
  - allow non-fixed price when needed (or do staged fallback: fixed-price first, then no buyingOptions filter)
- Preserve stricter filters for normal high-confidence/primary passes where relevant.

C. Prevent unrelated fallback results
- Tighten loose DB fallback:
  - ignore tokens shorter than 3 chars
  - prioritize longest/brand-like tokens first
  - require at least one strong-token boundary match before returning
- Run final `scoreAndRankItems` and minimum relevance gate before emitting fallback items.

D. Improve negative-cache safety
- Keep skipping negative cache on provider errors (already partly present).
- Also skip/shorten negative cache when fallback attempts ended due upstream warnings (429, timeout, circuit-breaker), not true empty market.

Phase 2 — Improve relevance quality globally
A. Use original-intent anchor for scoring
- Keep DB token anchor truly based on user-origin canonical string (not post-AI rewritten suffix).
- Use hybrid scoring tokens:
  - anchor tokens from user query
  - provider tokens from translated query
- This avoids “balm” over-constraining while still leveraging translation.

B. Add “hard unrelated guard” for fallback responses
- Before returning fallback items, enforce:
  - token boundary match to at least one meaningful query token
  - drop items failing minimum lexical overlap
- This reduces random/off-topic cards.

Phase 3 — Make gallery completeness reliable
A. Ensure ProductDetails always attempts authoritative detail fetch
- Keep nav-state thumbnail as temporary.
- If backend fetch fails, surface non-blocking warning and retry once with canonical ID derivation variants.
- Do not silently settle forever on 1 image when detail lookup can be recovered.

B. Canonical ID robustness checks
- Validate provider/id transformations between SearchResults → ProductCard URL → ProductDetails fetch.
- Add fallback resolution path using `provider_product_id` and canonical `provider_id` forms.

C. Gallery fallback hydration on frontend
- If detail response has 1 image and `image_count_status` indicates pending/unknown, trigger one background refresh call and merge if more images arrive.

Validation plan (end-to-end)
1) Query tests for recall/relevance
- “Topicrem DA”, “Topicrem”, “lotion Topicrem”, and similar niche terms.
- Verify:
  - no false zero when provider has items
  - top results stay related
  - result count improves vs current baseline

2) Error-path tests
- Simulate/observe 429 and timeout conditions.
- Verify:
  - fallback query cascade runs
  - negative empty caching is avoided on upstream errors
  - user still receives best possible related results

3) Gallery tests
- Open products from search results across providers.
- Verify:
  - detail page upgrades from thumbnail to full gallery
  - retry logic works when initial detail fetch fails
  - no silent single-image lock unless source truly has one image

Technical notes (for implementation consistency)
- Files to update:
  - `supabase/functions/catalog-search/index.ts`
  - `supabase/functions/_shared/ebayBrowseSearch.ts`
  - `src/pages/shop/ProductDetails.tsx`
  - possibly `src/pages/shop/SearchResults.tsx` (ID/state robustness helpers)
- No schema migration is required for this fix set.
- Existing architecture (DB-first + provider fallback + media enrichment) remains; this plan hardens recall/relevance and failure behavior.

Expected outcome after implementation:
- Far fewer “No products found” false negatives.
- Better relevance (less unrelated noise from fallback).
- More consistent product image galleries after opening an item.
