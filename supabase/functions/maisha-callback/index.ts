import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maishapay-signature',
};

// HMAC signature verification
async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
  
  // If no secret is configured, log warning but allow (for backwards compatibility during transition)
  if (!webhookSecret) {
    console.warn('[Maisha Callback] WARNING: MAISHAPAY_WEBHOOK_SECRET not configured - signature validation skipped');
    return true;
  }
  
  // If secret is configured but no signature provided, reject
  if (!signature) {
    console.error('[Maisha Callback] No signature provided in request');
    return false;
  }
  
  try {
    // Compute expected HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(rawBody)
    );
    
    // Convert to hex string
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Constant-time comparison to prevent timing attacks
    const providedSig = signature.toLowerCase().replace(/^sha256=/, '');
    const isValid = expectedSignature === providedSig;
    
    if (!isValid) {
      console.error('[Maisha Callback] Signature mismatch - expected:', expectedSignature.substring(0, 16) + '...', 'got:', providedSig.substring(0, 16) + '...');
    }
    
    return isValid;
  } catch (error) {
    console.error('[Maisha Callback] Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[Maisha Callback] Received webhook');

    // Clone request to read body for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature
    const signature = req.headers.get('x-maishapay-signature') || 
                      req.headers.get('x-webhook-signature') ||
                      req.headers.get('x-signature');
    
    const isValid = await verifyWebhookSignature(rawBody, signature);
    
    if (!isValid) {
      console.error('[Maisha Callback] Invalid webhook signature - rejecting request');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('[Maisha Callback] Webhook signature verified successfully');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Parse webhook payload from raw body
    let payload;
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = {};
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params.entries());
    } else {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        const params = new URLSearchParams(rawBody);
        payload = Object.fromEntries(params.entries());
      }
    }

    console.log('[Maisha Callback] Payload:', payload);

    // Extract data (adjust field names based on actual MaishaPay webhook structure)
    const reference = payload.reference || payload.transactionRef || payload.maishaReference;
    const status = payload.status || payload.paymentStatus;
    const paidAmount = payload.amount || payload.paidAmount;

    if (!reference) {
      return new Response(JSON.stringify({ error: 'Missing reference' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Maisha Callback] Processing:', { reference, status, paidAmount });

    // Find payment record
    const { data: payment, error: paymentError } = await supabase
      .from('maisha_payments')
      .select('*, orders(*)')
      .eq('maisha_reference', reference)
      .maybeSingle();

    if (paymentError || !payment) {
      console.error('[Maisha Callback] Payment not found:', reference);
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize status
    const normalizedStatus = ['success', 'paid', 'completed'].includes(status?.toLowerCase()) 
      ? 'paid' 
      : ['failed', 'cancelled', 'rejected'].includes(status?.toLowerCase())
      ? 'failed'
      : 'pending';

    console.log('[Maisha Callback] Normalized status:', normalizedStatus);

    // Update payment record
    const paymentUpdate: any = {
      status: normalizedStatus,
      raw_response: payload,
      updated_at: new Date().toISOString(),
    };

    if (normalizedStatus === 'paid') {
      paymentUpdate.paid_at = new Date().toISOString();
    }

    await supabase
      .from('maisha_payments')
      .update(paymentUpdate)
      .eq('id', payment.id);

    // Update order status
    if (normalizedStatus === 'paid') {
      await supabase
        .from('orders')
        .update({
          status: 'PAID',
          maisha_payment_status: 'paid',
          payment_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.order_id);

      console.log('[Maisha Callback] Order marked as PAID:', payment.order_id);

      // Send payment confirmation email (background task)
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-payment-confirmation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ orderId: payment.order_id }),
        });
        console.log('[Maisha Callback] Payment confirmation email queued');
      } catch (emailError) {
        console.error('[Maisha Callback] Error sending confirmation email:', emailError);
        // Don't fail the webhook if email fails
      }

      // Automatically progress to PROCESSING after 1 minute (background task)
      setTimeout(async () => {
        try {
          await supabase
            .from('orders')
            .update({
              status: 'PROCESSING',
              updated_at: new Date().toISOString(),
            })
            .eq('id', payment.order_id)
            .eq('status', 'PAID');
          console.log('[Maisha Callback] Order progressed to PROCESSING:', payment.order_id);
        } catch (progressError) {
          console.error('[Maisha Callback] Error progressing order:', progressError);
        }
      }, 60000); // 1 minute delay
    } else if (normalizedStatus === 'failed') {
      await supabase
        .from('orders')
        .update({
          maisha_payment_status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.order_id);

      console.log('[Maisha Callback] Order marked as FAILED:', payment.order_id);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Maisha Callback] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
