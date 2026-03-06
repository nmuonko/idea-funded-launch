import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId } = await req.json();
    
    if (!submissionId) {
      throw new Error('submissionId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendKey = Deno.env.get('RESEND_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const resend = new Resend(resendKey);

    // Fetch the submission with AI summary
    const { data: submission, error: fetchError } = await supabase
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      throw new Error(`Failed to fetch submission: ${fetchError?.message}`);
    }

    const miniSummary = submission.ai_summary 
      ? submission.ai_summary.split('.').slice(0, 2).join('.') + '.'
      : 'We are excited to review your innovative project proposal.';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Thank You for Your Submission!</h1>
        </div>
        
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Dear ${submission.full_name},
          </p>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            We have successfully received your project submission for <strong>${submission.project_title}</strong>.
          </p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin: 20px 0;">
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              <strong>Quick Summary:</strong><br/>
              ${miniSummary}
            </p>
          </div>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Our team is excited to review your proposal and will carefully evaluate it based on impact, feasibility, and innovation. We will notify you of the results once the judging process is complete.
          </p>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Thank you for taking the time to share your vision with AfriFund. We appreciate your commitment to creating positive change in your community.
          </p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              Best regards,<br/>
              <strong style="color: #374151;">The AfriFund Team</strong>
            </p>
          </div>
        </div>
      </div>
    `;

    const { error: emailError } = await resend.emails.send({
      from: 'AfriFund <onboarding@resend.dev>',
      to: [submission.email],
      subject: `Submission Received: ${submission.project_title}`,
      html: emailHtml,
    });

    if (emailError) {
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    console.log(`Confirmation email sent for submission ${submissionId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in send-confirmation-email:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});