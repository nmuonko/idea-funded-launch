import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailRequest {
  confirmationId: string;
  type: 'success' | 'failure';
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const { confirmationId, type }: EmailRequest = await req.json();

    if (!confirmationId || !type) {
      return new Response(
        JSON.stringify({ error: 'Missing confirmationId or type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize clients
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('[Email] RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(resendApiKey);
    const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'AfriFund <no-reply@afri-fund.org>';
    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL') ?? 'info@afri-fund.org';
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') ?? 'https://afri-fund.org';

    // Fetch submission details
    const { data: submission, error: fetchError } = await supabaseClient
      .from('user_submissions')
      .select('*')
      .eq('confirmation_id', confirmationId)
      .maybeSingle();

    if (fetchError || !submission) {
      console.error('[Email] Submission not found:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resultsUrl = `${frontendUrl}/results?ref=${confirmationId}`;

    if (type === 'success') {
      // Send success email to applicant
      const applicantHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10b981; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .confirmation-id { background: #d1fae5; color: #065f46; padding: 15px; border-radius: 6px; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; font-family: monospace; }
            .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Payment Confirmed!</h1>
            </div>
            <div class="content">
              <p>Dear ${submission.full_name},</p>
              
              <p>Thank you for your payment of <strong>$${submission.payment_amount} USD</strong> via MaishaPay.</p>
              
              <p><strong>Your project has been successfully submitted to the AfriFund competition!</strong></p>
              
              <div class="confirmation-id">
                ${confirmationId}
              </div>
              
              <p><strong>⚠️ IMPORTANT:</strong> Keep this Confirmation ID safe. You will use it to track your application status.</p>
              
              <h3>Project Details:</h3>
              <ul>
                <li><strong>Project Title:</strong> ${submission.project_title}</li>
                <li><strong>Funding Requested:</strong> $${submission.funding_needed} USD</li>
                <li><strong>Submitted:</strong> ${new Date(submission.submitted_at).toLocaleString()}</li>
              </ul>
              
              <h3>What's Next?</h3>
              <ol>
                <li>Our team will review your application</li>
                <li>You'll receive updates via email</li>
                <li>Track your status using your Confirmation ID</li>
              </ol>
              
              <p style="text-align: center;">
                <a href="${resultsUrl}" class="button">Track Your Application</a>
              </p>
              
              <p>If you have any questions, please contact us at <a href="mailto:info@afri-fund.org">info@afri-fund.org</a></p>
              
              <p>Best regards,<br><strong>The AfriFund Team</strong></p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} AfriFund. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: fromAddress,
        to: [submission.email],
        subject: `[AfriFund] Payment Confirmed & Project Submitted – ${confirmationId}`,
        html: applicantHtml,
      });

      console.log('[Email] Success email sent to applicant:', submission.email);

      // Send admin notification
      const adminHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #3b82f6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f3f4f6; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>💰 New Paid Submission</h2>
            </div>
            <div class="content">
              <p><strong>A new project submission has been paid and submitted.</strong></p>
              
              <table>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
                <tr>
                  <td>Confirmation ID</td>
                  <td><strong>${confirmationId}</strong></td>
                </tr>
                <tr>
                  <td>Applicant Name</td>
                  <td>${submission.full_name}</td>
                </tr>
                <tr>
                  <td>Email</td>
                  <td>${submission.email}</td>
                </tr>
                <tr>
                  <td>WhatsApp</td>
                  <td>${submission.whatsapp_number}</td>
                </tr>
                <tr>
                  <td>Project Title</td>
                  <td>${submission.project_title}</td>
                </tr>
                <tr>
                  <td>Funding Requested</td>
                  <td>$${submission.funding_needed} USD</td>
                </tr>
                <tr>
                  <td>Payment Amount</td>
                  <td>$${submission.payment_amount} ${submission.payment_currency}</td>
                </tr>
                <tr>
                  <td>Transaction ID</td>
                  <td>${submission.payment_ref_id ?? 'N/A'}</td>
                </tr>
                <tr>
                  <td>Submitted At</td>
                  <td>${new Date(submission.submitted_at).toLocaleString()}</td>
                </tr>
              </table>
              
              <p>Review this submission in the admin dashboard.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: fromAddress,
        to: [adminEmail],
        subject: `[AfriFund] New Paid Submission – ${confirmationId}`,
        html: adminHtml,
      });

      console.log('[Email] Admin notification sent to:', adminEmail);

    } else if (type === 'failure') {
      // Send failure email to applicant
      const failureHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Payment Failed</h1>
            </div>
            <div class="content">
              <p>Dear ${submission.full_name},</p>
              
              <p>Unfortunately, your payment for the AfriFund competition could not be processed.</p>
              
              <p><strong>Your project has NOT been submitted yet.</strong></p>
              
              <p>Confirmation ID: <strong>${confirmationId}</strong></p>
              
              <h3>What Should You Do?</h3>
              <ol>
                <li>Verify your payment details</li>
                <li>Try the payment again</li>
                <li>Contact support if issues persist</li>
              </ol>
              
              <p style="text-align: center;">
                <a href="${frontendUrl}/apply" class="button">Try Payment Again</a>
              </p>
              
              <p>If you continue experiencing issues, please contact us at <a href="mailto:info@afri-fund.org">info@afri-fund.org</a></p>
              
              <p>Best regards,<br><strong>The AfriFund Team</strong></p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} AfriFund. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: fromAddress,
        to: [submission.email],
        subject: `[AfriFund] Payment Failed – ${confirmationId}`,
        html: failureHtml,
      });

      console.log('[Email] Failure email sent to applicant:', submission.email);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Email] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
