

# Dynamic French-to-English Translation via OpenAI Responses API

## Overview

Add a non-blocking OpenAI translation layer to `catalog-search` that dynamically translates French queries to English before sending them to Amazon/eBay. Uses OpenAI's **Responses API** with **Structured Outputs** (`response_format` with `json_schema`, `strict: true`) for deterministic JSON results. Translations are cached in a new `query_translation_cache` table for 14 days. The static `FR_EN_FALLBACK` map stays as an instant fallback. Translation never blocks search (700ms hard timeout).

## Translation Flow

```text
User Query ("chaussure dame haut talon noir")
    |
[1] Normalize: lowercase, trim, collapse spaces, remove accents
    |
[2] DB Cache Lookup (query_translation_cache where expires_at > now())
    |---> HIT: use translated_query, increment hit_count async, X-Translate: HIT
    |
[3] Static FR_EN_FALLBACK (existing multi-match logic, unchanged)
    |---> HIT: use translation, write to cache as provider=static, X-Translate: STATIC
    |
[4] If still isFrenchLikely and no translation yet:
    OpenAI Responses API (gpt-4o-mini, 700ms AbortController timeout)
    |---> Success + not unchanged: save to cache, use translated query, X-Translate: MISS
    |---> Success + unchanged: don't cache, X-Translate: SKIP
    |---> Timeout: continue with original query, X-Translate: TIMEOUT
    |---> Error: continue with original query, X-Translate: ERROR
    |
[5] finalQuery used for:
    - buildCacheKey("search", { query: finalQuery })  -- unifies FR/EN cache
    - Provider search (Amazon/eBay get English query)
    - searchMeta.rewrittenQuery (client display)
```

## Changes

### A. Database Migration

**Create `query_translation_cache` table:**

```sql
CREATE TABLE public.query_translation_cache (
  source_lang TEXT NOT NULL DEFAULT 'auto',
  target_lang TEXT NOT NULL DEFAULT 'en',
  normalized_query TEXT NOT NULL,
  translated_query TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai:gpt-4o-mini:v1',
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source_lang, target_lang, normalized_query)
);

CREATE INDEX idx_qtc_expires ON public.query_translation_cache (expires_at);

ALTER TABLE public.query_translation_cache ENABLE ROW LEVEL SECURITY;
```

**Update `cleanup_all_expired_data()` to add:**

```sql
DELETE FROM public.query_translation_cache WHERE expires_at < now();
GET DIAGNOSTICS v_translation_cache_deleted = ROW_COUNT;
```

And include `translation_cache_deleted` in the returned JSON + add it to the `totalCleaned` sum.

**Update `cleanup-expired-data` edge function** to include the new field in the result type.

---

### B. New File: `supabase/functions/_shared/queryTranslator.ts` (~100 lines)

Three exported functions:

**`lookupTranslationCache(supabase, normalizedQuery)`**
- Uses `createAdminPostgrestClient()` (service role, bypasses RLS)
- Queries `query_translation_cache` for `(source_lang='auto', target_lang='en', normalized_query=normalizedQuery)` where `expires_at > now()`
- On hit: returns `{ translatedQuery, sourceLang, provider }`, fires off async `hit_count` increment (no await)
- On miss: returns `null`

**`callOpenAiTranslation(query, requestId)`**
- Calls `POST https://api.openai.com/v1/responses` with `gpt-4o-mini`
- Uses the corrected Responses API shape:
  ```typescript
  {
    model: "gpt-4o-mini",
    instructions: "Translate this e-commerce search query to English for Amazon/eBay product search. If already English, set unchanged=true.",
    input: query,
    temperature: 0,
    max_output_tokens: 60,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "translation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            translated_query: { type: "string" },
            source_lang: { type: "string" },
            unchanged: { type: "boolean" },
          },
          required: ["translated_query", "source_lang", "unchanged"],
          additionalProperties: false,
        },
      },
    },
  }
  ```
- Uses `AbortController` with 700ms timeout
- Reads `OPENAI_API_KEY` from `Deno.env`
- Returns `{ translated_query, source_lang, unchanged } | null` on timeout/error

**`writeTranslationCache(supabase, normalizedQuery, translatedQuery, sourceLang, provider)`**
- Uses `createAdminPostgrestClient()` for upsert
- Sets `expires_at` to 14 days from now
- Skips insert if `translatedQuery === normalizedQuery` (unchanged/already English)
- Fire-and-forget (caller does not need to await)

