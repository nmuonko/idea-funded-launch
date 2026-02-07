/**
 * Search Expand Query - AI-powered query expansion
 * 
 * Takes a user search query (possibly in French) and returns 2-3 optimized
 * English product search terms using Lovable AI (Gemini).
 * 
 * POST /search-expand-query
 * Body: { query: string, lang?: string }
 * Response: { ok: true, expandedTerms: string[], categoryHint?: string, confidence: number }
 */

import { createAdminPostgrestClient } from "../_shared/postgrest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
    const { query, lang = "fr" } = await req.json();

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qNorm = query.trim().toLowerCase();
    const supabase = createAdminPostgrestClient();

    // 1. Check expansion cache first
    const { data: cached } = await supabase
      .from("search_query_expansions")
      .select("expanded_terms, category_hint, confidence")
      .eq("query_normalized", qNorm)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      console.log(`[EXPAND] cache_hit q="${qNorm}" terms=${JSON.stringify(cached.expanded_terms)} ms=${Date.now() - startMs}`);
      return new Response(JSON.stringify({
        ok: true,
        expandedTerms: cached.expanded_terms,
        categoryHint: cached.category_hint,
        confidence: cached.confidence,
        cached: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Call Lovable AI for expansion
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[EXPAND] LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({
        ok: true,
        expandedTerms: [qNorm],
        confidence: 0,
        fallback: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a product search optimizer for an African e-commerce site that sources from Amazon and eBay. Given a user search query (possibly in French or with typos), return 2-3 optimized English product search terms that would find relevant results on Amazon/eBay.

Rules:
- Return specific, shoppable product terms (not categories)
- Preserve brand names and model numbers exactly
- If the query is already a good English product search, return it as-is
- Never return more than 3 terms
- Terms should be concise (2-5 words each)
- Focus on what a user would type into Amazon search bar`,
          },
          {
            role: "user",
            content: `Query: "${query}"\nLanguage: "${lang}"`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "expand_search_query",
              description: "Return optimized English product search terms for the given query.",
              parameters: {
                type: "object",
                properties: {
                  terms: {
                    type: "array",
                    items: { type: "string" },
                    description: "2-3 optimized English product search terms",
                  },
                  category: {
                    type: "string",
                    description: "Optional product category hint (e.g., electronics, clothing, appliances)",
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score 0-1 that the expansion is accurate",
                  },
                },
                required: ["terms", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "expand_search_query" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`[EXPAND] AI error status=${status} body=${errText.substring(0, 200)}`);
      // Graceful fallback
      return new Response(JSON.stringify({
        ok: true,
        expandedTerms: [qNorm],
        confidence: 0,
        fallback: true,
        aiError: status,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    let expandedTerms: string[] = [qNorm];
    let categoryHint: string | null = null;
    let confidence = 0;

    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(args.terms) && args.terms.length > 0) {
          // Sanitize: trim, lowercase, remove empty, limit to 3
          expandedTerms = args.terms
            .map((t: string) => t.trim().toLowerCase())
            .filter((t: string) => t.length >= 2)
            .slice(0, 3);
          if (expandedTerms.length === 0) expandedTerms = [qNorm];
        }
        categoryHint = args.category || null;
        confidence = typeof args.confidence === "number" ? args.confidence : 0.5;
      } catch (parseErr) {
        console.warn("[EXPAND] Failed to parse AI tool call:", parseErr);
      }
    }

    const aiMs = Date.now() - startMs;
    console.log(`[EXPAND] ai_result q="${qNorm}" terms=${JSON.stringify(expandedTerms)} cat=${categoryHint} conf=${confidence} ms=${aiMs}`);

    // 3. Cache the expansion (fire and forget, use upsert)
    supabase
      .from("search_query_expansions")
      .upsert({
        query_normalized: qNorm,
        source_lang: lang,
        expanded_terms: expandedTerms,
        category_hint: categoryHint,
        confidence,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "query_normalized" })
      .then(({ error }) => {
        if (error) console.warn("[EXPAND] cache_write_error:", error.message);
        else console.log(`[EXPAND] cached q="${qNorm}"`);
      });

    return new Response(JSON.stringify({
      ok: true,
      expandedTerms,
      categoryHint,
      confidence,
      cached: false,
      durationMs: aiMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[EXPAND] error:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      expandedTerms: [],
      confidence: 0,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
