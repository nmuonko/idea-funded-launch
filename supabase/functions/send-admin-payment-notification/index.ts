import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, ADMIN_EMAIL, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildAdminNotificationEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminNotificationRequest {
  submissionId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId }: AdminNotificationRequest = await req.json();

    console.log('[send-admin-payment-notification] Processing for submission:', submissionId);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch submission details
    const { data: submission, error: fetchError } = await supabaseClient
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      console.error('[send-admin-payment-notification] Submission not found:', fetchError);
      throw new Error('Submission not found');
    }

    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL') || ADMIN_EMAIL;
    
    const amount = submission.payment_amount || submission.amount_due || 20;
    const currency = submission.payment_currency || 'USD';
    const transactionId = submission.maishapay_transaction_id || 'N/A';
    const confirmationId = submission.confirmation_id || 'N/A';
    const paymentDate = new Date(submission.updated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const template = buildAdminNotificationEmail({
      type: 'payment_received',
      summary: `New payment received from ${submission.full_name}`,
      details: {
        'Confirmation ID': confirmationId,
        'Applicant Name': submission.full_name,
        'Email': submission.email,
        'WhatsApp': submission.whatsapp_number,
        'Project Title': submission.project_title,
        'Location': submission.city_province,
        'Funding Requested': `$${submission.funding_needed}`,
        'Payment Amount': `$${amount} ${currency}`,
        'Transaction ID': transactionId,
        'Payment Date': paymentDate,
      },
    });

    const result = await sendEmail({
      to: adminEmail,
      subject: template.subject,
      html: template.html,
      category: "admin_notification",
    });

    console.log('[send-admin-payment-notification] Result:', result);

    return new Response(
      JSON.stringify({ success: result.success, id: result.id }),
      { status: result.success ? 200 : 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error('[send-admin-payment-notification] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
