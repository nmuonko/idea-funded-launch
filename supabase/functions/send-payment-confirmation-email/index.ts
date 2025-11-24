import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentConfirmationRequest {
  submissionId: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId }: PaymentConfirmationRequest = await req.json();

    console.log('[Payment Confirmation Email] Processing for submission:', submissionId);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch submission with project code
    const { data: submission, error: fetchError } = await supabaseClient
      .from('user_submissions')
      .select(`
        *,
        sessions (
          name,
          announcement_date
        )
      `)
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      console.error('[Payment Confirmation Email] Submission not found:', fetchError);
      throw new Error('Submission not found');
    }

    console.log('[Payment Confirmation Email] Found submission with project code:', submission.project_code);

    if (!submission.project_code) {
      console.warn('[Payment Confirmation Email] No project code yet, may need to retry');
    }

    const amount = submission.payment_amount || submission.amount_due || 20;
    const currency = submission.payment_currency || 'USD';
    const transactionId = submission.maishapay_transaction_id || 'N/A';
    const paymentDate = new Date(submission.updated_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const announcementDate = submission.sessions?.announcement_date 
      ? new Date(submission.sessions.announcement_date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'TBA';

    // Send payment confirmation email
    const emailResponse = await resend.emails.send({
      from: "AfriFund <onboarding@resend.dev>",
      to: [submission.email],
      subject: `🎉 Payment Confirmed - Project Code: ${submission.project_code || 'Processing'}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
              line-height: 1.6; 
              color: #333;
              margin: 0;
              padding: 0;
              background-color: #f5f5f5;
            }
            .container { 
              max-width: 600px; 
              margin: 20px auto; 
              background: white;
              border-radius: 12px;
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
              color: white;
              padding: 40px 30px;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
              font-weight: 700;
            }
            .header .emoji {
              font-size: 48px;
              margin-bottom: 10px;
            }
            .content {
              padding: 40px 30px;
            }
            .project-code {
              background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
              color: white;
              padding: 20px;
              border-radius: 8px;
              text-align: center;
              margin: 30px 0;
              box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            }
            .project-code-label {
              font-size: 14px;
              opacity: 0.9;
              margin-bottom: 8px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .project-code-value {
              font-size: 32px;
              font-weight: 700;
              font-family: 'Courier New', monospace;
              letter-spacing: 2px;
            }
            .section {
              margin: 30px 0;
            }
            .section-title {
              color: #0F172A;
              font-size: 20px;
              font-weight: 600;
              margin-bottom: 15px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .detail-grid {
              background: #f8f9fa;
              border-radius: 8px;
              padding: 20px;
              margin: 15px 0;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 10px 0;
              border-bottom: 1px solid #e2e8f0;
            }
            .detail-row:last-child {
              border-bottom: none;
            }
            .detail-label {
              color: #64748b;
              font-size: 14px;
            }
            .detail-value {
              font-weight: 600;
              color: #0F172A;
              text-align: right;
            }
            .steps {
              counter-reset: step-counter;
              list-style: none;
              padding: 0;
            }
            .steps li {
              counter-increment: step-counter;
              position: relative;
              padding-left: 40px;
              margin-bottom: 20px;
            }
            .steps li::before {
              content: counter(step-counter);
              position: absolute;
              left: 0;
              top: 0;
              width: 28px;
              height: 28px;
              background: #6366F1;
              color: white;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 700;
              font-size: 14px;
            }
            .steps li strong {
              color: #0F172A;
            }
            .footer {
              background: #f8f9fa;
              padding: 30px;
              text-align: center;
              color: #64748b;
              font-size: 14px;
            }
            .button {
              display: inline-block;
              background: #6366F1;
              color: white;
              padding: 14px 32px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              margin: 20px 0;
              box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
            }
            .receipt {
              border: 2px dashed #e2e8f0;
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
            }
            .receipt-title {
              font-size: 16px;
              font-weight: 600;
              color: #0F172A;
              margin-bottom: 15px;
              text-align: center;
            }
            .highlight {
              color: #6366F1;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="emoji">🎉</div>
              <h1>Payment Confirmed!</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Your project is now under review</p>
            </div>

            <div class="content">
              <p style="font-size: 16px; margin: 0 0 20px 0;">
                Dear <strong>${submission.full_name}</strong>,
              </p>
              
              <p style="font-size: 16px; margin: 0 0 10px 0;">
                Your payment of <span class="highlight">$${amount} ${currency}</span> has been successfully processed!
              </p>

              ${submission.project_code ? `
                <div class="project-code">
                  <div class="project-code-label">📋 Your Project Code</div>
                  <div class="project-code-value">${submission.project_code}</div>
                </div>
              ` : `
                <div class="project-code">
                  <div class="project-code-label">⏳ Generating Project Code</div>
                  <div style="font-size: 16px; margin-top: 10px;">Your project code will be available shortly</div>
                </div>
              `}

              <div class="detail-grid">
                <div class="detail-row">
                  <span class="detail-label">Project Title</span>
                  <span class="detail-value">${submission.project_title}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Funding Requested</span>
                  <span class="detail-value">$${submission.funding_needed}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Session</span>
                  <span class="detail-value">${submission.sessions?.name || 'Active Session'}</span>
                </div>
              </div>

              <div class="section">
                <div class="section-title">✅ What Happens Next?</div>
                <ul class="steps">
                  <li>
                    <strong>Review Process (2-3 weeks)</strong>
                    <div style="color: #64748b; font-size: 14px; margin-top: 5px;">
                      Our team will carefully evaluate your proposal based on impact potential, feasibility, innovation, and sustainability.
                    </div>
                  </li>
                  <li>
                    <strong>Track Your Application</strong>
                    <div style="color: #64748b; font-size: 14px; margin-top: 5px;">
                      Use your project code ${submission.project_code ? `<strong>${submission.project_code}</strong>` : '(coming soon)'} to check status anytime.
                    </div>
                  </li>
                  <li>
                    <strong>Results Announcement</strong>
                    <div style="color: #64748b; font-size: 14px; margin-top: 5px;">
                      Winners will be notified by ${announcementDate}. Check your email and our results page regularly.
                    </div>
                  </li>
                  <li>
                    <strong>Questions?</strong>
                    <div style="color: #64748b; font-size: 14px; margin-top: 5px;">
                      Contact us via email or WhatsApp if you need assistance.
                    </div>
                  </li>
                </ul>
              </div>

              ${submission.project_code ? `
                <div style="text-align: center;">
                  <a href="${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/results?code=${submission.project_code}" class="button">
                    Track My Application
                  </a>
                </div>
              ` : ''}

              <div class="receipt">
                <div class="receipt-title">━━━ Payment Receipt ━━━</div>
                <div class="detail-row">
                  <span class="detail-label">Amount Paid</span>
                  <span class="detail-value">$${amount} ${currency}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Transaction ID</span>
                  <span class="detail-value" style="font-family: 'Courier New', monospace; font-size: 12px;">${transactionId}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Payment Date</span>
                  <span class="detail-value">${paymentDate}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Reference</span>
                  <span class="detail-value" style="font-family: 'Courier New', monospace; font-size: 12px;">${submission.maishapay_reference || 'N/A'}</span>
                </div>
              </div>
            </div>

            <div class="footer">
              <p style="margin: 0 0 10px 0; font-size: 16px; color: #0F172A; font-weight: 600;">
                Thank you for choosing AfriFund!
              </p>
              <p style="margin: 0;">
                Best regards,<br>
                <strong>The AfriFund Team</strong>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log('[Payment Confirmation Email] Email sent successfully:', emailResponse);

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
    console.error('[Payment Confirmation Email] Error:', error);
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
