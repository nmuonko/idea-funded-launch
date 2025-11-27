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

    const { orderId, actionType, message, metadata } = await req.json();

    console.log('[Order Action]', { orderId, actionType, user: user.email });

    // Update order based on action
    let orderUpdate: any = { updated_at: new Date().toISOString() };

    switch (actionType) {
      case 'APPROVED':
        orderUpdate.status = 'PROCESSING';
        orderUpdate.approved_at = new Date().toISOString();
        orderUpdate.approved_by = user.id;
        break;
      case 'REJECTED':
        orderUpdate.status = 'CANCELLED';
        orderUpdate.rejected_at = new Date().toISOString();
        orderUpdate.rejected_by = user.id;
        orderUpdate.rejection_reason = message;
        break;
      case 'INFO_REQUESTED':
        orderUpdate.info_requested = true;
        break;
      case 'PAYMENT_VERIFIED':
        orderUpdate.maisha_payment_status = 'verified';
        break;
      case 'SHIPPED':
        orderUpdate.status = 'SHIPPED';
        break;
      case 'DELIVERED':
        orderUpdate.status = 'COMPLETED';
        break;
      case 'NOTE_ADDED':
        orderUpdate.admin_notes = metadata?.note || message;
        break;
    }

    // Update the order
    const { error: updateError } = await supabase
      .from('orders')
      .update(orderUpdate)
      .eq('id', orderId);

    if (updateError) {
      console.error('[Order Update Error]', updateError);
      throw updateError;
    }

    // Log the action in timeline
    const { error: actionError } = await supabase
      .from('order_actions')
      .insert({
        order_id: orderId,
        actor_id: user.id,
        action_type: actionType,
        action_message: message,
        metadata: metadata || {}
      });

    if (actionError) {
      console.error('[Action Log Error]', actionError);
      throw actionError;
    }

    console.log('[Order Action] Success:', actionType);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Order Action Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
