/**
 * AI Query Rewrite — French-first typo fix + translation + intent + expansions
 * 
 * Calls Lovable AI with structured output (tool calling) to produce a "search plan":
 * - corrected_query_fr, query_en, category_guess, year, brand, model
 * - expansions (3-8 variants), must_exclude, did_you_mean, confidence
 * 
 * Cache: checks search_rewrite_cache first (14-day TTL), writes on miss.
 * Fallback: returns null on any failure (caller falls back to deterministic pipeline).
 */

type SupabaseClientAny = any;

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_REWRITE_TIMEOUT_MS = 1200; // 1.2s hard budget

export interface AiRewriteResult {
  language: "fr" | "en" | "mixed";
  corrected_query_fr: string;
  query_en: string;
  category_guess: string | null;
  year: number | null;
  brand: string | null;
  model: string | null;
  expansions: string[];
  must_exclude: string[];
  did_you_mean: string | null;
  confidence: number;
  cached: boolean;
}

const SYSTEM_PROMPT = `You are an e-commerce search query optimizer for an African marketplace sourcing from Amazon and eBay.

RULES:
1. Most queries are in French. Fix typos first, then translate to English for provider search.
2. Preserve brand names and model numbers EXACTLY: iPhone 15, Galaxy S24, PS5, BMW X5, CG 125
3. category_guess must be one of: phones, electronics, audio_music, gaming, vehicles, home_garden, toys, sporting_goods, jewelry_watches, parts_accessories, refurbished, clothing, shoes_sneakers, cameras_photo, beauty_health, collectibles, or null if ambiguous
4. Generate 3-8 expansion queries (English) like eBay "Best Match then Similar":
   - First: exact corrected query
   - Then: without year, nearby years (±2), FR/EN synonyms, broader terms
   - Keep expansions SHORT (2-6 words each)
5. must_exclude: keywords to filter OUT junk results (e.g., for "gaming" exclude "laptop,monitor,keyboard"; for "vehicles" exclude "toy,model,poster,case")
6. did_you_mean: only set if query had a clear typo or if corrected form differs significantly from input
7. For vehicle brand+model queries (toyota prius, bmw x5), return the vehicle name as-is. Do NOT add "accessories" or "parts".
8. For phone queries without product type, add "phone" to query_en

EXAMPLES:
- "iphine 15" → corrected_query_fr: "iphone 15", query_en: "iphone 15", did_you_mean: "iphone 15", category_guess: "phones"
- "téléphone samsung a14" → corrected_query_fr: "téléphone samsung a14", query_en: "samsung galaxy a14 phone", category_guess: "phones"
- "2024 tesla model x" → query_en: "2024 tesla model x", year: 2024, brand: "tesla", model: "model x", expansions: ["2024 tesla model x","tesla model x","2023 tesla model x","tesla suv"]
- "écouteurs bluetooth" → query_en: "bluetooth earbuds", category_guess: "audio_music"
- "frigo samsung" → query_en: "samsung refrigerator", category_guess: "home_garden"
- "jeux ps5" → query_en: "ps5 games", category_guess: "gaming", must_exclude: ["laptop","monitor","keyboard"]`;

/**
 * AI-powered query rewrite with cache-first strategy.
 * Returns null on any failure — caller uses deterministic fallback.
 */
