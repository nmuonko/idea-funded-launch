/**
 * Search Query Refiner — AI-powered query refinement
 * 
 * Takes a user search query (possibly with typos, French, slang, mixed case)
 * and returns a clean, provider-friendly search string plus alternatives.
 * 
 * POST /search-expand-query
 * Body: { query: string, lang?: string }
 * Response: { ok: true, refined: string, alt: string[], detectedLanguage: string, confidence: number }
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

    if (cached && cached.expanded_terms?.length > 0) {
      console.log(`[REFINER] cache_hit q="${qNorm}" refined="${cached.expanded_terms[0]}" ms=${Date.now() - startMs}`);
      return new Response(JSON.stringify({
        ok: true,
        refined: cached.expanded_terms[0],
        expandedTerms: cached.expanded_terms,
        alt: cached.expanded_terms.slice(1),
        categoryHint: cached.category_hint,
        confidence: cached.confidence,
        cached: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Call Lovable AI for refinement
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[REFINER] LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({
        ok: true,
        refined: qNorm,
        expandedTerms: [qNorm],
        alt: [],
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
            content: `You are a product search query refiner for an African e-commerce site that sources from Amazon and eBay.

Given a user search query (possibly with typos, in French, slang, or mixed case), return a refined English search query optimized for Amazon/eBay product search.

RULES:
- Fix typos: toytoa→toyota, iphne→iphone, samsun→samsung, ecouteur→earbuds
- Normalize case: PS5, iPhone 15, BMW X5
- Translate French→English ONLY when it helps search: écouteurs bluetooth→bluetooth earbuds, coque iphone→iphone case
- Keep brand names and model numbers EXACT: iPhone 11, Galaxy S24, CG 125, BMW X5, 150cc
- Do NOT invent products; only clean/rewrite the query
- Keep refined query SHORT (2-6 words) for best provider results
- For phone brands (pixel, iphone, samsung, galaxy, xiaomi, etc.), add "phone" if no other product type specified
- For vehicle brands (toyota, bmw, mercedes, etc.), keep as-is unless clearly about accessories
- Return 1-3 alternative queries that cover different search angles

EXAMPLES:
- "google pixel" → refined: "google pixel phone"
- "toytoa" → refined: "toyota"
- "toyoTA" → refined: "toyota"  
- "iphne 15 pro" → refined: "iphone 15 pro"
- "écouteurs bluetooth" → refined: "bluetooth earbuds"
- "coque samsung s24" → refined: "samsung galaxy s24 phone case"
- "ps5" → refined: "playstation 5 console"
- "frigo" → refined: "refrigerator"
- "tracteur agricole" → refined: "farm tractor"`,
          },
          {
            role: "user",
            content: `Query: "${query}"\nUser language: "${lang}"`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "refine_search_query",
              description: "Return a refined product search query and alternatives.",
              parameters: {
                type: "object",
                properties: {
                  refined: {
                    type: "string",
                    description: "The primary refined English search query (2-6 words, optimized for Amazon/eBay)",
                  },
                  alt: {
                    type: "array",
                    items: { type: "string" },
                    description: "1-3 alternative search queries covering different angles",
                  },
                  detectedLanguage: {
                    type: "string",
                    enum: ["en", "fr", "mixed"],
                    description: "Detected language of the original query",
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score 0-1 that the refinement is accurate",
                  },
                },
                required: ["refined", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "refine_search_query" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`[REFINER] AI error status=${status} body=${errText.substring(0, 200)}`);
      return new Response(JSON.stringify({
        ok: true,
        refined: qNorm,
        expandedTerms: [qNorm],
        alt: [],
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

    let refined: string = qNorm;
    let alt: string[] = [];
    let detectedLanguage: string = "en";
    let confidence = 0;

    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (args.refined && typeof args.refined === "string" && args.refined.trim().length >= 2) {
          refined = args.refined.trim().toLowerCase();
        }
        if (Array.isArray(args.alt)) {
          alt = args.alt
            .map((t: string) => t.trim().toLowerCase())
            .filter((t: string) => t.length >= 2 && t !== refined)
            .slice(0, 3);
        }
        detectedLanguage = args.detectedLanguage || "en";
        confidence = typeof args.confidence === "number" ? args.confidence : 0.5;
      } catch (parseErr) {
        console.warn("[REFINER] Failed to parse AI tool call:", parseErr);
      }
    }

    // Build expandedTerms for backward compatibility
    const expandedTerms = [refined, ...alt].slice(0, 3);

    const aiMs = Date.now() - startMs;
    console.log(`[REFINER] q="${qNorm}" refined="${refined}" alt=${JSON.stringify(alt)} lang=${detectedLanguage} conf=${confidence} ms=${aiMs}`);

    // 3. Cache the refinement (fire and forget)
    supabase
      .from("search_query_expansions")
      .upsert({
        query_normalized: qNorm,
        source_lang: lang,
        expanded_terms: expandedTerms,
        category_hint: null,
        confidence,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "query_normalized" })
      .then(({ error }: { error: any }) => {
        if (error) console.warn("[REFINER] cache_write_error:", error.message);
        else console.log(`[REFINER] cached q="${qNorm}"`);
      });

    return new Response(JSON.stringify({
      ok: true,
      refined,
      expandedTerms,
      alt,
      detectedLanguage,
      categoryHint: null,
      confidence,
      cached: false,
      durationMs: aiMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[REFINER] error:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      refined: "",
      expandedTerms: [],
      alt: [],
      confidence: 0,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
