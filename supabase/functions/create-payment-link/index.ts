import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * create-payment-link Edge Function
 * 
 * Creates or returns existing payment link for an order.
 * Idempotent: if active link exists, returns it.
 * 
 * Input: { order_id: string }
 * Output: { success: true, url: string, token: string, expires_at: string }
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    // Parse request
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'order_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(order_id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid order_id format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order exists and is in a valid state
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      console.error('[create-payment-link] Order not found:', order_id, orderError);
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only allow links for orders that need payment
    if (!['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
      console.log('[create-payment-link] Order already processed:', order.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Order is not awaiting payment',
          status: order.status
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing active link (idempotent)
    const { data: existingLink } = await supabase
      .from('payment_links')
      .select('id, token, expires_at, status')
      .eq('order_id', order_id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingLink) {
      console.log('PAYMENT_LINK_REUSE', { 
        order_id, 
        link_id: existingLink.id,
        expires_at: existingLink.expires_at 
      });

      const url = `${frontendBaseUrl}/pay/${existingLink.token}`;

      return new Response(
        JSON.stringify({
          success: true,
          url,
          token: existingLink.token,
          expires_at: existingLink.expires_at,
          reused: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Expire any old links for this order
    await supabase
      .from('payment_links')
      .update({ status: 'expired' })
      .eq('order_id', order_id)
      .eq('status', 'active');

    // Create new payment link
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const { data: newLink, error: insertError } = await supabase
      .from('payment_links')
      .insert({
        order_id,
        expires_at: expiresAt.toISOString(),
        created_by: order.user_id,
      })
      .select('id, token, expires_at')
      .single();

    if (insertError || !newLink) {
      console.error('[create-payment-link] Failed to create link:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create payment link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('PAYMENT_LINK_CREATE', { 
      order_id, 
      link_id: newLink.id,
      token: newLink.token.substring(0, 8) + '...',
      expires_at: newLink.expires_at,
      total_usd: order.total_usd,
    });

    const url = `${frontendBaseUrl}/pay/${newLink.token}`;

    return new Response(
      JSON.stringify({
        success: true,
        url,
        token: newLink.token,
        expires_at: newLink.expires_at,
        reused: false,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[create-payment-link] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
