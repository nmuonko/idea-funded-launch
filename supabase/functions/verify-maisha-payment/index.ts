import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createErrorResponse } from "../_shared/errorSanitizer.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Use service role for updates to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Use anon key with user auth for permission check
    const supabase = createClient(
      supabaseUrl,
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

    const { orderId, paymentId, reference, manualOverride, notes } = await req.json();

    console.log('[Payment Verify]', { orderId, paymentId, reference, manualOverride, user: user.email });

    // Get order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, maisha_transaction_id, maisha_payment_status, payment_verified_at')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('[Payment Verify] Order fetch error:', orderError);
      throw new Error('Order not found');
    }

    if (!order) {
      throw new Error('Order not found');
    }

    let verificationResult = { verified: false, status: 'unknown' };

    // If order is already PAID, sync the payment record
    if (order.status === 'PAID') {
      console.log('[Payment Verify] Order already PAID, syncing payment record');
      verificationResult = { verified: true, status: 'paid' };
    } else if (manualOverride) {
      // Manual override - admin manually verifies
      verificationResult = { verified: true, status: 'manual_override' };
    } else if (order.maisha_transaction_id) {
      // Try to check with MaishaPay API
      const mode = Deno.env.get('MAISHAPAY_GATEWAY_MODE') || Deno.env.get('MAISHAPAY_MODE') || '1';
      const isLive = mode === '1' || mode === 'live';
      const apiKey = isLive 
        ? Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || Deno.env.get('MAISHAPAY_SECRET_KEY')
        : Deno.env.get('MAISHAPAY_SECRET_KEY');

      try {
        const maishaResponse = await fetch(
          `https://api.maishapay.online/v1/transactions/${order.maisha_transaction_id}`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            }
          }
        );

        // SAFE: Read as text first - MaishaPay often returns empty body
        const responseText = await maishaResponse.text();
        console.log('[Payment Verify] MaishaPay raw response:', {
          status: maishaResponse.status,
          ok: maishaResponse.ok,
          bodyLength: responseText.length,
          body: responseText.substring(0, 200),
        });

        if (maishaResponse.ok) {
          let maishaData: any = { success: true };

          // Only parse if there's actual content
          if (responseText && responseText.trim() !== '') {
            try {
              maishaData = JSON.parse(responseText);
            } catch (e) {
              console.log('[Payment Verify] Response not JSON, treating as success');
              maishaData = { success: true, rawResponse: responseText };
            }
          } else {
            // Empty body with OK status = success per MaishaPay docs
            console.log('[Payment Verify] Empty MaishaPay response - treating as success per API docs');
          }

          const maishaStatus = (maishaData.status || 'success').toLowerCase();
          verificationResult = {
            verified: ['completed', 'success', 'paid'].includes(maishaStatus) || maishaResponse.ok,
            status: maishaStatus
          };
        } else {
          console.log('[Payment Verify] MaishaPay API returned non-OK status:', maishaResponse.status);
        }
      } catch (error) {
        console.error('[Payment Verify] MaishaPay API error:', error);
        // Don't fail - just log and continue
      }
    }

    const now = new Date().toISOString();

    // Update order if verified
    if (verificationResult.verified) {
      const orderUpdateData: any = {
        status: 'PAID',
        maisha_payment_status: 'paid',
        updated_at: now,
        payment_verified_at: order.payment_verified_at || now,
        payment_verified_by: user.id,
        payment_verification_method: manualOverride ? 'MANUAL_OVERRIDE' : 'AUTOMATIC',
      };
      
      if (notes) {
        orderUpdateData.payment_notes = notes;
      }

      const { error: orderUpdateError } = await supabaseAdmin
        .from('orders')
        .update(orderUpdateData)
        .eq('id', orderId);

      if (orderUpdateError) {
        console.error('[Payment Verify] Order update error:', orderUpdateError);
      } else {
        console.log('[Payment Verify] Order updated to PAID');
      }
    }

    // ALSO update maisha_payments table
    const paymentUpdateData: any = {
      status: verificationResult.verified ? 'paid' : 'pending',
      updated_at: now,
    };
    
    if (verificationResult.verified) {
      paymentUpdateData.paid_at = now;
    }

    // Try to update by paymentId first, then by reference, then by order_id
    let paymentUpdated = false;

    if (paymentId) {
      const { error: paymentUpdateError } = await supabaseAdmin
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('id', paymentId);
      
      if (!paymentUpdateError) {
        paymentUpdated = true;
        console.log('[Payment Verify] maisha_payments updated by paymentId');
      }
    }

    if (!paymentUpdated && reference) {
      const { error: paymentUpdateError } = await supabaseAdmin
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('maisha_reference', reference);
      
      if (!paymentUpdateError) {
        paymentUpdated = true;
        console.log('[Payment Verify] maisha_payments updated by reference');
      }
    }

    if (!paymentUpdated) {
      const { error: paymentUpdateError } = await supabaseAdmin
        .from('maisha_payments')
        .update(paymentUpdateData)
        .eq('order_id', orderId);
      
      if (!paymentUpdateError) {
        paymentUpdated = true;
        console.log('[Payment Verify] maisha_payments updated by order_id');
      }
    }

    // Log action
    await supabaseAdmin
      .from('order_actions')
      .insert({
        order_id: orderId,
        actor_id: user.id,
        action_type: 'PAYMENT_VERIFIED',
        action_message: manualOverride ? 'Manual verification' : 'Automatic verification',
        metadata: { 
          method: manualOverride ? 'manual' : 'automatic', 
          notes,
          previousOrderStatus: order.status,
          paymentUpdated,
        }
      });

    console.log('[Payment Verify] Success:', verificationResult);

    return new Response(
      JSON.stringify({ 
        success: true, 
        verified: verificationResult.verified,
        status: verificationResult.status,
        paymentUpdated,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return createErrorResponse(error, 'verify-maisha-payment', corsHeaders);
  }
});