---

### C. Modify: `supabase/functions/catalog-search/index.ts`

**1. Add import** at the top (around line 38):
```typescript
import { lookupTranslationCache, callOpenAiTranslation, writeTranslationCache } from "../_shared/queryTranslator.ts";
```

**2. Add translation variables** after `let frFallbackApplied = false;` (line 489):
```typescript
let translateStatus = "SKIP";  // HIT|MISS|STATIC|SKIP|TIMEOUT|ERROR
let translateMs = 0;
let translateProvider = "";
```

**3. Insert DB cache lookup** at the start of the `if (!searchMeta.rewriteApplied || ...)` block (line 492), before the static fallback:
- Call `lookupTranslationCache(supabase, qNormLower)` 
- If hit: set `qNorm`, `searchMeta.rewrittenQuery`, `frFallbackApplied`, `translateStatus = "HIT"`, and skip the static fallback entirely

**4. After static fallback success** (around line 522, inside the `if (anyMatch)` block):
- Set `translateStatus = "STATIC"`, `translateProvider = "static"`
- Fire-and-forget `writeTranslationCache(supabase, qNormLower, qNorm, "fr", "static")`

**5. After the static fallback block** (line 525), if `isFrenchLikely && !frFallbackApplied`:
- Call `callOpenAiTranslation(qNormLower, requestId)` with timing
- If success and `!result.unchanged`: set `qNorm = result.translated_query`, update `searchMeta`, `translateStatus = "MISS"`, `translateProvider = "openai:gpt-4o-mini:v1"`, fire-and-forget `writeTranslationCache(...)`
- If success and `result.unchanged`: `translateStatus = "SKIP"` (don't cache)
- If null (timeout/error): `translateStatus = "TIMEOUT"` or `"ERROR"`, continue with original query

**6. Add translation headers** to all response paths (line 1231-1234):
```typescript
responseHeaders["X-Translate"] = translateStatus;
responseHeaders["X-Translate-Ms"] = String(translateMs);
responseHeaders["X-Translate-Provider"] = translateProvider;
```

**7. Update `Access-Control-Expose-Headers`** (line 1234) to include the new headers:
```typescript
responseHeaders["Access-Control-Expose-Headers"] = "..., X-Translate, X-Translate-Ms, X-Translate-Provider";
```

Note: `X-Translate-Lang` is logged only (not in headers) to avoid leaking user data.

---

### D. Modify: `supabase/functions/cleanup-expired-data/index.ts`

Add `translation_cache_deleted` to the result type interface and the `totalCleaned` sum.

---

### E. Redeploy

Redeploy `catalog-search` and `cleanup-expired-data` edge functions.

---

## Key Design Decisions

1. **Responses API with `response_format`** (not `text.format`) -- ensures strict JSON output every time, no parse-failure fallback needed.
2. **Provider version in cache** (`openai:gpt-4o-mini:v1`) -- changing model/version auto-invalidates old entries (different `provider` value, but same primary key means upsert overwrites).
3. **Skip caching unchanged queries** -- if OpenAI says `unchanged: true`, the query is already English; don't waste cache rows.
4. **French detection stays local** -- existing `isFrenchLikely` heuristic (accents + `lang=fr`) gates whether OpenAI is called. English queries never hit OpenAI.
5. **Service role for all cache ops** -- `createAdminPostgrestClient()` uses `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS.
6. **Static fallback writes to cache** -- subsequent identical queries get a fast DB cache hit (~5ms) instead of re-running the multi-match loop.
7. **Cache key unification is automatic** -- `buildCacheKey("search", { query: qNorm })` already uses `qNorm`, which is now the translated English query. "chaussure femme" and "women shoes" will share the same result cache.

## Performance Budget

| Scenario | Added Latency |
|---|---|
| DB cache HIT | ~5ms |
| Static fallback HIT | ~0ms + async cache write |
| OpenAI success | ~300-500ms |
| OpenAI timeout | 700ms max |
| English query (SKIP) | ~0ms (no translation attempted) |

## Files Changed

- **New migration**: `query_translation_cache` table + `cleanup_all_expired_data()` update
- **New file**: `supabase/functions/_shared/queryTranslator.ts`
- **Modified**: `supabase/functions/catalog-search/index.ts` -- import, translation step, headers
- **Modified**: `supabase/functions/cleanup-expired-data/index.ts` -- add new field to result type

