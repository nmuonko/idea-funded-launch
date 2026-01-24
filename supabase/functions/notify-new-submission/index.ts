import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  submissionId: string;
}

const handler = async (req: Request): Promise<Response> => {
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
    const { submissionId }: NotificationRequest = await req.json();

    if (!submissionId) {
      return new Response(
        JSON.stringify({ error: 'Missing submissionId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('[Notification] RESEND_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(resendApiKey);
    const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'AfriFund <no-reply@afri-fund.org>';
    const adminEmail = Deno.env.get('ADMIN_NOTIFICATION_EMAIL') ?? 'info@afri-fund.org';

    // Fetch submission details
    const { data: submission, error: fetchError } = await supabaseClient
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle();

    if (fetchError || !submission) {
      console.error('[Notification] Submission not found:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send notification email to admin
    const adminHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
          th { background: #f3f4f6; font-weight: bold; }
          .badge { display: inline-block; padding: 4px 8px; background: #10b981; color: white; border-radius: 4px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>📝 New Draft Application Created</h2>
          </div>
          <div class="content">
            <p><strong>A new project application has been started but not yet submitted.</strong></p>
            <p>This notification is sent when an applicant creates their application draft. They still need to complete payment for final submission.</p>
            
            <table>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
              <tr>
                <td>Confirmation ID</td>
                <td><strong>${submission.confirmation_id || 'Pending'}</strong></td>
              </tr>
              <tr>
                <td>Draft Status</td>
                <td><span class="badge">DRAFT</span></td>
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
                <td>Country</td>
                <td>${submission.country || 'Not specified'}</td>
              </tr>
              <tr>
                <td>City/Province</td>
                <td>${submission.city_province}</td>
              </tr>
              <tr>
                <td>Funding Requested</td>
                <td>$${submission.funding_needed} USD</td>
              </tr>
              <tr>
                <td>Created At</td>
                <td>${new Date(submission.created_at).toLocaleString()}</td>
              </tr>
            </table>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Applicant needs to complete payment</li>
              <li>Once paid, full submission will be processed</li>
              <li>You'll receive another notification upon successful payment</li>
            </ul>
            
            <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">
              💡 <strong>Tip:</strong> This early notification helps you track application pipeline and identify potential applicants.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await resend.emails.send({
      from: fromAddress,
      to: [adminEmail],
      subject: `[AfriFund] New Draft Application – ${submission.full_name}`,
      html: adminHtml,
    });

    console.log('[Notification] New submission notification sent to:', adminEmail);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Notification] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
