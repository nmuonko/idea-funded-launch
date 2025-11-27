import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Verify admin user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, action, customPrompt } = await req.json();

    console.log('[AI Assistant]', { orderId, action, user: user.email });

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          title,
          product_url,
          quantity,
          unit_price_usd,
          subtotal_usd,
          notes,
          store
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      throw new Error('Order not found');
    }

    // Build context for AI
    const orderContext = `
Order ID: ${order.id}
Status: ${order.status}
Total: $${order.total_usd} USD (${order.total_cdf} CDF)
Shipping City: ${order.shipping_city || 'N/A'}
Payment Status: ${order.maisha_payment_status || 'Pending'}
Items: ${order.order_items?.length || 0} items
${order.order_items?.map((item: any) => 
  `- ${item.title || 'Product'}: ${item.quantity}x @ $${item.unit_price_usd} = $${item.subtotal_usd}`
).join('\n')}
Created: ${new Date(order.created_at).toLocaleString()}
`.trim();

    // Build prompt based on action
    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'SUMMARIZE':
        systemPrompt = 'You are an e-commerce order analyst. Provide clear, concise order summaries.';
        userPrompt = `Summarize this order in 2-3 sentences, highlighting key details:\n\n${orderContext}`;
        break;

      case 'FRAUD_CHECK':
        systemPrompt = 'You are a fraud detection expert for e-commerce. Analyze orders for suspicious patterns.';
        userPrompt = `Analyze this order for potential fraud indicators. Consider: unusual quantities, pricing anomalies, mismatched locations, suspicious payment patterns. Rate risk as LOW, MEDIUM, or HIGH and explain:\n\n${orderContext}`;
        break;

      case 'DRAFT_EMAIL':
        systemPrompt = 'You are a customer service representative. Draft professional, friendly emails.';
        userPrompt = customPrompt 
          ? `Draft an email to the customer about: ${customPrompt}\n\nOrder Context:\n${orderContext}`
          : `Draft a professional email to the customer about their order status:\n\n${orderContext}`;
        break;

      case 'GENERATE_LABEL':
        systemPrompt = 'You generate shipping label information in a structured format.';
        userPrompt = `Generate shipping label details for this order. Include: recipient info, order number, item count, weight estimate, delivery instructions:\n\n${orderContext}`;
        break;

      default:
        throw new Error('Invalid action type');
    }

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI Error]', aiResponse.status, errorText);
      throw new Error(`AI request failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiResult = aiData.choices[0]?.message?.content || 'No response generated';

    // Log the interaction
    await supabase
      .from('ai_assistant_logs')
      .insert({
        order_id: orderId,
        user_id: user.id,
        action_type: action,
        prompt: userPrompt,
        response: aiResult,
        metadata: { model: 'google/gemini-2.5-flash' }
      });

    console.log('[AI Assistant] Success:', action);

    return new Response(
      JSON.stringify({ 
        success: true, 
        result: aiResult,
        action
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[AI Assistant Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
