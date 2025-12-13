import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Recommendation {
  productUrl: string;
  title: string;
  reason: string;
  score: number;
  store: string;
  estimatedPrice?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth header to identify user
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;

    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    const { context = 'homepage', cartItems = [], forceRefresh = false } = await req.json();

    // Check for cached recommendations
    if (userId && !forceRefresh) {
      const { data: cached } = await supabase
        .from('product_recommendations')
        .select('*')
        .eq('user_id', userId)
        .eq('context', context)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (cached) {
        return new Response(
          JSON.stringify({
            success: true,
            recommendations: cached.recommendations,
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Gather user context
    let purchaseHistory: any[] = [];
    let cartContext = '';

    if (userId) {
      // Get purchase history
      const { data: orders } = await supabase
        .from('orders')
        .select(`
          id,
          created_at,
          total_usd,
          order_items (
            title,
            store,
            unit_price_usd,
            product_url
          )
        `)
        .eq('user_id', userId)
        .not('status', 'eq', 'DRAFT')
        .order('created_at', { ascending: false })
        .limit(10);

      purchaseHistory = orders || [];
    }

    // Build context from cart items if provided
    if (cartItems.length > 0) {
      cartContext = cartItems.map((item: any) => `${item.title} (${item.store})`).join(', ');
    }

    // Get popular products from recent orders for collaborative filtering
    const { data: popularProducts } = await supabase
      .from('order_items')
      .select('title, store, product_url, unit_price_usd')
      .not('title', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);

    const uniqueProducts = new Map();
    popularProducts?.forEach((p: any) => {
      if (p.title && !uniqueProducts.has(p.product_url)) {
        uniqueProducts.set(p.product_url, p);
      }
    });

    const recentProducts = Array.from(uniqueProducts.values()).slice(0, 20);

    // Build AI prompt
    const purchaseHistoryText = purchaseHistory.length > 0
      ? purchaseHistory.flatMap(o => o.order_items?.map((i: any) => `${i.title} from ${i.store} ($${i.unit_price_usd})`)).filter(Boolean).join('\n')
      : 'No purchase history';

    const popularProductsText = recentProducts.map((p: any) => `${p.title} from ${p.store}`).join('\n');

    const prompt = `Generate personalized product recommendations.

CONTEXT: ${context}
${cartContext ? `CURRENT CART: ${cartContext}` : ''}

CUSTOMER PURCHASE HISTORY:
${purchaseHistoryText}

POPULAR PRODUCTS (from other customers):
${popularProductsText}

Generate 5 product recommendations. Respond with ONLY a JSON array (no markdown):
[
  {
    "productUrl": "https://example.com/product (use real product URLs from Amazon, Walmart, BestBuy, or other major retailers)",
    "title": "Product name",
    "reason": "Brief personalized reason why this is recommended",
    "score": 0.0-1.0 (relevance score),
    "store": "AMAZON" | "WALMART" | "BESTBUY" | "EBAY" | "OTHER",
    "estimatedPrice": estimated price in USD
  }
]

Recommendations should:
- Be relevant to ${context === 'cart' ? 'complement cart items' : context === 'post_purchase' ? 'be accessories or related items' : 'match customer preferences'}
- Include mix of stores (Amazon, Walmart, BestBuy)
- Be realistic products that exist
- Consider price range from purchase history
- For cart context: suggest complementary items, not duplicates`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert e-commerce recommendation engine. Generate relevant, personalized product recommendations.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error(`AI API error: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No AI content received');
    }

    let recommendations: Recommendation[];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      recommendations = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, content);
      throw new Error('Failed to parse recommendations');
    }

    // Cache recommendations for authenticated users
    if (userId) {
      await supabase
        .from('product_recommendations')
        .insert({
          user_id: userId,
          recommendations,
          context,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        recommendations,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in smart-recommendations:', error);
    return new Response(
      JSON.stringify({ error: error.message, recommendations: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
