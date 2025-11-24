import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    console.log('[MaishaPay Callback] Non-POST request received:', req.method);
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    console.log('[MaishaPay Callback] Processing callback...');

    // TODO: CRITICAL SECURITY - Implement webhook signature verification
    // Before processing any payment, verify the request is actually from MaishaPay
    // 1. Get webhook secret from environment: MAISHAPAY_WEBHOOK_SECRET
    // 2. Verify signature using MaishaPay's HMAC algorithm
    // 3. Reject requests with invalid signatures
    // Reference: Check MaishaPay API documentation for signature verification details
    
    const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.warn('[MaishaPay Callback] WARNING: MAISHAPAY_WEBHOOK_SECRET not configured - signature verification disabled');
    }

    // TODO: Add signature verification here when webhook secret is configured
    // Example: const signature = req.headers.get('x-maishapay-signature');
    // if (!verifySignature(req.body, signature, webhookSecret)) { return 403; }

    // Parse the request - MaishaPay might send form-urlencoded, JSON, or plain text
    const contentType = req.headers.get('content-type') ?? '';
    let params: URLSearchParams;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const bodyText = await req.text();
      params = new URLSearchParams(bodyText);
      console.log('[MaishaPay Callback] Parsed form-urlencoded data');
    } else if (contentType.includes('application/json')) {
      const json = await req.json();
      params = new URLSearchParams(
        Object.entries(json).map(([k, v]) => [k, String(v)])
      );
      console.log('[MaishaPay Callback] Parsed JSON data');
    } else {
      const bodyText = await req.text();
      params = new URLSearchParams(bodyText);
      console.log('[MaishaPay Callback] Parsed text data');
    }

    // Extract submission ID from the callback URL query params
    const url = new URL(req.url);
    const submissionId = url.searchParams.get('submission_id');

    if (!submissionId) {
      console.error('[MaishaPay Callback] No submission_id in callback URL');
      return new Response(
        JSON.stringify({ error: 'Missing submission_id parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract MaishaPay payment data
    const status = params.get('status') ?? params.get('payment_status') ?? '';
    const description = params.get('description') ?? '';
    const transactionRefId = params.get('transactionRefId') ?? 
                            params.get('transaction_id') ?? 
                            params.get('id') ?? '';
    const operatorRefId = params.get('operatorRefId') ?? 
                         params.get('operator_ref_id') ?? '';
    const montant = params.get('montant') ?? params.get('amount') ?? '';
    const devise = params.get('devise') ?? params.get('currency') ?? 'USD';

    console.log('[MaishaPay Callback] Payment data:', {
      submissionId,
      status,
      transactionRefId,
      operatorRefId,
      montant,
      devise,
    });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Determine payment status
    const normalizedStatus = status.toLowerCase();
    const paymentStatus: 'paid' | 'failed' | 'pending' = 
      normalizedStatus === 'success' || 
      normalizedStatus === 'paid' || 
      normalizedStatus === '1' ||
      normalizedStatus.includes('success')
        ? 'paid'
        : normalizedStatus === 'failed' || normalizedStatus === 'error'
        ? 'failed'
        : 'pending';

    console.log('[MaishaPay Callback] Determined payment status:', paymentStatus);

    // Store payment record in payments table
    const { data: paymentRecord, error: paymentError } = await supabaseClient
      .from('payments')
      .insert({
        provider: 'maishapay',
        status: paymentStatus,
        description,
        transaction_ref_id: transactionRefId,
        operator_ref_id: operatorRefId,
        amount: montant ? Number(montant) : null,
        currency: devise,
        submission_id: submissionId,
        raw_payload: Object.fromEntries(params.entries()),
      })
      .select()
      .single();

    if (paymentError) {
      console.error('[MaishaPay Callback] Error inserting payment record:', paymentError);
    } else {
      console.log('[MaishaPay Callback] Payment record created:', paymentRecord?.id);
    }

    // Update user_submissions table
    const { error: updateError } = await supabaseClient
      .from('user_submissions')
      .update({
        payment_status: paymentStatus,
        maishapay_transaction_id: transactionRefId,
        maishapay_raw_response: Object.fromEntries(params.entries()),
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating submission:', updateError);
    } else {
      console.log('[MaishaPay Callback] Submission updated successfully');
    }

    // If payment successful, trigger confirmation email after a short delay
    if (paymentStatus === 'paid') {
      console.log('[MaishaPay Callback] Payment successful, triggering confirmation email...');
      
      setTimeout(async () => {
        try {
          const { error: emailError } = await supabaseClient.functions.invoke(
            'send-payment-confirmation-email',
            {
              body: { submissionId },
            }
          );

          if (emailError) {
            console.error('[MaishaPay Callback] Error sending confirmation email:', emailError);
          } else {
            console.log('[MaishaPay Callback] Confirmation email triggered');
          }
        } catch (err) {
          console.error('[MaishaPay Callback] Exception sending confirmation email:', err);
        }
      }, 2000);
    }

    // Redirect user to payment result page
    const frontendBase = Deno.env.get('FRONTEND_BASE_URL') || 'http://localhost:8080';
    const redirectUrl = new URL('/payment/result', frontendBase);
    redirectUrl.searchParams.set('status', status);
    redirectUrl.searchParams.set('description', description);
    redirectUrl.searchParams.set('transactionRefId', transactionRefId);
    redirectUrl.searchParams.set('operatorRefId', operatorRefId);
    redirectUrl.searchParams.set('submissionId', submissionId);

    console.log('[MaishaPay Callback] Redirecting to:', redirectUrl.toString());

    return new Response(null, {
      status: 303,
      headers: { 
        ...corsHeaders, 
        'Location': redirectUrl.toString() 
      },
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
};

serve(handler);
