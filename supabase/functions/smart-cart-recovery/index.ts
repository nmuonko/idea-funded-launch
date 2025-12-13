import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUTO_EXECUTE_THRESHOLD = 0.85;

interface RecoveryPrediction {
  optimalSendTime: string;
  suggestedDiscountPercent: number;
  personalizedSubject: string;
  personalizedBody: string;
  conversionProbability: number;
  reasoning: string;
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

    // Find abandoned carts (DRAFT orders older than 2 hours, not yet analyzed)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: abandonedCarts, error: cartsError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*),
        profiles:user_id (
          full_name,
          email,
          country,
          language
        )
      `)
      .eq('status', 'DRAFT')
      .lt('updated_at', twoHoursAgo)
      .gt('created_at', thirtyDaysAgo)
      .not('admin_notes', 'ilike', '%recovery_analyzed%')
      .limit(20);

    if (cartsError) {
      console.error('Error fetching abandoned carts:', cartsError);
      throw cartsError;
    }

    if (!abandonedCarts || abandonedCarts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, analyzed: 0, message: 'No abandoned carts to analyze' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    for (const cart of abandonedCarts) {
      try {
        if (!cart.profiles?.email) {
          console.log(`Skipping cart ${cart.id}: no email`);
          continue;
        }

        // Fetch customer history
        const { data: customerOrders } = await supabase
          .from('orders')
          .select('id, status, total_usd, created_at')
          .eq('user_id', cart.user_id)
          .neq('status', 'DRAFT')
          .order('created_at', { ascending: false })
          .limit(10);

        const { data: previousRecoveries } = await supabase
          .from('cart_recovery_predictions')
          .select('*')
          .eq('user_id', cart.user_id)
          .order('created_at', { ascending: false })
          .limit(5);

        const totalSpent = customerOrders?.reduce((sum, o) => sum + (o.total_usd || 0), 0) || 0;
        const orderCount = customerOrders?.length || 0;
        const isVip = totalSpent > 500 || orderCount >= 5;
        const isNewCustomer = orderCount === 0;
        const previousRecoveryCount = previousRecoveries?.length || 0;
        const previousConversions = previousRecoveries?.filter(r => r.converted_at)?.length || 0;

        // Cart value and items
        const cartValue = cart.total_usd || 0;
        const itemCount = cart.order_items?.length || 0;
        const itemTitles = cart.order_items?.map((i: any) => i.title || 'Product').slice(0, 3).join(', ') || 'items';

        // Customer language preference
        const language = cart.profiles?.language || 
          (cart.profiles?.country && ['DR Congo', 'Congo-Brazzaville', 'Cameroon', 'Senegal'].includes(cart.profiles.country) ? 'fr' : 'en');

        const prompt = `Generate a personalized cart recovery strategy for this abandoned cart.

CART DETAILS:
- Cart Value: $${cartValue.toFixed(2)}
- Items: ${itemCount} (${itemTitles})
- Abandoned: ${cart.updated_at}
- Cart Age: ${Math.round((Date.now() - new Date(cart.updated_at).getTime()) / (1000 * 60 * 60))} hours

CUSTOMER PROFILE:
- Name: ${cart.profiles?.full_name || 'Customer'}
- Email: ${cart.profiles?.email}
- Country: ${cart.profiles?.country || 'Unknown'}
- Language: ${language}
- VIP Status: ${isVip ? 'Yes' : 'No'}
- New Customer: ${isNewCustomer ? 'Yes' : 'No'}
- Past Orders: ${orderCount}
- Total Spent: $${totalSpent.toFixed(2)}
- Previous Recovery Emails: ${previousRecoveryCount}
- Previous Conversions: ${previousConversions}

Respond with ONLY a JSON object (no markdown):
{
  "optimalSendTime": "ISO datetime string for best time to send (consider timezone, typically 10am-2pm or 6pm-8pm local)",
  "suggestedDiscountPercent": 0-20 (0 if no discount, higher for VIP or high-value carts, 0 for new customers to establish value),
  "personalizedSubject": "Catchy email subject in ${language === 'fr' ? 'French' : 'English'}, max 60 chars",
  "personalizedBody": "Personalized email body in ${language === 'fr' ? 'French' : 'English'}, 100-200 words, mention specific items, create urgency without being pushy",
  "conversionProbability": 0.0-1.0,
  "reasoning": "Brief explanation of strategy"
}

Consider:
- VIP customers: personalized touch, no discount needed
- New customers: focus on value, free shipping mention if applicable
- High cart value: emphasize product quality
- Multiple recovery attempts: stronger urgency or larger discount
- Time of day in customer's timezone`;

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are an expert e-commerce marketer specializing in cart recovery. Generate personalized, effective recovery campaigns.' },
              { role: 'user', content: prompt }
            ],
          }),
        });

        if (!aiResponse.ok) {
          console.error(`AI API error for cart ${cart.id}:`, await aiResponse.text());
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content;

        if (!content) {
          console.error(`No AI content for cart ${cart.id}`);
          continue;
        }

        let prediction: RecoveryPrediction;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          prediction = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error(`Failed to parse AI response for cart ${cart.id}:`, parseError);
          continue;
        }

        // Store prediction
        const { data: predictionRecord, error: predError } = await supabase
          .from('cart_recovery_predictions')
          .insert({
            order_id: cart.id,
            user_id: cart.user_id,
            optimal_send_time: prediction.optimalSendTime,
            suggested_discount_percent: prediction.suggestedDiscountPercent,
            personalized_subject: prediction.personalizedSubject,
            personalized_body: prediction.personalizedBody,
            conversion_probability: prediction.conversionProbability,
            ai_reasoning: prediction.reasoning,
          })
          .select()
          .single();

        if (predError) {
          console.error(`Error storing prediction for cart ${cart.id}:`, predError);
          continue;
        }

        // Mark cart as analyzed
        await supabase
          .from('orders')
          .update({
            admin_notes: (cart.admin_notes || '') + ` | recovery_analyzed:${new Date().toISOString()}`,
          })
          .eq('id', cart.id);

        // Queue for execution or review
        const shouldAutoSend = prediction.conversionProbability >= AUTO_EXECUTE_THRESHOLD && prediction.suggestedDiscountPercent === 0;

        await supabase
          .from('ai_action_queue')
          .insert({
            action_type: 'cart_recovery',
            target_id: cart.id,
            target_type: 'order',
            ai_decision: {
              action: 'send_recovery_email',
              predictionId: predictionRecord.id,
              email: cart.profiles?.email,
              subject: prediction.personalizedSubject,
              discountPercent: prediction.suggestedDiscountPercent,
              scheduledFor: prediction.optimalSendTime,
            },
            confidence_score: prediction.conversionProbability,
            status: shouldAutoSend ? 'approved' : 'pending_review',
          });

        results.push({
          cartId: cart.id,
          prediction,
          autoApproved: shouldAutoSend,
        });

      } catch (cartError) {
        console.error(`Error analyzing cart ${cart.id}:`, cartError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analyzed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in smart-cart-recovery:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
