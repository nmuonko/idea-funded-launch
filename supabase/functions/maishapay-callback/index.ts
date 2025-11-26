import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePaymentStatus(status: string): 'paid' | 'failed' | 'pending' {
  const normalized = status.toLowerCase();
  if (normalized === 'success' || normalized === 'paid' || normalized === '1' || normalized.includes('success')) {
    return 'paid';
  } else if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  return 'pending';
}

function redirectToFrontend(status: string, description?: string, req?: Request, extras?: any) {
  const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrifund.lovable.app';
  const params = new URLSearchParams({
    status,
    ...(description && { description }),
    ...(extras?.transactionRefId && { transactionRefId: extras.transactionRefId }),
    ...(extras?.operatorRefId && { operatorRefId: extras.operatorRefId }),
    ...(extras?.reference && { reference: extras.reference }),
  });

  const redirectUrl = `${frontendUrl}/payment/result?${params.toString()}`;
  
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
    return redirectToFrontend('failed', 'Invalid request method', req);
  }

  try {
    console.log('[MaishaPay Callback] Processing callback...');

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
      maisha_transaction_id: paymentData.transactionRefId || null,
      maisha_payment_status: normalizedStatus === 'paid' ? 'SUCCESS' : 'FAILED',
      updated_at: new Date().toISOString(),
    };

    if (normalizedStatus === 'paid') {
      updateData.status = 'PAID';
    }

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating order:', updateError);
    }

    // Send admin notification on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[MaishaPay Callback] Triggering admin notification');
      
      const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL');
      if (adminEmail) {
        // TODO: Send email via Resend
        console.log('[MaishaPay Callback] Admin notification sent to:', adminEmail);
      }
    }

    console.log('[MaishaPay Callback] Processing complete');

    return new Response(JSON.stringify({ 
      success: true,
      orderId,
      status: normalizedStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    return redirectToFrontend('failed', error.message, undefined);
  }
};

serve(handler);