export async function aiQueryRewrite(
  supabase: SupabaseClientAny,
  qOriginal: string,
  lang: string,
  categoryHint: string | null,
  requestId: string,
): Promise<AiRewriteResult | null> {
  const qNorm = qOriginal.trim().toLowerCase().replace(/\s+/g, " ");
  if (qNorm.length < 2) return null;

  try {
    // 1. Check cache first (~5ms)
    const { data: cached } = await supabase
      .from("search_rewrite_cache")
      .select("payload")
      .eq("q_norm", qNorm)
      .eq("lang", lang)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.payload) {
      console.log(`[AI_REWRITE] requestId=${requestId} cache_hit q="${qNorm}"`);
      return { ...cached.payload, cached: true } as AiRewriteResult;
    }

    // 2. Budget gate — enforce daily AI call limit (Phase 5 cost optimization)
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.warn(`[AI_REWRITE] requestId=${requestId} LOVABLE_API_KEY not configured`);
      return null;
    }

    // Check daily AI budget (500 calls/day hard cap)
    const AI_DAILY_CAP = 500;
    try {
      const { data: budgetData } = await supabase
        .rpc("check_provider_budget", {
          p_provider: "lovable_ai",
          p_window_type: "daily",
          p_limit: AI_DAILY_CAP,
        });
      if (budgetData && !budgetData.allowed) {
        console.warn(`[AI_REWRITE] requestId=${requestId} BUDGET_EXCEEDED: daily AI cap hit (${budgetData.count}/${AI_DAILY_CAP}) — falling back to deterministic`);
        return null;
      }
    } catch (e) {
      // Budget check failed — allow through (fail-open)
      console.warn(`[AI_REWRITE] requestId=${requestId} budget_check_error: ${(e as Error).message}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REWRITE_TIMEOUT_MS);

    const userContent = categoryHint
      ? `Query: "${qOriginal}"\nUser language: "${lang}"\nCategory context: "${categoryHint}"`
      : `Query: "${qOriginal}"\nUser language: "${lang}"`;

    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "rewrite_search_query",
              description: "Return a structured search plan for an e-commerce query.",
              parameters: {
                type: "object",
                properties: {
                  language: { type: "string", enum: ["fr", "en", "mixed"] },
                  corrected_query_fr: { type: "string", description: "Typo-corrected version in original language" },
                  query_en: { type: "string", description: "English translation optimized for Amazon/eBay search (2-6 words)" },
                  category_guess: {
                    type: "string",
                    enum: ["phones", "electronics", "audio_music", "gaming", "vehicles", "home_garden", "toys", "sporting_goods", "jewelry_watches", "parts_accessories", "refurbished", "clothing", "shoes_sneakers", "cameras_photo", "beauty_health", "collectibles"],
                    description: "Best matching product category, or omit if ambiguous",
                  },
                  year: { type: "number", description: "Year mentioned in query (e.g. 2024), or null" },
                  brand: { type: "string", description: "Brand name if detected" },
                  model: { type: "string", description: "Model name/number if detected" },
                  expansions: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-8 alternative search queries: exact first, then progressively broader",
                  },
                  must_exclude: {
                    type: "array",
                    items: { type: "string" },
                    description: "Keywords to exclude from results to prevent category pollution",
                  },
                  did_you_mean: { type: "string", description: "Suggested correction if query had typos, null otherwise" },
                  confidence: { type: "number", description: "Confidence score 0-1" },
                },
                required: ["language", "corrected_query_fr", "query_en", "expansions", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "rewrite_search_query" } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`[AI_REWRITE] requestId=${requestId} AI error status=${status} body=${errText.substring(0, 200)}`);
      return null;
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.warn(`[AI_REWRITE] requestId=${requestId} no tool call in response`);
      return null;
    }

    const args = JSON.parse(toolCall.function.arguments);

    const result: AiRewriteResult = {
      language: args.language || "fr",
      corrected_query_fr: (args.corrected_query_fr || qNorm).trim().toLowerCase(),
      query_en: (args.query_en || qNorm).trim().toLowerCase(),
      category_guess: args.category_guess || null,
      year: typeof args.year === "number" ? args.year : null,
      brand: args.brand ? args.brand.trim() : null,
      model: args.model ? args.model.trim() : null,
      expansions: Array.isArray(args.expansions)
        ? args.expansions.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length >= 2).slice(0, 8)
        : [args.query_en || qNorm],
      must_exclude: Array.isArray(args.must_exclude)
        ? args.must_exclude.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length >= 2)
        : [],
      did_you_mean: args.did_you_mean ? args.did_you_mean.trim() : null,
      confidence: typeof args.confidence === "number" ? args.confidence : 0.5,
      cached: false,
    };

    console.log(`[AI_REWRITE] requestId=${requestId} q="${qOriginal}" → en="${result.query_en}" cat=${result.category_guess} dym="${result.did_you_mean}" expansions=${result.expansions.length} exclude=${result.must_exclude.length} conf=${result.confidence}`);

    // 3. Cache result (fire-and-forget, 30-day TTL — Phase 4 cost optimization)
    const cachePayload = { ...result };
    delete (cachePayload as any).cached;
    supabase
      .from("search_rewrite_cache")
      .upsert({
        q_norm: qNorm,
        lang,
        category_hint: result.category_guess,
        payload: cachePayload,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "q_norm,lang" })
      .then(({ error }: { error: any }) => {
        if (error) console.warn(`[AI_REWRITE] requestId=${requestId} cache_write_error: ${error.message}`);
      });

    return result;
  } catch (err) {
    const errName = (err as Error).name;
    if (errName === "AbortError") {
      console.warn(`[AI_REWRITE] requestId=${requestId} timeout after ${AI_REWRITE_TIMEOUT_MS}ms`);
    } else {
      console.warn(`[AI_REWRITE] requestId=${requestId} error: ${(err as Error).message}`);
    }
    return null;
  }
}
