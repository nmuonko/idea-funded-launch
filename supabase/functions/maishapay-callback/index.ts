import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function redirectToFrontend(status: string, description?: string, extras?: any) {
  const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop.lovable.app';
  const params = new URLSearchParams({
    status,
    ...(description && { description }),
    ...(extras?.transactionRefId && { transactionRefId: extras.transactionRefId }),
    ...(extras?.operatorRefId && { operatorRefId: extras.operatorRefId }),
    ...(extras?.reference && { reference: extras.reference }),
  });

  const redirectUrl = `${frontendUrl}/maisha-callback?${params.toString()}`;
  
  console.log('[MaishaPay Callback] Redirecting to:', redirectUrl);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': redirectUrl,
      ...corsHeaders,
    },
  });
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    console.log('[MaishaPay Callback] Non-POST request received:', req.method);
    return redirectToFrontend('failed', 'Invalid request method');
  }

  try {
    const config = getMaishaPayConfig();
    console.log(`[MaishaPay Callback] Processing callback (${config.mode} mode)...`);

    // Parse different content types MaishaPay might send
    let paymentData: any = {};
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        paymentData[key] = value;
      }
    } else if (contentType.includes('application/json')) {
      paymentData = await req.json();
    } else {
      const text = await req.text();
      try {
        paymentData = JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        for (const [key, value] of params.entries()) {
          paymentData[key] = value;
        }
      }
    }

    const reference = paymentData.reference || paymentData.transactionRefId;
    
    console.log('[MaishaPay Callback] Received payment data:', {
      status: paymentData.status,
      transactionRefId: paymentData.transactionRefId,
      operatorRefId: paymentData.operatorRefId,
      reference,
      mode: config.mode,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus(paymentData.status);
    
    console.log('[MaishaPay Callback] Normalized status:', normalizedStatus);

    if (!reference) {
      console.error('[MaishaPay Callback] No reference provided');
      return new Response(JSON.stringify({ error: 'No reference' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Extract order ID from reference (format: AFRISHOP-{orderId})
    const orderId = reference.replace('AFRISHOP-', '');

    // Fetch order
    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[MaishaPay Callback] Order not found:', orderId);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[MaishaPay Callback] Found order:', orderId);

    // Update order based on payment status
    const updateData: any = {
      maisha_transaction_id: paymentData.transactionRefId || reference,
      operator_ref_id: paymentData.operatorRefId || null,
      maisha_status_code: paymentData.status || null,
      maisha_description: paymentData.description || null,
      updated_at: new Date().toISOString(),
    };

    if (normalizedStatus === 'paid') {
      updateData.status = 'PAID';
      updateData.maisha_payment_status = 'SUCCESS';
    } else if (normalizedStatus === 'failed') {
      updateData.maisha_payment_status = 'FAILED';
    } else if (normalizedStatus === 'cancelled') {
      updateData.maisha_payment_status = 'CANCELLED';
    }

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating order:', updateError);
    }

    // Update maisha_payments record
    const { error: paymentUpdateError } = await supabaseClient
      .from('maisha_payments')
      .update({
        status: normalizedStatus,
        paid_at: normalizedStatus === 'paid' ? new Date().toISOString() : null,
        raw_response: paymentData,
        updated_at: new Date().toISOString(),
      })
      .eq('maisha_reference', reference);

    if (paymentUpdateError) {
      console.error('[MaishaPay Callback] Error updating payment record:', paymentUpdateError);
    }

    // Send admin notification and confirmation email on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[MaishaPay Callback] Payment successful, triggering notifications');
      
      // Trigger payment confirmation email
      try {
        await supabaseClient.functions.invoke('send-payment-confirmation', {
          body: { orderId, paymentData },
        });
      } catch (emailErr) {
        console.error('[MaishaPay Callback] Error sending confirmation:', emailErr);
      }

      // Trigger admin notification
      try {
        await supabaseClient.functions.invoke('send-admin-payment-notification', {
          body: { orderId, paymentData, mode: config.mode },
        });
      } catch (adminErr) {
        console.error('[MaishaPay Callback] Error notifying admin:', adminErr);
      }
    }

    console.log('[MaishaPay Callback] Processing complete');

    return new Response(JSON.stringify({ 
      success: true,
      orderId,
      status: normalizedStatus,
      mode: config.mode,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    return redirectToFrontend('failed', error.message);
  }
};

serve(handler);
