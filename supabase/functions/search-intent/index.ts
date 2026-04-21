// AI-powered query intent classifier.
// Returns: { category, country_priority: string[], provider_priority: string[], is_fashion }
// Used by web search to route queries: USA → China → others (default), but
// fashion / clothing / shoes / beauty queries → China + Turkey only (skip USA).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const FASHION_KEYWORDS = [
  'dress', 'robe', 'shirt', 'chemise', 'pants', 'pantalon', 'jeans', 'skirt',
  'jupe', 'shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'sandal',
  'jacket', 'veste', 'coat', 'manteau', 'hoodie', 'sweater', 'pull', 'abaya',
  'kaftan', 'kimono', 'dashiki', 'boubou', 'lingerie', 'bra', 'underwear',
  'sock', 'socks', 'hat', 'cap', 'glove', 'belt', 'tie', 'suit', 'tuxedo',
  'blouse', 'top', 'tshirt', 't-shirt', 'polo', 'tracksuit', 'leggings',
  'shorts', 'fashion', 'mode', 'apparel', 'clothing', 'vetement', 'vêtement',
  'handbag', 'sac à main', 'purse', 'wallet', 'scarf', 'shawl',
  'perfume', 'parfum', 'cologne', 'makeup', 'cosmetic', 'lipstick',
  'foundation', 'mascara', 'beauty', 'beauté', 'skincare', 'lotion',
  'shampoo', 'conditioner',
];

function quickClassify(q: string): { is_fashion: boolean; is_phone_acc: boolean } {
  const lower = q.toLowerCase();
  const is_fashion = FASHION_KEYWORDS.some((kw) => lower.includes(kw));
  const phoneAccTerms = [
    'phone case', 'screen protector', 'tempered glass', 'charger', 'cable',
    'power bank', 'magsafe', 'airpods', 'earbuds', 'earphone', 'usb-c',
    'lightning cable', 'phone holder', 'phone mount', 'phone stand',
  ];
  const is_phone_acc = phoneAccTerms.some((kw) => lower.includes(kw));
  return { is_fashion, is_phone_acc };
}

function fallbackResponse(q: string) {
  const { is_fashion } = quickClassify(q);
  if (is_fashion) {
    return {
      category: 'clothing',
      is_fashion: true,
      country_priority: ['china', 'turkey'],
      provider_priority: ['shopify', 'international'],
      reasoning: 'fallback:fashion-keyword',
    };
  }
  return {
    category: 'all',
    is_fashion: false,
    country_priority: ['usa', 'china', 'dubai', 'turkey'],
    provider_priority: ['rainforest', 'amazon', 'ebay', 'shopify', 'international'],
    reasoning: 'fallback:default',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { q } = await req.json().catch(() => ({ q: '' }));
    const query = (q || '').toString().trim();

    if (!query) {
      return new Response(JSON.stringify(fallbackResponse('')), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // No AI key — return deterministic fallback.
      return new Response(JSON.stringify(fallbackResponse(query)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You classify e-commerce search queries for an African shopping app sourcing from USA, China, Dubai and Turkey.
Decide:
- category: one of [phones, electronics, audio_music, gaming, cameras_photo, jewelry_watches, refurbished, vehicles, clothing, shoes_sneakers, beauty_health, home_garden, toys, sporting_goods, all]
- is_fashion: true if the query is about clothing, shoes, fashion, beauty, perfume, cosmetics, handbags
- country_priority: ordered array of countries to search.
  * If is_fashion = true → ["china","turkey"] (skip USA & Dubai entirely)
  * Otherwise → ["usa","china","dubai","turkey"]
- provider_priority: ordered providers matching the countries.
  * Fashion → ["shopify","international"]
  * Otherwise → ["rainforest","amazon","ebay","shopify","international"]`;

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Query: "${query}"` },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'classify_query',
              description: 'Return search routing for the query',
              parameters: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  is_fashion: { type: 'boolean' },
                  country_priority: {
                    type: 'array',
                    items: { type: 'string', enum: ['usa', 'china', 'dubai', 'turkey'] },
                  },
                  provider_priority: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['category', 'is_fashion', 'country_priority', 'provider_priority'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'classify_query' } },
      }),
    });

    if (resp.status === 429 || resp.status === 402) {
      return new Response(JSON.stringify(fallbackResponse(query)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!resp.ok) {
      console.warn('[search-intent] AI gateway error', resp.status);
      return new Response(JSON.stringify(fallbackResponse(query)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify(fallbackResponse(query)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return new Response(JSON.stringify(fallbackResponse(query)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Safety: enforce fashion → china/turkey only even if AI says otherwise.
    const { is_fashion: heuristicFashion } = quickClassify(query);
    const isFashion = !!parsed.is_fashion || heuristicFashion;
    if (isFashion) {
      parsed.is_fashion = true;
      parsed.country_priority = ['china', 'turkey'];
      parsed.provider_priority = ['shopify', 'international'];
    } else {
      // Always lead with USA for non-fashion.
      const cp = Array.isArray(parsed.country_priority) ? parsed.country_priority : [];
      const filtered = cp.filter((c: string) =>
        ['usa', 'china', 'dubai', 'turkey'].includes(c)
      );
      const withUsaFirst = ['usa', ...filtered.filter((c: string) => c !== 'usa')];
      parsed.country_priority = Array.from(new Set(withUsaFirst));
      if (!Array.isArray(parsed.provider_priority) || parsed.provider_priority.length === 0) {
        parsed.provider_priority = ['rainforest', 'amazon', 'ebay', 'shopify', 'international'];
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[search-intent] error', err);
    return new Response(JSON.stringify(fallbackResponse('')), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
