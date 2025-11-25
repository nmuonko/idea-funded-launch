import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FraudAlertRequest {
  submissionId: string;
  confirmationId: string;
  applicantName: string;
  applicantEmail: string;
  projectTitle: string;
  fraudFlags: string[];
  similarityScore?: number;
  duplicateCounts: {
    emails: number;
    phones: number;
    sameUser: number;
  };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      submissionId,
      confirmationId,
      applicantName,
      applicantEmail,
      projectTitle,
      fraudFlags,
      similarityScore,
      duplicateCounts,
    }: FraudAlertRequest = await req.json();

    const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL");
    const fromEmail = Deno.env.get("EMAIL_FROM_ADDRESS") || "onboarding@resend.dev";

    if (!adminEmail) {
      throw new Error("ADMIN_NOTIFICATION_EMAIL not configured");
    }

    // Build fraud flags HTML list
    const fraudFlagsHtml = fraudFlags
      .map(flag => `<li style="margin: 8px 0; color: #dc2626;">${flag}</li>`)
      .join('');

    // Build similarity score section
    const similaritySection = similarityScore 
      ? `
        <div style="background-color: #fee2e2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 8px 0; color: #991b1b;">⚠️ High Similarity Detected</h3>
          <p style="margin: 0; font-size: 18px; font-weight: bold; color: #dc2626;">
            ${similarityScore}% match with existing submission(s)
          </p>
        </div>
      `
      : '';

    // Build duplicate counts section
    const duplicatesSection = `
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <h3 style="margin: 0 0 12px 0; color: #92400e;">📊 Duplicate Detection Summary</h3>
        <ul style="margin: 0; padding-left: 20px;">
          <li><strong>Duplicate Emails:</strong> ${duplicateCounts.emails} match(es)</li>
          <li><strong>Duplicate Phone Numbers:</strong> ${duplicateCounts.phones} match(es)</li>
          <li><strong>Same User Submissions:</strong> ${duplicateCounts.sameUser} submission(s)</li>
        </ul>
      </div>
    `;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Fraud Alert - AfriFund</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          
          <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">🚨 Fraud Alert</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.9;">Suspicious submission detected in AfriFund</p>
          </div>

          <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            
            <p style="font-size: 16px; margin-bottom: 24px;">
              A submission has been flagged for potential fraud by our automated detection system.
            </p>

            ${similaritySection}
            ${duplicatesSection}

            <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 24px 0;">
              <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #1f2937;">Submission Details</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Confirmation ID:</td>
                  <td style="padding: 8px 0; font-family: monospace;">${confirmationId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Applicant Name:</td>
                  <td style="padding: 8px 0;">${applicantName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Email:</td>
                  <td style="padding: 8px 0;">${applicantEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Project Title:</td>
                  <td style="padding: 8px 0;">${projectTitle}</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #fef2f2; padding: 20px; border-radius: 6px; margin: 24px 0;">
              <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #991b1b;">⚠️ Fraud Flags Detected</h2>
              <ul style="margin: 0; padding-left: 24px;">
                ${fraudFlagsHtml}
              </ul>
            </div>

            <div style="text-align: center; margin-top: 32px;">
              <a href="${Deno.env.get('FRONTEND_BASE_URL')}/admin/fraud-review" 
                 style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Review in Fraud Queue →
              </a>
            </div>

            <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 14px; color: #6b7280;">
              <p style="margin: 0;">This is an automated fraud alert from AfriFund.</p>
              <p style="margin: 8px 0 0 0;">Please review the submission as soon as possible.</p>
            </div>

          </div>

          <div style="text-align: center; margin-top: 24px; color: #9ca3af; font-size: 12px;">
            <p>© ${new Date().getFullYear()} AfriFund. All rights reserved.</p>
          </div>

        </body>
      </html>
    `;

    console.log(`Sending fraud alert to ${adminEmail} for submission ${confirmationId}`);

    const emailResponse = await resend.emails.send({
      from: `AfriFund Security <${fromEmail}>`,
      to: [adminEmail],
      subject: `🚨 Fraud Alert: ${confirmationId} - ${fraudFlags.length} flag(s) detected`,
      html: emailHtml,
    });

    console.log("Fraud alert email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Fraud alert email sent successfully'
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in send-fraud-alert-email function:", error);
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
