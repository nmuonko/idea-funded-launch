import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "npm:resend@2.0.0";

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

    // Fetch the submission with AI analysis
    const { data: submission, error: fetchError } = await supabase
      .from('user_submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      throw new Error(`Failed to fetch submission: ${fetchError?.message}`);
    }

    // Format strengths and risks as HTML lists
    const strengthsList = submission.ai_strengths
      ? submission.ai_strengths.split('\n').filter(s => s.trim()).map(s => `<li>${s.replace(/^[•\-]\s*/, '')}</li>`).join('')
      : '<li>Your project shows promise and dedication</li>';

    const risksList = submission.ai_risks
      ? submission.ai_risks.split('\n').filter(r => r.trim()).map(r => `<li>${r.replace(/^[•\-]\s*/, '')}</li>`).join('')
      : '<li>Consider developing a more detailed implementation plan</li>';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Thank You for Participating</h1>
        </div>
        
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Dear ${submission.full_name},
          </p>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Thank you for submitting your project <strong>"${submission.project_title}"</strong> to AfriFund. We greatly appreciate the time and effort you invested in your application.
          </p>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            After careful review by our judges, we regret to inform you that your project was not selected for funding in this round. However, we want to emphasize that this does not diminish the value of your vision and hard work.
          </p>

          ${submission.ai_summary ? `
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">Project Summary</h3>
            <p style="font-size: 14px; color: #6b7280;">${submission.ai_summary}</p>
          </div>
          ` : ''}

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #10b981; margin-top: 0;">✓ Key Strengths</h3>
            <ul style="color: #374151; line-height: 1.8;">
              ${strengthsList}
            </ul>
          </div>

          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #f59e0b; margin-top: 0;">⚠ Areas for Improvement</h3>
            <ul style="color: #374151; line-height: 1.8;">
              ${risksList}
            </ul>
          </div>

          ${submission.ai_feedback_short ? `
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin: 20px 0;">
            <h3 style="color: #374151; margin-top: 0;">💡 Feedback & Suggestions</h3>
            <p style="font-size: 14px; color: #6b7280; line-height: 1.6;">
              ${submission.ai_feedback_short.split('\n').join('<br/><br/>')}
            </p>
          </div>
          ` : ''}
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px; margin: 30px 0;">
            <p style="color: white; font-size: 16px; margin: 0; text-align: center;">
              <strong>We encourage you to apply again in future rounds!</strong><br/>
              Use this feedback to strengthen your proposal and reapply when we open submissions again.
            </p>
          </div>
          
          <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
            Your passion for creating positive change is inspiring, and we hope to see an even stronger application from you in the future.
          </p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 14px; color: #6b7280; margin: 0;">
              With respect and encouragement,<br/>
              <strong style="color: #374151;">The AfriFund Team</strong>
            </p>
          </div>
        </div>
      </div>
    `;

    const { error: emailError } = await resend.emails.send({
      from: 'AfriFund <onboarding@resend.dev>',
      to: [submission.email],
      subject: `AfriFund Application Update: ${submission.project_title}`,
      html: emailHtml,
    });

    if (emailError) {
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    console.log(`Feedback email sent for submission ${submissionId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in send-feedback-email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});