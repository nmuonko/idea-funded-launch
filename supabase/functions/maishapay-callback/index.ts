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

    const urlParams = new URL(req.url).searchParams;
    const submissionId = paymentData.submission_id || urlParams.get('submission_id');
    const confirmationId = paymentData.reference || paymentData.confirmationId;
    
    console.log('[MaishaPay Callback] Received payment data:', {
      submissionId,
      confirmationId,
      status: paymentData.status,
      transactionRefId: paymentData.transactionRefId,
      operatorRefId: paymentData.operatorRefId,
      reference: paymentData.reference,
    });

    // Normalize status
    const normalizedStatus = normalizePaymentStatus(paymentData.status);
    
    console.log('[MaishaPay Callback] Normalized status:', normalizedStatus);

    if (!submissionId && !confirmationId) {
      console.error('[MaishaPay Callback] No submission ID or confirmation ID provided');
      return redirectToFrontend('failed', 'No submission identifier', req);
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch submission by ID or confirmation ID
    let submission;
    if (submissionId) {
      const { data } = await supabaseClient
        .from('user_submissions')
        .select('*')
        .eq('id', submissionId)
        .single();
      submission = data;
    } else if (confirmationId) {
      const { data } = await supabaseClient
        .from('user_submissions')
        .select('*')
        .eq('confirmation_id', confirmationId)
        .single();
      submission = data;
    }

    if (!submission) {
      console.error('[MaishaPay Callback] Submission not found');
      return redirectToFrontend('failed', 'Submission not found', req);
    }

    const actualSubmissionId = submission.id;
    const actualConfirmationId = submission.confirmation_id;

    console.log('[MaishaPay Callback] Found submission:', actualSubmissionId, 'Confirmation:', actualConfirmationId);

    // Insert payment record
    const { error: paymentError } = await supabaseClient.from('payments').insert({
      submission_id: actualSubmissionId,
      provider: 'maishapay',
      status: normalizedStatus,
      amount: paymentData.montant || paymentData.amount || submission.payment_amount || 20,
      currency: paymentData.devise || paymentData.currency || 'USD',
      transaction_ref_id: paymentData.transactionRefId || null,
      operator_ref_id: paymentData.operatorRefId || null,
      description: paymentData.description || paymentData.message || null,
      raw_payload: paymentData,
    });

    if (paymentError) {
      console.error('[MaishaPay Callback] Error inserting payment:', paymentError);
    }

    // Update submission based on payment status
    const updateData: any = {
      payment_status: normalizedStatus,
      payment_ref_id: paymentData.transactionRefId || null,
      payment_operator_id: paymentData.operatorRefId || null,
      maishapay_transaction_id: paymentData.transactionRefId || null,
      maishapay_reference: paymentData.reference || actualConfirmationId,
      maishapay_raw_response: paymentData,
      updated_at: new Date().toISOString(),
    };

    if (normalizedStatus === 'paid') {
      updateData.submitted_at = new Date().toISOString();
      updateData.is_draft = false;
    }

    const { error: updateError } = await supabaseClient
      .from('user_submissions')
      .update(updateData)
      .eq('id', actualSubmissionId);

    if (updateError) {
      console.error('[MaishaPay Callback] Error updating submission:', updateError);
    }

    // Trigger emails on successful payment
    if (normalizedStatus === 'paid') {
      console.log('[MaishaPay Callback] Triggering payment confirmation emails');
      
      // User confirmation email
      supabaseClient.functions.invoke('send-payment-confirmation-email', {
        body: { submissionId: actualSubmissionId }
      }).then(() => {
        console.log('[MaishaPay Callback] User email trigger sent');
      }).catch((err) => {
        console.error('[MaishaPay Callback] Failed to trigger user email:', err);
      });

      // Admin notification email
      supabaseClient.functions.invoke('send-admin-payment-notification', {
        body: { submissionId: actualSubmissionId }
      }).then(() => {
        console.log('[MaishaPay Callback] Admin email trigger sent');
      }).catch((err) => {
        console.error('[MaishaPay Callback] Failed to trigger admin email:', err);
      });

      // Trigger AI analysis in background
      supabaseClient.functions.invoke('analyze-submission', {
        body: { submissionId: actualSubmissionId }
      }).then(() => {
        console.log('[MaishaPay Callback] AI analysis triggered');
      }).catch((err) => {
        console.error('[MaishaPay Callback] Failed to trigger AI analysis:', err);
      });
    }

    console.log('[MaishaPay Callback] Processing complete, redirecting to frontend');

    // Redirect to frontend results page with confirmation ID
    return redirectToFrontend(normalizedStatus, paymentData.description, req, {
      transactionRefId: paymentData.transactionRefId,
      operatorRefId: paymentData.operatorRefId,
      reference: actualConfirmationId,
    });

  } catch (error: any) {
    console.error('[MaishaPay Callback] Exception:', error);
    return redirectToFrontend('failed', error.message, undefined);
  }
};

serve(handler);
