import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('[MaishaPay Callback] Received request:', req.method);
  console.log('[MaishaPay Callback] URL:', req.url);

  try {
    const config = getMaishaPayConfig();
    console.log(`[MaishaPay Callback] Processing callback (${config.mode} mode)...`);

    // Parse different content types and methods MaishaPay might send
    let paymentData: any = {};
    
    // Check if there are query params (GET request or redirect)
    const url = new URL(req.url);
    if (url.searchParams.toString()) {
      for (const [key, value] of url.searchParams.entries()) {
        paymentData[key] = value;
      }
      console.log('[MaishaPay Callback] Query params:', paymentData);
    }

    // Also parse body for POST requests
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          paymentData[key] = value;
        }
      } else if (contentType.includes('application/json')) {
        const jsonData = await req.json();
        paymentData = { ...paymentData, ...jsonData };
      } else {
        const text = await req.text();
        try {
          const jsonData = JSON.parse(text);
          paymentData = { ...paymentData, ...jsonData };
        } catch {
          const params = new URLSearchParams(text);
          for (const [key, value] of params.entries()) {
            paymentData[key] = value;
          }
        }
      }
    }

    console.log('[MaishaPay Callback] Full payment data:', JSON.stringify(paymentData, null, 2));

    // Extract reference - MaishaPay might send it under different field names
    const reference = paymentData.reference || 
                      paymentData.transactionRefId || 
                      paymentData.transaction_ref_id ||
                      paymentData.ref;
    
    const rawStatus = paymentData.status || paymentData.transactionStatus || paymentData.transaction_status;
    
    console.log('[MaishaPay Callback] Extracted data:', {
      reference,
      rawStatus,
      operatorRefId: paymentData.operatorRefId,
      description: paymentData.description,
      mode: config.mode,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus(rawStatus);
    console.log('[MaishaPay Callback] Normalized status:', normalizedStatus);

    if (!reference) {
      console.error('[MaishaPay Callback] No reference provided in callback');
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: 'No reference provided',
        receivedData: paymentData 
      }), {
        status: 200, // Return 200 to acknowledge receipt
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Extract order ID from reference (format: AFRISHOP-{orderId})
    const orderId = reference.replace('AFRISHOP-', '');
    console.log('[MaishaPay Callback] Looking up order:', orderId);

    // Fetch order
    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .select('id, status, total_usd, total_cdf, user_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('[MaishaPay Callback] Database error:', orderError);
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: 'Database error',
        error: orderError.message 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!order) {
      console.error('[MaishaPay Callback] Order not found:', orderId);
      return new Response(JSON.stringify({ 
        status: 'warning', 
        message: 'Order not found',
        orderId 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[MaishaPay Callback] Found order:', order.id, 'current status:', order.status);

    // Prepare update data
    const updateData: any = {
      maisha_transaction_id: paymentData.transactionRefId || reference,
      operator_ref_id: paymentData.operatorRefId || null,
      maisha_status_code: String(rawStatus) || null,
      maisha_description: paymentData.description || null,
      updated_at: new Date().toISOString(),
    };

    // Update order status based on payment result
    if (normalizedStatus === 'paid') {
      updateData.status = 'PAID';
      updateData.maisha_payment_status = 'SUCCESS';
      updateData.payment_verified_at = new Date().toISOString();
    } else if (normalizedStatus === 'failed') {
      updateData.maisha_payment_status = 'FAILED';
    } else if (normalizedStatus === 'cancelled') {
      updateData.maisha_payment_status = 'CANCELLED';
    } else {
      updateData.maisha_payment_status = 'PENDING';
    }

    console.log('[MaishaPay Callback] Updating order with:', updateData);

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating order:', updateError);
    } else {
      console.log('[MaishaPay Callback] Order updated successfully');
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
    } else {
      console.log('[MaishaPay Callback] Payment record updated');
    }

    // Send notifications on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[MaishaPay Callback] Payment successful, triggering notifications');
      
      // Trigger payment confirmation email (fire and forget)
      supabaseClient.functions.invoke('send-payment-confirmation', {
        body: { orderId, paymentData },
      }).catch(err => console.error('[MaishaPay Callback] Error sending confirmation:', err));

      // Trigger admin notification (fire and forget)
      supabaseClient.functions.invoke('send-admin-payment-notification', {
        body: { orderId, paymentData, mode: config.mode },
      }).catch(err => console.error('[MaishaPay Callback] Error notifying admin:', err));
    }

    console.log('[MaishaPay Callback] Processing complete');

    // Return success response to MaishaPay
    return new Response(JSON.stringify({ 
      status: 'ok',
      success: true,
      orderId,
      paymentStatus: normalizedStatus,
      mode: config.mode,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    
    // Always return 200 to acknowledge receipt, even on error
    return new Response(JSON.stringify({ 
      status: 'error',
      message: error.message 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(handler);
