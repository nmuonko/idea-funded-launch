import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminNotificationRequest {
  submissionId: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId }: AdminNotificationRequest = await req.json();

    console.log('[Admin Payment Notification] Processing for submission:', submissionId);

    // Initialize Supabase client
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
      console.error('[Admin Payment Notification] Submission not found:', fetchError);
      throw new Error('Submission not found');
    }

    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL');
    if (!adminEmail) {
      console.error('[Admin Payment Notification] ADMIN_NOTIFICATION_EMAIL not configured');
      throw new Error('Admin email not configured');
    }

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

    // Send admin notification email
    const emailResponse = await resend.emails.send({
      from: Deno.env.get('EMAIL_FROM_ADDRESS') || "AfriFund <onboarding@resend.dev>",
      to: [adminEmail],
      subject: `🔔 New Payment Received - ${confirmationId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
              line-height: 1.6; 
              color: #333;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white;
              border-radius: 8px;
              padding: 30px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header {
              background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
              color: white;
              padding: 20px;
              border-radius: 6px;
              margin-bottom: 20px;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .info-grid {
              display: grid;
              gap: 15px;
              margin: 20px 0;
            }
            .info-row {
              display: flex;
              padding: 12px;
              background: #f8f9fa;
              border-radius: 6px;
              border-left: 4px solid #6366F1;
            }
            .info-label {
              flex: 0 0 150px;
              font-weight: 600;
              color: #64748b;
            }
            .info-value {
              flex: 1;
              color: #0F172A;
            }
            .highlight {
              background: #6366F1;
              color: white;
              padding: 15px;
              border-radius: 6px;
              text-align: center;
              font-size: 18px;
              font-weight: 700;
              margin: 20px 0;
            }
            .button {
              display: inline-block;
              background: #6366F1;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔔 New Payment Received</h1>
            </div>

            <div class="highlight">
              Confirmation ID: ${confirmationId}
            </div>

            <div class="info-grid">
              <div class="info-row">
                <div class="info-label">Applicant Name:</div>
                <div class="info-value">${submission.full_name}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Email:</div>
                <div class="info-value">${submission.email}</div>
              </div>
              <div class="info-row">
                <div class="info-label">WhatsApp:</div>
                <div class="info-value">${submission.whatsapp_number}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Project Title:</div>
                <div class="info-value">${submission.project_title}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Location:</div>
                <div class="info-value">${submission.city_province}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Funding Requested:</div>
                <div class="info-value">$${submission.funding_needed}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Payment Amount:</div>
                <div class="info-value"><strong>$${amount} ${currency}</strong></div>
              </div>
              <div class="info-row">
                <div class="info-label">Transaction ID:</div>
                <div class="info-value" style="font-family: monospace; font-size: 12px;">${transactionId}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Payment Date:</div>
                <div class="info-value">${paymentDate}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Reference:</div>
                <div class="info-value" style="font-family: monospace;">${submission.maishapay_reference || 'N/A'}</div>
              </div>
            </div>

            <div style="text-align: center; margin-top: 30px;">
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/admin/submissions" class="button">
                View in Admin Panel
              </a>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #64748b; font-size: 14px;">
              <p>This is an automated notification from AfriFund</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log('[Admin Payment Notification] Email sent successfully:', emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse.data }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('[Admin Payment Notification] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
