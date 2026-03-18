/**
 * AI Query Interpreter — Structured fallback for weak/ambiguous search queries.
 *
 * Called ONLY when the fallback gate determines first-pass results are insufficient.
 * Uses single Lovable AI provider (Phase 1 cost optimization — removed dual-race pattern).
 *
 * Key design:
 *  - Cache-first (search_rewrite_cache, 30-day TTL)
 *  - 1.5s hard timeout
 *  - Preserves protected entities (brands, models, product codes)
 *  - Returns structured interpretation, NOT final search results
 */

import { createAdminPostgrestClient } from "./postgrest.ts";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const INTERPRETER_TIMEOUT_MS = 1500;

export interface AiInterpretation {
  language: "fr" | "en" | "mixed" | "unknown";
  intent: string;
  normalized_query: string;
  protected_entities: string[];
  attributes: {
    brand?: string;
    category?: string;
    subcategory?: string;
    condition?: string;
    color?: string;
    gender?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    year?: string;
    price_intent?: string;
    storage?: string;
    size?: string;
  };
  expanded_queries: string[];
  search_strategy: string;
  confidence: number;
  cached: boolean;
  ai_provider?: string;
}

const SYSTEM_PROMPT = `You are an e-commerce search query interpreter for an African marketplace (sources: Amazon, eBay).

Your job is to produce a structured interpretation of the user's search query to help the search engine find the best results.

CRITICAL RULES:
1. Most queries are in French or mixed French-English. Normalize to English for search.
2. PRESERVE brand names and model numbers EXACTLY: iPhone 15, Samsung Galaxy, Toyota Corolla, PS5, MacBook Air, RTX 4090
3. Only translate surrounding descriptors, NOT the brand/model entities.
4. Generate 2-5 expanded search queries (English), ordered by confidence:
   - First: most precise interpretation
   - Then: progressively broader/alternative phrasings
   - Keep each 2-6 words
5. Detect price intent from words like "pas cher" (cheap/budget), "luxe" (luxury), "occasion" (used/pre-owned)
6. Detect condition from "occasion" (used), "neuf" (new), "reconditionné" (refurbished)

EXAMPLES:
- "galaxy pliable" → intent: product_search, normalized: "samsung galaxy z fold", brand: "Samsung", expanded: ["samsung galaxy z fold", "samsung galaxy z flip", "foldable phone samsung"]
- "telephone samsung pas cher" → intent: product_search, normalized: "samsung phone budget", brand: "Samsung", price_intent: "budget", expanded: ["samsung phone", "cheap samsung phone", "samsung galaxy budget"]
- "toyota occasion" → intent: vehicle_search, normalized: "used toyota", vehicle_make: "Toyota", condition: "used", expanded: ["used toyota", "pre-owned toyota", "toyota for sale"]
- "piece corolla 2012" → intent: parts_search, normalized: "toyota corolla 2012 parts", vehicle_make: "Toyota", vehicle_model: "Corolla", year: "2012", expanded: ["toyota corolla 2012 parts", "corolla 2012 auto parts", "toyota corolla parts"]
- "ordinateur portable lenovo" → intent: product_search, normalized: "lenovo laptop", brand: "Lenovo", category: "electronics", expanded: ["lenovo laptop", "lenovo notebook", "lenovo computer"]
- "chaussure nike homme" → intent: product_search, normalized: "nike men shoes", brand: "Nike", gender: "men", expanded: ["nike men shoes", "nike sneakers men", "nike footwear men"]
- "robe femme elegante" → intent: product_search, normalized: "elegant women dress", gender: "women", expanded: ["elegant women dress", "formal dress women", "evening dress"]
- "iphone occasion" → intent: product_search, normalized: "used iphone", brand: "Apple", condition: "used", expanded: ["used iphone", "refurbished iphone", "pre-owned iphone"]
- "frigo double porte" → intent: product_search, normalized: "french door refrigerator", category: "home_garden", expanded: ["french door refrigerator", "double door fridge", "side by side refrigerator"]
- "television samsung" → intent: product_search, normalized: "samsung tv", brand: "Samsung", expanded: ["samsung tv", "samsung smart tv", "samsung television"]
- "pc gamer asus" → intent: product_search, normalized: "asus gaming pc", brand: "Asus", expanded: ["asus gaming laptop", "asus gaming pc", "asus rog gaming"]`;

const TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "interpret_search_query",
    description: "Return a structured interpretation of a search query for e-commerce product search.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["fr", "en", "mixed", "unknown"] },
        intent: {
          type: "string",
          enum: ["product_search", "category_search", "brand_search", "vehicle_search", "parts_search", "unknown"],
        },
        normalized_query: { type: "string", description: "Clean English normalized search string (2-8 words)" },
        protected_entities: {
          type: "array",
          items: { type: "string" },
          description: "Brand names, model numbers, product codes that must be preserved exactly",
        },
        attributes: {
          type: "object",
          properties: {
            brand: { type: "string" },
            category: { type: "string" },
            subcategory: { type: "string" },
            condition: { type: "string" },
            color: { type: "string" },
            gender: { type: "string" },
            vehicle_make: { type: "string" },
            vehicle_model: { type: "string" },
            year: { type: "string" },
            price_intent: { type: "string" },
            storage: { type: "string" },
            size: { type: "string" },
          },
          additionalProperties: false,
        },
        expanded_queries: {
          type: "array",
          items: { type: "string" },
          description: "2-5 alternative search queries in English, ordered by confidence (most precise first)",
        },
        search_strategy: {
          type: "string",
          enum: ["exact_first", "broadened", "category_boost", "brand_boost", "semantic_fallback"],
        },
        confidence: { type: "number", description: "Confidence score 0-1" },
      },
      required: ["language", "intent", "normalized_query", "expanded_queries", "confidence"],
      additionalProperties: false,
    },
  },
};

