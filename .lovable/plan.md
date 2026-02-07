

# AI-Powered Search Query Expansion

## Current Limitation

The search pipeline uses a hand-coded dictionary (~200 terms) for typo correction and a `search_rewrites` table for French-English translation. This fails for:
- Creative queries: "outfit for beach wedding" (no rewrite rule exists)
- Niche products: "solar panel kit for camping" (too specific for dictionary)
- Slang or regional terms: "frigo americain" (not in rewrite table)
- Descriptive queries: "gift for 10 year old boy who likes robots"

## Proposed Solution: AI Query Expansion Layer

Add a fast, non-blocking AI step between query normalization and DB search. The AI receives the user's query and returns 2-3 optimized English search terms suitable for eBay/Amazon product search.

```text
User query
    |
    v
[Existing] Normalize + Canonicalize (typo fix)
    |
    v
[NEW] AI Query Expansion (Lovable AI, ~500ms)
    |  Input: original query + canonicalized query
    |  Output: 2-3 English search keywords
    |
    v
[Existing] DB-first search (using expanded terms)
    |
    v
[Existing] Live provider fallback (eBay + Amazon)
```

## Architecture

### New edge function: `search-expand-query`

A small, dedicated function that calls Lovable AI (google/gemini-3-flash-preview) with a tight prompt:

- Input: `{ query: "frigo americain double porte", lang: "fr" }`
- Output: `{ expandedTerms: ["american fridge freezer", "double door refrigerator"], category: "appliances", confidence: 0.9 }`

**Why a separate function?** So catalog-search can call it with a 1-second timeout. If AI is slow or fails, search falls back to the existing canonicalizer (zero regression risk).

### Caching AI expansions

AI expansions are deterministic for the same input, so we cache them aggressively:
- Store in `search_query_expansions` table (query_normalized -> expanded_terms, TTL 7 days)
- Before calling AI, check cache first (sub-5ms)
- This means AI is only called once per unique query, then all subsequent searches for that query use the cached expansion

### Integration in catalog-search/index.ts

After the existing canonicalization step, add:

```text
1. Check search_query_expansions cache for this query
2. If cache hit: use cached expanded terms
3. If cache miss: call search-expand-query with 1s timeout
   - If AI responds: cache result, use expanded terms
   - If AI times out: fall back to canonicalized query (no regression)
4. Use expanded terms for DB ILIKE search + provider queries
```

The expanded terms are used alongside (not instead of) the original query to maximize results.

## Database Changes

New table: `search_query_expansions`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| query_normalized | text | Lowercase trimmed input (unique index) |
| source_lang | text | Detected language (fr/en) |
| expanded_terms | text[] | AI-generated search terms |
| category_hint | text | Optional category suggestion |
| confidence | numeric | AI confidence score |
| created_at | timestamptz | When cached |
| expires_at | timestamptz | TTL (7 days from creation) |

RLS: Public read (search is unauthenticated), service-role write only.

## AI Prompt Design

The prompt will be minimal and focused to keep latency low (~300-500ms):

```text
You are a product search optimizer for an African e-commerce site.
Given a user search query (possibly in French), return 2-3 English
product search terms that would find relevant results on Amazon/eBay.

Rules:
- Return specific, shoppable product terms (not categories)
- Preserve brand names and model numbers exactly
- If the query is already a good English product search, return it as-is
- Never return more than 3 terms

Query: "{user_query}"
Language: "{detected_lang}"
```

Response via tool calling (structured output) to guarantee JSON format.

## Timeout and Failure Strategy

| Scenario | Behavior |
|----------|----------|
| AI responds in < 1s | Use expanded terms for search |
| AI responds in 1-2s | Already timed out, search used fallback; cache result for next time |
| AI fails or errors | Use existing canonicalizer output (zero regression) |
| Cache hit | Skip AI entirely, use cached terms (~2ms) |

## Performance Impact

- First search for a new query: +300-500ms (AI call, runs concurrently with other setup)
- Repeat searches: +0ms (cached)
- Failure case: +0ms (falls back to current behavior)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/search-expand-query/index.ts` | Create | New edge function calling Lovable AI |
| `supabase/functions/catalog-search/index.ts` | Modify | Add AI expansion step after canonicalization |
| Database migration | Create | `search_query_expansions` table |

## What Does NOT Change

- Response JSON shape (same keys, same structure)
- Homepage endpoints (catalog-home)
- Cart, checkout, payments
- Existing canonicalizer and rewriter (still used as fallback)
- Cache-Control headers (recent fix preserved)
- Provider timeout logic (4s for eBay/Amazon unchanged)

## Expected Results

- "frigo americain" -> AI expands to ["american fridge freezer", "double door refrigerator"] -> finds appliances
- "cadeau garcon 10 ans robot" -> AI expands to ["robot toy for boys", "kids robot kit"] -> finds toys
- "tracteur agricole" -> AI expands to ["farm tractor", "agricultural tractor"] -> finds tractors
- "google pixel 11" -> AI returns ["google pixel phone"] -> works with existing number-token fix
- Unknown/niche query -> AI tries, but if it fails, existing search still runs (no regression)

