import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreatePaymentRequest {
  submissionId: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId }: CreatePaymentRequest = await req.json();

    console.log('[MaishaPay] Creating payment for submission:', submissionId);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch the submission
    const { data: submission, error: fetchError } = await supabaseClient
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      console.error('[MaishaPay] Submission not found:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already paid
    if (submission.payment_status === 'paid') {
      return new Response(
        JSON.stringify({ error: 'Payment already completed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get MaishaPay credentials
    const publicKey = Deno.env.get('MAISHAPAY_PUBLIC_KEY_TEST');
    const secretKey = Deno.env.get('MAISHAPAY_SECRET_KEY_TEST');
    const apiBaseUrl = Deno.env.get('MAISHAPAY_API_BASE_URL');
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL');
    const mode = Deno.env.get('MAISHAPAY_MODE') || 'sandbox';

    if (!publicKey || !secretKey || !apiBaseUrl) {
      console.error('[MaishaPay] Missing configuration');
      return new Response(
        JSON.stringify({ error: 'Payment configuration incomplete' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate unique reference
    const reference = `AFRIFUND-${submissionId}-${Date.now()}`;
    
    // Get payment amount and currency
    const amount = submission.payment_amount || 20;
    const currency = submission.payment_currency || 'USD';

    console.log('[MaishaPay] Payment details:', { reference, amount, currency, mode });

    // Prepare MaishaPay request
    const maishapayPayload = {
      public_key: publicKey,
      amount: amount,
      currency: currency,
      reference: reference,
      callback_url: callbackUrl,
      return_url: `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/payment/result`,
      description: `AfriFund Application - ${submission.project_title}`,
      customer_email: submission.email,
      customer_name: submission.full_name,
      metadata: {
        submission_id: submissionId,
        project_code: submission.project_code,
        mode: mode
      }
    };

    console.log('[MaishaPay] Initiating payment with:', {
      reference,
      amount,
      currency,
      mode
    });

    // Call MaishaPay API
    const maishapayResponse = await fetch(`${apiBaseUrl}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify(maishapayPayload),
    });

    const maishapayData = await maishapayResponse.json();
    
    console.log('[MaishaPay] API Response status:', maishapayResponse.status);
    console.log('[MaishaPay] API Response data:', maishapayData);

    if (!maishapayResponse.ok) {
      console.error('[MaishaPay] API Error:', maishapayData);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to initiate payment', 
          details: maishapayData 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update submission with MaishaPay reference
    const { error: updateError } = await supabaseClient
      .from('user_submissions')
      .update({
        maishapay_reference: reference,
        payment_status: 'pending',
        maishapay_raw_response: maishapayData,
      })
      .eq('id', submissionId);

    if (updateError) {
      console.error('[MaishaPay] Failed to update submission:', updateError);
    }

    // Extract checkout URL from response
    const checkoutUrl = maishapayData.checkout_url || maishapayData.payment_url || maishapayData.url;

    if (!checkoutUrl) {
      console.error('[MaishaPay] No checkout URL in response:', maishapayData);
      return new Response(
        JSON.stringify({ 
          error: 'No checkout URL received from payment provider',
          data: maishapayData
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[MaishaPay] Payment initiated successfully:', { reference, checkoutUrl });

    return new Response(
      JSON.stringify({ 
        success: true,
        checkoutUrl,
        reference,
        mode
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[MaishaPay] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);