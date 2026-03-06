import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { userId } = await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[predict-customer-ltv] Analyzing user:', userId);

    // Get user's order history
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        total_usd,
        created_at,
        order_items (
          store,
          total_price_usd,
          quantity
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (ordersError) throw ordersError;

    // Calculate behavioral metrics
    const completedOrders = (orders || []).filter(o => 
      ['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED'].includes(o.status)
    );
    const abandonedCarts = (orders || []).filter(o => 
      ['DRAFT', 'PENDING_PAYMENT'].includes(o.status)
    );

    const totalSpent = completedOrders.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);
    const avgOrderValue = completedOrders.length > 0 ? totalSpent / completedOrders.length : 0;
    const abandonedValue = abandonedCarts.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);
    
    // Calculate frequency
    let orderFrequencyDays = 0;
    if (completedOrders.length > 1) {
      const firstOrder = new Date(completedOrders[completedOrders.length - 1].created_at);
      const lastOrder = new Date(completedOrders[0].created_at);
      const daysBetween = (lastOrder.getTime() - firstOrder.getTime()) / (1000 * 60 * 60 * 24);
      orderFrequencyDays = daysBetween / (completedOrders.length - 1);
    }

    // Category preferences
    const categorySpending: Record<string, number> = {};
    completedOrders.forEach(order => {
      (order.order_items || []).forEach((item: any) => {
        const store = item.store || 'OTHER';
        categorySpending[store] = (categorySpending[store] || 0) + Number(item.total_price_usd || 0);
      });
    });

    const preferredCategories = Object.entries(categorySpending)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([cat, val]) => ({ category: cat, spent: val }));

    // Build AI prompt
    const prompt = `Analyze this customer's e-commerce behavior and predict their Lifetime Value (LTV):

Customer Metrics:
- Total Orders Completed: ${completedOrders.length}
- Total Revenue Generated: $${totalSpent.toFixed(2)}
- Average Order Value: $${avgOrderValue.toFixed(2)}
- Abandoned Carts: ${abandonedCarts.length} (worth $${abandonedValue.toFixed(2)})
- Order Frequency: ${orderFrequencyDays > 0 ? `Every ${orderFrequencyDays.toFixed(0)} days` : 'First-time or irregular'}
- Preferred Categories: ${preferredCategories.map(p => `${p.category} ($${p.spent.toFixed(2)})`).join(', ')}

Provide:
1. Predicted 12-month LTV in USD
2. Customer tier: Bronze (<$500), Silver ($500-$2000), Gold ($2000-$5000), Platinum (>$5000)
3. Risk level: Low, Medium, High (likelihood to churn)
4. Top 3 personalized recommendations to increase LTV

Format as JSON: { "predictedLTV": number, "tier": string, "riskLevel": string, "recommendations": string[] }`;

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are an e-commerce analytics expert. Respond ONLY with valid JSON, no markdown or extra text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'predict_ltv',
              description: 'Predict customer lifetime value based on behavior',
              parameters: {
                type: 'object',
                properties: {
                  predictedLTV: { type: 'number', description: '12-month predicted lifetime value in USD' },
                  tier: { type: 'string', enum: ['Bronze', 'Silver', 'Gold', 'Platinum'] },
                  riskLevel: { type: 'string', enum: ['Low', 'Medium', 'High'] },
                  recommendations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Top 3 recommendations to increase LTV',
                  },
                },
                required: ['predictedLTV', 'tier', 'riskLevel', 'recommendations'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'predict_ltv' } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add funds to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const prediction = JSON.parse(toolCall.function.arguments);

    console.log('[predict-customer-ltv] Prediction:', prediction);

    // Return analysis
    return new Response(
      JSON.stringify({
        userId,
        metrics: {
          completedOrders: completedOrders.length,
          totalSpent,
          avgOrderValue,
          abandonedCarts: abandonedCarts.length,
          abandonedValue,
          orderFrequencyDays,
          preferredCategories,
        },
        prediction,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[predict-customer-ltv] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});