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

    const { orderId, manualOverride, notes } = await req.json();

    console.log('[Payment Verify]', { orderId, manualOverride, user: user.email });

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('maisha_transaction_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      throw new Error('Order not found');
    }

    let verificationResult = { verified: false, status: 'unknown' };

    if (manualOverride) {
      // Manual override - admin manually verifies
      verificationResult = { verified: true, status: 'manual_override' };
    } else if (order.maisha_transaction_id) {
      // Check with MaishaPay API
      const mode = Deno.env.get('MAISHAPAY_MODE') || 'test';
      const apiKey = mode === 'live' 
        ? Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY')
        : Deno.env.get('MAISHAPAY_TEST_SECRET_KEY');

      try {
        const maishaResponse = await fetch(
          `https://api.maishapay.com/transactions/${order.maisha_transaction_id}`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            }
          }
        );

        if (maishaResponse.ok) {
          const maishaData = await maishaResponse.json();
          verificationResult = {
            verified: maishaData.status === 'completed',
            status: maishaData.status
          };
        }
      } catch (error) {
        console.error('[MaishaPay Check Error]', error);
      }
    }

    // Update order
    const updateData: any = {
      maisha_payment_status: verificationResult.verified ? 'verified' : 'pending',
      updated_at: new Date().toISOString(),
    };

    if (verificationResult.verified) {
      updateData.payment_verified_at = new Date().toISOString();
      updateData.payment_verified_by = user.id;
      updateData.payment_verification_method = manualOverride ? 'MANUAL_OVERRIDE' : 'AUTOMATIC';
      updateData.payment_notes = notes;
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) throw updateError;

    // Log action
    await supabase
      .from('order_actions')
      .insert({
        order_id: orderId,
        actor_id: user.id,
        action_type: 'PAYMENT_VERIFIED',
        action_message: manualOverride ? 'Manual verification' : 'Automatic verification',
        metadata: { method: manualOverride ? 'manual' : 'automatic', notes }
      });

    console.log('[Payment Verify] Success:', verificationResult);

    return new Response(
      JSON.stringify({ 
        success: true, 
        verified: verificationResult.verified,
        status: verificationResult.status
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Payment Verify Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