/** Parse tool-call response from either provider into AiInterpretation */
function parseToolCallResponse(aiData: any, qNorm: string, provider: string): AiInterpretation {
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    throw new Error(`No tool call in ${provider} response`);
  }

  const args = JSON.parse(toolCall.function.arguments);

  return {
    language: args.language || "unknown",
    intent: args.intent || "product_search",
    normalized_query: (args.normalized_query || qNorm).trim().toLowerCase(),
    protected_entities: Array.isArray(args.protected_entities)
      ? args.protected_entities.map((e: string) => e.trim()).filter((e: string) => e.length > 0)
      : [],
    attributes: args.attributes || {},
    expanded_queries: Array.isArray(args.expanded_queries)
      ? args.expanded_queries
          .map((q: string) => q.trim().toLowerCase())
          .filter((q: string) => q.length >= 2)
          .slice(0, 5)
      : [args.normalized_query || qNorm],
    search_strategy: args.search_strategy || "exact_first",
    confidence: typeof args.confidence === "number" ? args.confidence : 0.5,
    cached: false,
    ai_provider: provider,
  };
}

/** Fire a single AI provider request with its own abort timeout */
async function callProvider(
  url: string,
  apiKey: string,
  model: string,
  providerName: string,
  userContent: string,
  qNorm: string,
  requestId: string,
): Promise<AiInterpretation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTERPRETER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [TOOL_DEFINITION],
        tool_choice: { type: "function", function: { name: "interpret_search_query" } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${providerName} HTTP ${response.status}: ${errText.substring(0, 200)}`);
    }

    const aiData = await response.json();
    return parseToolCallResponse(aiData, qNorm, providerName);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Interpret a search query using AI. Returns structured interpretation or null on failure.
 * Uses dual-provider race: Lovable AI + OpenAI fire simultaneously via Promise.any().
 * Whichever responds first wins. Zero added latency. Full failover.
 */
export async function interpretQuery(
  rawQuery: string,
  lang: string,
  categoryHint: string | null,
  requestId: string,
): Promise<AiInterpretation | null> {
  const qNorm = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (qNorm.length < 2) return null;

  try {
    // ─── Cache check ─────────────────────────────────────────────────────────
    const client = createAdminPostgrestClient();
    const cacheKey = `interp:${qNorm}:${lang}`;

    const { data: cached } = await client
      .from("search_rewrite_cache")
      .select("payload")
      .eq("q_norm", cacheKey)
      .eq("lang", lang)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .execute();

    if (cached && Array.isArray(cached) && cached.length > 0 && cached[0].payload) {
      console.log(`[AI_INTERP] requestId=${requestId} CACHE_HIT q="${qNorm}"`);
      return { ...cached[0].payload, cached: true } as AiInterpretation;
    }

    // ─── Build provider list (single provider only — Phase 1 cost optimization) ─
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      console.warn(`[AI_INTERP] requestId=${requestId} LOVABLE_API_KEY not configured`);
      return null;
    }

    const userContent = categoryHint
      ? `Query: "${rawQuery}"\nUser language: "${lang}"\nCategory context: "${categoryHint}"\nFirst-pass search returned insufficient results. Interpret this query for a second-pass search.`
      : `Query: "${rawQuery}"\nUser language: "${lang}"\nFirst-pass search returned insufficient results. Interpret this query for a second-pass search.`;

    // Single provider call — removed dual-race pattern (OpenAI) to cut AI costs
    let result: AiInterpretation;
    try {
      result = await callProvider(LOVABLE_AI_URL, LOVABLE_API_KEY, "google/gemini-2.5-flash-lite", "lovable", userContent, qNorm, requestId);
    } catch (err) {
      const errName = (err as Error).name;
      if (errName === "AbortError") {
        console.warn(`[AI_INTERP] requestId=${requestId} provider timeout after ${INTERPRETER_TIMEOUT_MS}ms`);
      } else {
        console.warn(`[AI_INTERP] requestId=${requestId} provider error: ${(err as Error).message}`);
      }
      return null;
    }

    console.log(`[AI_INTERP] requestId=${requestId} q="${rawQuery}" → normalized="${result.normalized_query}" intent=${result.intent} strategy=${result.search_strategy} expansions=${result.expanded_queries.length} conf=${result.confidence} provider=${result.ai_provider}`);

    // ─── Cache result (fire-and-forget, 30-day TTL — Phase 4 cost optimization) ─
    const cachePayload = { ...result };
    delete (cachePayload as any).cached;
    client
      .from("search_rewrite_cache")
      .upsert({
        q_norm: cacheKey,
        lang,
        category_hint: result.attributes.category || null,
        payload: cachePayload,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "q_norm,lang" })
      .execute()
      .catch((err: any) => {
        console.warn(`[AI_INTERP] requestId=${requestId} cache_write_error: ${err?.message || err}`);
      });

    return result;
  } catch (err) {
    console.warn(`[AI_INTERP] requestId=${requestId} unexpected error: ${(err as Error).message}`);
    return null;
  }
}