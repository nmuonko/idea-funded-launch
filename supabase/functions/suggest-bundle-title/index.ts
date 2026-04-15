import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { products } = await req.json();
    if (!products?.length) {
      return new Response(JSON.stringify({ error: "products array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const productList = products.map((p: { title: string; price_usd: number }, i: number) =>
      `${i + 1}. ${p.title} ($${p.price_usd})`
    ).join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_titles",
              description: "Return 3 short catchy bundle title suggestions for an African e-commerce shop.",
              parameters: {
                type: "object",
                properties: {
                  titles: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 3,
                    maxItems: 3,
                  },
                },
                required: ["titles"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_titles" } },
        messages: [
          {
            role: "system",
            content: "Tu es un assistant marketing pour AfriShop, une boutique e-commerce africaine qui livre depuis les USA. Suggère 3 titres courts et accrocheurs (max 8 mots chacun) EN FRANÇAIS pour un pack de produits. Inclus le prix total du pack dans chaque titre. Sois créatif et orienté vente.",
          },
          {
            role: "user",
            content: `Voici les produits dans ce pack :\n${productList}\n\nPrix total : $${products.reduce((s: number, p: { price_usd: number }) => s + p.price_usd, 0).toFixed(0)}\n\nSuggère 3 titres accrocheurs en français avec le prix.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI suggestion failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    let titles: string[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        titles = parsed.titles || [];
      } catch { /* fallback below */ }
    }

    if (!titles.length) {
      // Fallback: try content
      const content = result.choices?.[0]?.message?.content?.trim() || "";
      titles = content.split("\n").filter((l: string) => l.trim()).slice(0, 3);
    }

    return new Response(JSON.stringify({ titles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-bundle-title error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
