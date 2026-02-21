/**
 * Query Translator — FR→EN translation for search queries
 * 
 * Uses a 3-tier strategy:
 * 1. DB cache lookup (query_translation_cache, 14-day TTL)
 * 2. Static FR_EN_FALLBACK (handled by caller, written to cache as provider=static)
 * 3. OpenAI Responses API (gpt-4o-mini, 700ms timeout, structured output)
 */

import { createAdminPostgrestClient } from "./postgrest.ts";

export interface TranslationCacheHit {
  translatedQuery: string;
  sourceLang: string;
  provider: string;
}

export interface OpenAiTranslationResult {
  translated_query: string;
  source_lang: string;
  unchanged: boolean;
}

// ─── DB CACHE LOOKUP ─────────────────────────────────────────────────────────

export async function lookupTranslationCache(
  normalizedQuery: string,
  requestId: string,
): Promise<TranslationCacheHit | null> {
  try {
    const client = createAdminPostgrestClient();
    const { data, error } = await client
      .from("query_translation_cache")
      .select("translated_query, source_lang, provider")
      .eq("source_lang", "auto")
      .eq("target_lang", "en")
      .eq("normalized_query", normalizedQuery)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .execute();

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const row = data[0] as { translated_query: string; source_lang: string; provider: string };

    // Fire-and-forget hit_count increment (reuse existing client)
    client
      .from("query_translation_cache")
      .update({ hit_count: (row as any).hit_count ? (row as any).hit_count + 1 : 1 })
      .eq("source_lang", "auto")
      .eq("target_lang", "en")
      .eq("normalized_query", normalizedQuery)
      .execute()
      .catch(() => {});

    console.log(`[TRANSLATE] requestId=${requestId} CACHE_HIT provider=${row.provider} "${normalizedQuery}" → "${row.translated_query}"`);

    return {
      translatedQuery: row.translated_query,
      sourceLang: row.source_lang,
      provider: row.provider,
    };
  } catch (e) {
    console.warn(`[TRANSLATE] requestId=${requestId} cache lookup error:`, (e as Error).message);
    return null;
  }
}

// ─── OPENAI RESPONSES API ────────────────────────────────────────────────────

const TRANSLATION_TIMEOUT_MS = 700;

export async function callOpenAiTranslation(
  query: string,
  requestId: string,
): Promise<OpenAiTranslationResult | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn(`[TRANSLATE] requestId=${requestId} OPENAI_API_KEY not set`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        instructions: "Translate this e-commerce search query to English for Amazon/eBay product search. If already English, set unchanged=true.",
        input: query,
        temperature: 0,
        max_output_tokens: 60,
        text: {
          format: {
            type: "json_schema",
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
      }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[TRANSLATE] requestId=${requestId} OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const body = await res.json();
    // Responses API returns output[0].content[0].text for structured output
    const outputText = body?.output?.[0]?.content?.[0]?.text;
    if (!outputText) {
      console.warn(`[TRANSLATE] requestId=${requestId} OpenAI empty output`);
      return null;
    }

    const parsed = JSON.parse(outputText) as OpenAiTranslationResult;
    console.log(`[TRANSLATE] requestId=${requestId} OpenAI result: "${query}" → "${parsed.translated_query}" lang=${parsed.source_lang} unchanged=${parsed.unchanged}`);
    return parsed;
  } catch (e) {
    clearTimeout(timer);
    const isAbort = (e as Error).name === "AbortError";
    console.warn(`[TRANSLATE] requestId=${requestId} OpenAI ${isAbort ? "TIMEOUT" : "ERROR"}: ${(e as Error).message}`);
    return null;
  }
}

// ─── CACHE WRITE ─────────────────────────────────────────────────────────────

const CACHE_TTL_DAYS = 14;

export function writeTranslationCache(
  normalizedQuery: string,
  translatedQuery: string,
  sourceLang: string,
  provider: string,
  requestId: string,
): void {
  // Skip caching if translation is unchanged (already English)
  if (translatedQuery === normalizedQuery) {
    return;
  }

  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const client = createAdminPostgrestClient();
    client
      .from("query_translation_cache")
      .upsert(
        {
          source_lang: "auto",
          target_lang: "en",
          normalized_query: normalizedQuery,
          translated_query: translatedQuery,
          provider,
          hit_count: 0,
          expires_at: expiresAt,
        },
        { onConflict: "source_lang,target_lang,normalized_query" }
      )
      .execute()
      .then(() => {
        console.log(`[TRANSLATE] requestId=${requestId} cached: "${normalizedQuery}" → "${translatedQuery}" provider=${provider}`);
      })
      .catch((err) => {
        console.warn(`[TRANSLATE] requestId=${requestId} cache write failed:`, (err as Error).message);
      });
  } catch (e) {
    console.warn(`[TRANSLATE] requestId=${requestId} cache write error:`, (e as Error).message);
  }
}
